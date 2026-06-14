import type {
  FileSystemDirectoryHandleLike,
  FileSystemHandleLike,
} from '../shared/fileSystemAccess'
import type { EverQuestCharacter, EverQuestLogFile } from '../shared/messages'
import { getDependency, type Deps } from './di'
import { MessageBroker } from './MessageBroker'

const directoryScanIntervalMs = 100
const tailIntervalMs = 10
const characterActiveWindowMs = 5 * 60 * 1000

interface TailTask {
  logFile: EverQuestLogFile
  offset: number
  pendingText: string
  timeoutId: ReturnType<typeof globalThis.setTimeout> | null
}

interface CharacterIdentity {
  characterName: string
  serverName: string
}

export interface EverQuestLogLineRecord {
  characterName: string
  serverName: string
  text: string
  timestamp: string
}

export interface FileWatcherObserver {
  onLogLine(record: EverQuestLogLineRecord): void
}

export class FileWatcher {
  private fileHandle: FileSystemHandleLike | null = null
  private readonly broker: MessageBroker
  private readonly unregister: () => void
  private readonly observers = new Set<FileWatcherObserver>()
  private readonly tailTasks = new Map<string, TailTask>()
  private readonly watchedLogFileNames = new Set<string>()
  private readonly characterLastLogLineReceivedAt = new Map<string, number>()
  private cachedLogFiles: EverQuestLogFile[] = []
  private lastAnnouncedCharactersSignature = ''
  private isDirectoryScanRunning = false
  private isTailRunning = false
  private directoryScanTimeoutId: ReturnType<
    typeof globalThis.setTimeout
  > | null = null
  private activityExpiryTimeoutId: ReturnType<
    typeof globalThis.setTimeout
  > | null = null

  constructor(deps: Deps) {
    const broker = getDependency(deps, MessageBroker)
    this.broker = broker

    this.unregister = broker.register('file-watcher', {
      setFileHandle: this.setFileHandle,
      getCharacters: this.getCharacters,
      startWatch: this.startWatch,
      stopWatch: this.stopWatch,
    })
  }

  dispose() {
    this.unregister()
    this.observers.clear()
    this.stopDirectoryScanning()
    this.stopTailing()
  }

  observe(observer: FileWatcherObserver) {
    this.observers.add(observer)

    return () => {
      this.observers.delete(observer)
    }
  }

  private readonly setFileHandle = (params: unknown) => {
    if (!isSetFileHandleRequest(params)) {
      throw new Error('Invalid setFileHandle request.')
    }

    this.stopDirectoryScanning()
    this.stopTailing()
    this.fileHandle = params.fileHandle
    this.watchedLogFileNames.clear()
    this.characterLastLogLineReceivedAt.clear()
    this.cachedLogFiles = []
    this.lastAnnouncedCharactersSignature = ''

    if (this.getEverQuestDirectoryHandle()) {
      this.startDirectoryScanning()
    }

    return {}
  }

  private readonly getCharacters = async () => {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      console.warn('[FileWatcher] no EverQuest directory handle is stored')
      return { characters: [] }
    }

    return {
      characters: this.getCachedCharacters(),
    }
  }

  private readonly startWatch = () => {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      console.warn('[FileWatcher] no EverQuest directory handle is stored')
      return {}
    }

    if (this.isTailRunning) {
      return {}
    }

    this.isTailRunning = true
    this.startTailingCachedLogs()
    this.announceCharactersIfChanged()
    this.scheduleActivityExpiryCheck()

    return {}
  }

  private readonly stopWatch = () => {
    this.stopTailing()
    this.watchedLogFileNames.clear()
    this.announceCharactersIfChanged()

    return {}
  }

  private startDirectoryScanning() {
    if (this.isDirectoryScanRunning) {
      return
    }

    this.isDirectoryScanRunning = true
    void this.runDirectoryScanCycle()
  }

  private stopDirectoryScanning() {
    this.isDirectoryScanRunning = false

    if (this.directoryScanTimeoutId) {
      globalThis.clearTimeout(this.directoryScanTimeoutId)
      this.directoryScanTimeoutId = null
    }
  }

  private async runDirectoryScanCycle() {
    try {
      const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

      if (!everQuestDirectoryHandle) {
        console.warn('[FileWatcher] no EverQuest directory handle is stored')
        this.stopDirectoryScanning()
        return
      }

      const logs = await this.refreshLogCache(true)

      if (this.isTailRunning) {
        this.startTailingLogs(logs)
      }
    } catch (error) {
      console.error('[FileWatcher] directory scan cycle failed', error)
    } finally {
      this.scheduleNextDirectoryScanCycle()
    }
  }

  private scheduleNextDirectoryScanCycle() {
    if (!this.isDirectoryScanRunning) {
      return
    }

    this.directoryScanTimeoutId = globalThis.setTimeout(() => {
      this.directoryScanTimeoutId = null
      void this.runDirectoryScanCycle()
    }, directoryScanIntervalMs)
  }

  private startTailingCachedLogs() {
    this.startTailingLogs(this.cachedLogFiles)
  }

  private startTailingLogs(logs: EverQuestLogFile[]) {
    logs.forEach((logFile) => {
      if (this.watchedLogFileNames.has(logFile.fileName)) {
        return
      }

      this.watchedLogFileNames.add(logFile.fileName)
      void this.startTailingLogFile(logFile).catch((error: unknown) => {
        console.error('[FileWatcher] tail log file failed', error)
      })
    })
  }

  private readonly startTailingLogFile = async (logFile: EverQuestLogFile) => {
    if (this.tailTasks.has(logFile.fileName)) {
      return
    }

    const file = await this.getLogFile(logFile)

    if (!file) {
      console.warn('[FileWatcher] log file was not found', logFile.fileName)
      return
    }

    const tailTask: TailTask = {
      logFile,
      offset: file.size,
      pendingText: '',
      timeoutId: null,
    }

    this.tailTasks.set(logFile.fileName, tailTask)
    this.scheduleNextTailCycle(tailTask)
  }

  private async runTailCycle(tailTask: TailTask) {
    if (!this.tailTasks.has(tailTask.logFile.fileName)) {
      return
    }

    try {
      const file = await this.getLogFile(tailTask.logFile)

      if (!file) {
        console.warn(
          '[FileWatcher] log file disappeared',
          tailTask.logFile.fileName,
        )
        this.stopTailTask(tailTask.logFile.fileName)
        return
      }

      if (file.size < tailTask.offset) {
        tailTask.offset = file.size
        tailTask.pendingText = ''
        return
      }

      if (file.size === tailTask.offset) {
        return
      }

      const text = await file.slice(tailTask.offset).text()

      tailTask.offset = file.size
      this.reportCompleteLines(tailTask, text)
    } catch (error) {
      console.error('[FileWatcher] tail cycle failed', error)
    } finally {
      this.scheduleNextTailCycle(tailTask)
    }
  }

  private scheduleNextTailCycle(tailTask: TailTask) {
    if (!this.tailTasks.has(tailTask.logFile.fileName)) {
      return
    }

    tailTask.timeoutId = globalThis.setTimeout(() => {
      tailTask.timeoutId = null
      void this.runTailCycle(tailTask)
    }, tailIntervalMs)
  }

  private reportCompleteLines(tailTask: TailTask, text: string) {
    const combinedText = `${tailTask.pendingText}${text}`
    const lastNewlineIndex = combinedText.lastIndexOf('\n')

    if (lastNewlineIndex === -1) {
      tailTask.pendingText = combinedText
      return
    }

    tailTask.pendingText = combinedText.slice(lastNewlineIndex + 1)

    combinedText
      .slice(0, lastNewlineIndex)
      .split('\n')
      .forEach((rawLine) => {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine

        if (!line) {
          return
        }

        const parsedLine = parseEverQuestLogLine(line)

        this.reportLogLine({
          characterName: tailTask.logFile.characterName,
          serverName: tailTask.logFile.serverName,
          text: parsedLine.text,
          timestamp: parsedLine.timestamp,
        })
      })
  }

  private reportLogLine(record: EverQuestLogLineRecord) {
    this.markCharacterLogLineReceived(record)

    this.observers.forEach((observer) => {
      try {
        observer.onLogLine(record)
      } catch (error) {
        console.error('[FileWatcher] observer failed', error)
      }
    })
  }

  private async refreshLogCache(announceNewCharacters: boolean) {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      this.cachedLogFiles = []
      return []
    }

    const logs = await enumerateEverQuestLogs(everQuestDirectoryHandle)

    this.cachedLogFiles = logs

    if (announceNewCharacters) {
      this.announceCharactersIfChanged()
    }

    return logs
  }

  private markCharacterLogLineReceived(record: EverQuestLogLineRecord) {
    this.characterLastLogLineReceivedAt.set(getCharacterKey(record), Date.now())
    this.announceCharactersIfChanged()
    this.scheduleActivityExpiryCheck()
  }

  private getCachedCharacters() {
    return getCharactersFromLogs(
      this.cachedLogFiles,
      this.getActiveCharacterKeys(),
    )
  }

  private getActiveCharacterKeys() {
    const activeCharacterKeys = new Set<string>()

    if (!this.isTailRunning) {
      return activeCharacterKeys
    }

    const now = Date.now()

    this.characterLastLogLineReceivedAt.forEach((receivedAt, key) => {
      if (now - receivedAt <= characterActiveWindowMs) {
        activeCharacterKeys.add(key)
        return
      }

      this.characterLastLogLineReceivedAt.delete(key)
    })

    return activeCharacterKeys
  }

  private announceCharactersIfChanged() {
    const characters = this.getCachedCharacters()
    const signature = getCharactersSignature(characters)

    if (signature === this.lastAnnouncedCharactersSignature) {
      return
    }

    this.lastAnnouncedCharactersSignature = signature

    this.broker.send('file-watcher', 'client.file-watcher.characters', {
      characters,
    })
  }

  private stopTailing() {
    this.isTailRunning = false
    this.clearActivityExpiryTimer()

    this.tailTasks.forEach((tailTask) => {
      if (tailTask.timeoutId) {
        globalThis.clearTimeout(tailTask.timeoutId)
      }
    })
    this.tailTasks.clear()
  }

  private stopTailTask(fileName: string) {
    const tailTask = this.tailTasks.get(fileName)

    if (!tailTask) {
      return
    }

    if (tailTask.timeoutId) {
      globalThis.clearTimeout(tailTask.timeoutId)
    }

    this.tailTasks.delete(fileName)
  }

  private scheduleActivityExpiryCheck() {
    this.clearActivityExpiryTimer()

    if (!this.isTailRunning) {
      return
    }

    const now = Date.now()
    let nextExpiryAt: number | null = null

    this.characterLastLogLineReceivedAt.forEach((receivedAt) => {
      const expiresAt = receivedAt + characterActiveWindowMs

      if (expiresAt <= now) {
        return
      }

      if (nextExpiryAt === null || expiresAt < nextExpiryAt) {
        nextExpiryAt = expiresAt
      }
    })

    if (nextExpiryAt === null) {
      return
    }

    this.activityExpiryTimeoutId = globalThis.setTimeout(() => {
      this.activityExpiryTimeoutId = null
      this.announceCharactersIfChanged()
      this.scheduleActivityExpiryCheck()
    }, Math.max(0, nextExpiryAt - now + 1))
  }

  private clearActivityExpiryTimer() {
    if (!this.activityExpiryTimeoutId) {
      return
    }

    globalThis.clearTimeout(this.activityExpiryTimeoutId)
    this.activityExpiryTimeoutId = null
  }

  private async getLogFile(logFile: EverQuestLogFile) {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      return null
    }

    const logsDirectoryHandle = await getLogsDirectoryHandle(
      everQuestDirectoryHandle,
    )

    if (!logsDirectoryHandle) {
      return null
    }

    try {
      return await logsDirectoryHandle
        .getFileHandle(logFile.fileName)
        .then((fileHandle) => fileHandle.getFile())
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return null
      }

      throw error
    }
  }

  private getEverQuestDirectoryHandle() {
    if (!isDirectoryHandle(this.fileHandle)) {
      return null
    }

    return this.fileHandle
  }
}

function isSetFileHandleRequest(
  value: unknown,
): value is { fileHandle: FileSystemHandleLike | null } {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<{ fileHandle: FileSystemHandleLike | null }>

  if (!('fileHandle' in candidate)) {
    return false
  }

  if (candidate.fileHandle === null) {
    return true
  }

  return (
    typeof candidate.fileHandle === 'object' &&
    typeof candidate.fileHandle.name === 'string' &&
    (candidate.fileHandle.kind === 'file' ||
      candidate.fileHandle.kind === 'directory')
  )
}

export async function enumerateEverQuestLogs(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  const logsDirectoryHandle = await getLogsDirectoryHandle(directoryHandle)

  if (!logsDirectoryHandle) {
    console.warn('[FileWatcher] Logs directory was not found')
    return []
  }

  const logs: EverQuestLogFile[] = []

  for await (const handle of logsDirectoryHandle.values()) {
    if (handle.kind !== 'file') {
      continue
    }

    const logFile = parseEverQuestLogFileName(handle.name)

    if (!logFile) {
      continue
    }

    logs.push(logFile)
  }

  return sortLogs(logs)
}

async function getLogsDirectoryHandle(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  try {
    return await directoryHandle.getDirectoryHandle('Logs')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return null
    }

    throw error
  }
}

function parseEverQuestLogFileName(fileName: string): EverQuestLogFile | null {
  const match = /^eqlog_([^_]+)_(.+)\.txt$/i.exec(fileName)

  if (!match) {
    return null
  }

  const [, characterName, serverName] = match

  return {
    characterName,
    fileName,
    serverName,
  }
}

function parseEverQuestLogLine(line: string) {
  const match = /^\[([^\]]+)]\s?(.*)$/.exec(line)

  if (!match) {
    return {
      text: line,
      timestamp: '',
    }
  }

  const [, timestamp, text] = match

  return {
    text,
    timestamp,
  }
}

function getCharactersFromLogs(
  logs: EverQuestLogFile[],
  activeCharacterKeys: Set<string>,
): EverQuestCharacter[] {
  const charactersByKey = new Map<string, EverQuestCharacter>()

  logs.forEach((log) => {
    const key = getCharacterKey(log)
    const character = {
      active: activeCharacterKeys.has(key),
      characterName: log.characterName,
      serverName: log.serverName,
    }

    charactersByKey.set(key, character)
  })

  return [...charactersByKey.values()].sort(compareCharacters)
}

function getCharactersSignature(characters: EverQuestCharacter[]) {
  return characters
    .map((character) => {
      return `${getCharacterKey(character)}\0${character.active ? '1' : '0'}`
    })
    .join('\0')
}

function getCharacterKey(character: CharacterIdentity) {
  return `${character.serverName.toLocaleLowerCase()}\0${character.characterName.toLocaleLowerCase()}`
}

function sortLogs(logs: EverQuestLogFile[]) {
  return [...logs].sort((left, right) => {
    const characterComparison = compareStrings(
      left.characterName,
      right.characterName,
    )

    if (characterComparison !== 0) {
      return characterComparison
    }

    const serverComparison = compareStrings(left.serverName, right.serverName)

    if (serverComparison !== 0) {
      return serverComparison
    }

    return compareStrings(left.fileName, right.fileName)
  })
}

function compareCharacters(
  left: EverQuestCharacter,
  right: EverQuestCharacter,
) {
  const characterComparison = compareStrings(
    left.characterName,
    right.characterName,
  )

  if (characterComparison !== 0) {
    return characterComparison
  }

  return compareStrings(left.serverName, right.serverName)
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function isDirectoryHandle(
  value: FileSystemHandleLike | null,
): value is FileSystemDirectoryHandleLike {
  return (
    !!value &&
    value.kind === 'directory' &&
    'getDirectoryHandle' in value &&
    'values' in value
  )
}

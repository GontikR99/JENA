import type {
  FileSystemDirectoryHandleLike,
  FileSystemFileHandleLike,
  FileSystemHandleLike,
} from '../shared/fileSystemAccess'
import type {
  EverQuestCharacter,
  EverQuestLogFile,
  LogSearchDoneMessage,
  LogSearchMatchMessage,
} from '../shared/messages'
import { getDependency, type Deps } from './di'
import { MessageBroker } from './MessageBroker'

const directoryScanIntervalMs = 100
const tailIntervalMs = 10
const characterActiveWindowMs = 30 * 60 * 1000
export const stalePresenceLogFileMaxAgeMs = 90 * 24 * 60 * 60 * 1000
const logSearchChunkSizeBytes = 512 * 1024
const logSearchMaxMatches = 5000
const logSearchMaxBinarySearchIterations = 64
const logSearchProbeBytes = 4096
const logSearchReadRetryCount = 3
const logSearchYieldLineInterval = 250

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

interface ActiveLogSearch {
  canceled: boolean
  searchId: string
}

interface StartLogSearchRequest {
  characterName: string
  endMs: number
  query: string
  searchId: string
  serverName: string
  startMs: number
  useRegex: boolean
}

interface LogSearchFileSnapshot {
  endOffset: number
  file: File
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
  private activeLogSearch: ActiveLogSearch | null = null
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
      startLogSearch: this.startLogSearch,
      cancelLogSearch: this.cancelLogSearch,
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
    this.cancelActiveLogSearch()

    if (this.getEverQuestDirectoryHandle()) {
      this.isTailRunning = true
      this.startDirectoryScanning()
      this.startTailingCachedLogs()
      this.scheduleActivityExpiryCheck()
    }

    return {}
  }

  private readonly startLogSearch = (params: unknown) => {
    if (!isStartLogSearchRequest(params)) {
      throw new Error('Invalid startLogSearch request.')
    }

    if (params.endMs < params.startMs) {
      throw new Error('Search end time must be after start time.')
    }

    const matcher = createLogSearchMatcher(params.query, params.useRegex)
    const task: ActiveLogSearch = {
      canceled: false,
      searchId: params.searchId,
    }

    this.cancelActiveLogSearch()
    this.activeLogSearch = task
    void this.runLogSearch(params, matcher, task)

    return {}
  }

  private readonly cancelLogSearch = (params: unknown) => {
    if (!isCancelLogSearchRequest(params)) {
      throw new Error('Invalid cancelLogSearch request.')
    }

    if (
      this.activeLogSearch &&
      this.activeLogSearch.searchId === params.searchId
    ) {
      this.activeLogSearch.canceled = true
      return { canceled: true }
    }

    return { canceled: false }
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

  private async runLogSearch(
    request: StartLogSearchRequest,
    matcher: (text: string) => boolean,
    task: ActiveLogSearch,
  ) {
    let matchCount = 0
    let truncated = false

    try {
      const logFile = await this.getSearchLogFile(request)
      const file = await this.getLogFile(logFile)

      if (!file) {
        throw new Error('Log file was not found.')
      }

      const searchFile: LogSearchFileSnapshot = {
        endOffset: file.size,
        file,
      }
      const startOffset = await this.findLogSearchStartOffset(
        logFile,
        searchFile,
        request.startMs,
      )
      const scanResult = await this.scanLogFile({
        logFile,
        matcher,
        request,
        searchFile,
        startOffset,
        task,
      })

      matchCount = scanResult.matchCount
      truncated = scanResult.truncated

      this.sendLogSearchDone({
        matchCount,
        searchId: request.searchId,
        status: task.canceled ? 'canceled' : 'complete',
        truncated,
      })
    } catch (error) {
      console.error(
        `[FileWatcher] log search failed searchId=${request.searchId} character=${request.characterName} server=${request.serverName} startMs=${request.startMs} endMs=${request.endMs} useRegex=${request.useRegex}`,
        error,
      )
      this.sendLogSearchDone({
        error: getErrorMessage(error),
        matchCount,
        searchId: request.searchId,
        status: task.canceled ? 'canceled' : 'error',
        truncated,
      })
    } finally {
      if (this.activeLogSearch === task) {
        this.activeLogSearch = null
      }
    }
  }

  private async scanLogFile({
    logFile,
    matcher,
    request,
    searchFile,
    startOffset,
    task,
  }: {
    logFile: EverQuestLogFile
    matcher: (text: string) => boolean
    request: StartLogSearchRequest
    searchFile: LogSearchFileSnapshot
    startOffset: number
    task: ActiveLogSearch
  }) {
    let offset = startOffset
    let pendingText = ''
    let processedLineCount = 0
    let matchCount = 0
    let truncated = false

    while (offset < searchFile.endOffset && !task.canceled) {
      const chunkEnd = Math.min(
        searchFile.endOffset,
        offset + logSearchChunkSizeBytes,
      )
      const chunkText = await this.readSearchFileText(
        logFile,
        searchFile,
        offset,
        chunkEnd,
      )
      offset = chunkEnd

      const combinedText = `${pendingText}${chunkText}`
      const lastNewlineIndex = combinedText.lastIndexOf('\n')
      const completeText =
        lastNewlineIndex >= 0
          ? combinedText.slice(0, lastNewlineIndex)
          : ''

      pendingText =
        lastNewlineIndex >= 0
          ? combinedText.slice(lastNewlineIndex + 1)
          : combinedText

      if (!completeText) {
        await yieldToEventLoop()
        continue
      }

      const lines = completeText.split('\n')
      for (const rawLineText of lines) {
        if (task.canceled) {
          break
        }

        processedLineCount += 1
        const rawLine = trimLineEnding(rawLineText)
        const parsedLine = parseEverQuestLogLineWithTimestamp(rawLine)

        if (!parsedLine) {
          continue
        }

        if (parsedLine.timestampMs < request.startMs) {
          continue
        }

        if (parsedLine.timestampMs > request.endMs) {
          return { matchCount, truncated }
        }

        if (matcher(parsedLine.text)) {
          matchCount += 1
          this.sendLogSearchMatch({
            characterName: logFile.characterName,
            index: matchCount - 1,
            rawLine,
            searchId: request.searchId,
            serverName: logFile.serverName,
            text: parsedLine.text,
            timestamp: parsedLine.timestamp,
            timestampMs: parsedLine.timestampMs,
          })

          if (matchCount >= logSearchMaxMatches) {
            truncated = true
            return { matchCount, truncated }
          }
        }

        if (processedLineCount % logSearchYieldLineInterval === 0) {
          await yieldToEventLoop()
        }
      }

      await yieldToEventLoop()
    }

    if (pendingText && !task.canceled) {
      const rawLine = trimLineEnding(pendingText)
      const parsedLine = parseEverQuestLogLineWithTimestamp(rawLine)
      if (
        parsedLine &&
        parsedLine.timestampMs >= request.startMs &&
        parsedLine.timestampMs <= request.endMs &&
        matcher(parsedLine.text)
      ) {
        matchCount += 1
        this.sendLogSearchMatch({
          characterName: logFile.characterName,
          index: matchCount - 1,
          rawLine,
          searchId: request.searchId,
          serverName: logFile.serverName,
          text: parsedLine.text,
          timestamp: parsedLine.timestamp,
          timestampMs: parsedLine.timestampMs,
        })
        truncated = matchCount >= logSearchMaxMatches
      }
    }

    return { matchCount, truncated }
  }

  private async findLogSearchStartOffset(
    logFile: EverQuestLogFile,
    searchFile: LogSearchFileSnapshot,
    startMs: number,
  ) {
    let low = 0
    let high = searchFile.endOffset

    for (let index = 0; index < logSearchMaxBinarySearchIterations; index += 1) {
      if (low >= high) {
        break
      }

      const midpoint = Math.floor((low + high) / 2)
      const probe = await this.readLineAtOrAfter(logFile, searchFile, midpoint)

      if (!probe) {
        if (high === midpoint) {
          break
        }
        high = midpoint
        continue
      }

      if (!probe.parsedLine) {
        const nextLow = Math.max(low + 1, probe.nextOffset)
        if (nextLow <= low || nextLow > high) {
          break
        }
        low = nextLow
        continue
      }

      if (probe.parsedLine.timestampMs < startMs) {
        const nextLow = Math.max(low + 1, probe.nextOffset)
        if (nextLow <= low) {
          break
        }
        low = nextLow
        continue
      }

      if (probe.lineStart >= high) {
        break
      }
      high = probe.lineStart
    }

    return low
  }

  private async readLineAtOrAfter(
    logFile: EverQuestLogFile,
    searchFile: LogSearchFileSnapshot,
    offset: number,
  ) {
    const safeOffset = Math.max(
      0,
      Math.min(searchFile.endOffset, Math.floor(offset)),
    )
    const chunkStart = safeOffset
    const chunkEnd = Math.min(
      searchFile.endOffset,
      chunkStart + logSearchProbeBytes,
    )
    const chunk = await this.readSearchFileText(
      logFile,
      searchFile,
      chunkStart,
      chunkEnd,
    )

    if (!chunk) {
      return null
    }

    let lineStartInChunk = 0
    if (chunkStart > 0) {
      const firstNewlineIndex = chunk.indexOf('\n')
      if (firstNewlineIndex < 0) {
        return null
      }
      lineStartInChunk = firstNewlineIndex + 1
    }

    if (lineStartInChunk >= chunk.length) {
      return null
    }

    const lineEndInChunk = chunk.indexOf('\n', lineStartInChunk)
    if (lineEndInChunk < 0 && chunkEnd < searchFile.endOffset) {
      return null
    }

    const rawLine = trimLineEnding(
      lineEndInChunk >= 0
        ? chunk.slice(lineStartInChunk, lineEndInChunk)
        : chunk.slice(lineStartInChunk),
    )
    const lineStart = chunkStart + lineStartInChunk
    const nextOffset =
      lineEndInChunk >= 0 ? chunkStart + lineEndInChunk + 1 : chunkEnd

    return {
      lineStart,
      nextOffset,
      parsedLine: parseEverQuestLogLineWithTimestamp(rawLine),
      rawLine,
    }
  }

  private async readSearchFileText(
    logFile: EverQuestLogFile,
    searchFile: LogSearchFileSnapshot,
    startOffset: number,
    endOffset: number,
  ) {
    for (let attempt = 0; attempt <= logSearchReadRetryCount; attempt += 1) {
      try {
        return await searchFile.file.slice(startOffset, endOffset).text()
      } catch (error) {
        if (
          !isNotReadableError(error) ||
          attempt >= logSearchReadRetryCount
        ) {
          throw error
        }

        console.warn(
          `[FileWatcher] log search file snapshot became unreadable; retrying searchIdRange=${startOffset}-${endOffset} file=${logFile.fileName} attempt=${attempt + 1}`,
          error,
        )

        const nextFile = await this.getLogFile(logFile)
        if (!nextFile) {
          throw new Error('Log file was not found while retrying search read.')
        }
        if (nextFile.size < endOffset) {
          throw new Error(
            'Log file became smaller while search was in progress.',
          )
        }

        searchFile.file = nextFile
      }
    }

    throw new Error('Unable to read log file.')
  }

  private async getSearchLogFile(request: StartLogSearchRequest) {
    const logs =
      this.cachedLogFiles.length > 0
        ? this.cachedLogFiles
        : await this.refreshLogCache(false)
    const characterName = normalizeSearchKey(request.characterName)
    const serverName = normalizeSearchKey(request.serverName)
    const logFile = logs.find(
      (candidate) =>
        normalizeSearchKey(candidate.characterName) === characterName &&
        normalizeSearchKey(candidate.serverName) === serverName,
    )

    if (!logFile) {
      throw new Error('No log file exists for that character and server.')
    }

    return logFile
  }

  private cancelActiveLogSearch() {
    if (this.activeLogSearch) {
      this.activeLogSearch.canceled = true
    }
  }

  private sendLogSearchMatch(message: LogSearchMatchMessage) {
    this.broker.send('file-watcher', 'client.log-search.match-found', message)
  }

  private sendLogSearchDone(message: LogSearchDoneMessage) {
    this.broker.send('file-watcher', 'client.log-search.done', message)
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

    this.broker.send('file-watcher', 'file-watcher.characters', {
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

function isStartLogSearchRequest(value: unknown): value is StartLogSearchRequest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<StartLogSearchRequest>

  return (
    typeof candidate.searchId === 'string' &&
    typeof candidate.characterName === 'string' &&
    typeof candidate.serverName === 'string' &&
    typeof candidate.startMs === 'number' &&
    Number.isFinite(candidate.startMs) &&
    typeof candidate.endMs === 'number' &&
    Number.isFinite(candidate.endMs) &&
    typeof candidate.query === 'string' &&
    typeof candidate.useRegex === 'boolean'
  )
}

function isCancelLogSearchRequest(
  value: unknown,
): value is { searchId: string } {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<{ searchId: string }>
  return typeof candidate.searchId === 'string'
}

function createLogSearchMatcher(query: string, useRegex: boolean) {
  if (query.length === 0) {
    throw new Error('Search text is required.')
  }

  if (useRegex) {
    const regex = new RegExp(query, 'i')
    return (text: string) => regex.test(text)
  }

  const normalizedQuery = query.toLocaleLowerCase()
  return (text: string) => text.toLocaleLowerCase().includes(normalizedQuery)
}

function parseEverQuestLogLineWithTimestamp(line: string) {
  const match =
    /^\[(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})]\s?(.*)$/.exec(
      line,
    )

  if (!match) {
    return null
  }

  const [, , monthName, dayText, hourText, minuteText, secondText, yearText, text] =
    match
  const monthIndex = monthNames.indexOf(monthName)
  if (monthIndex < 0) {
    return null
  }

  const timestampMs = new Date(
    Number(yearText),
    monthIndex,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
    Number(secondText),
  ).getTime()

  if (!Number.isFinite(timestampMs)) {
    return null
  }

  return {
    text,
    timestamp: line.slice(1, line.indexOf(']')),
    timestampMs,
  }
}

function trimLineEnding(line: string) {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function normalizeSearchKey(value: string) {
  return value.trim().toLocaleLowerCase()
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isNotReadableError(error: unknown) {
  return (
    error instanceof Error &&
    error.name === 'NotReadableError'
  )
}

const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

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
    if (handle.kind !== 'file' || !('getFile' in handle)) {
      continue
    }

    const fileHandle = handle as FileSystemFileHandleLike
    const logFile = parseEverQuestLogFileName(fileHandle.name)

    if (!logFile) {
      continue
    }

    const file = await fileHandle.getFile()

    logs.push({
      ...logFile,
      lastLogWriteMs: file.lastModified,
    })
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

function parseEverQuestLogFileName(
  fileName: string,
): Omit<EverQuestLogFile, 'lastLogWriteMs'> | null {
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
  const cutoffMs = Date.now() - stalePresenceLogFileMaxAgeMs

  logs.forEach((log) => {
    if (log.lastLogWriteMs < cutoffMs) {
      return
    }

    const key = getCharacterKey(log)
    const character = {
      active: activeCharacterKeys.has(key),
      characterName: log.characterName,
      lastLogWriteMs: log.lastLogWriteMs,
      serverName: log.serverName,
    }

    charactersByKey.set(key, character)
  })

  return [...charactersByKey.values()].sort(compareCharacters)
}

function getCharactersSignature(characters: EverQuestCharacter[]) {
  return characters
    .map((character) => {
      return `${getCharacterKey(character)}\0${character.active ? '1' : '0'}\0${character.lastLogWriteMs}`
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

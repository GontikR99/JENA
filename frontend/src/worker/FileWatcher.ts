import type {
  FileSystemDirectoryHandleLike,
  FileSystemHandleLike,
} from '../shared/fileSystemAccess'
import type { EverQuestLogFile } from '../shared/messages'
import { getDependency, type Deps } from './di'
import { MessageBroker } from './MessageBroker'

const watchIntervalMs = 100
const scanIntervalMs = 10

interface ScanTask {
  logFile: EverQuestLogFile
  offset: number
  pendingText: string
  timeoutId: ReturnType<typeof globalThis.setTimeout> | null
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
  private readonly unregister: () => void
  private readonly observers = new Set<FileWatcherObserver>()
  private readonly scanTasks = new Map<string, ScanTask>()
  private readonly watchedLogFileNames = new Set<string>()
  private isWatchRunning = false
  private watchTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null

  constructor(deps: Deps) {
    const broker = getDependency(deps, MessageBroker)

    this.unregister = broker.register('file-watcher', {
      setFileHandle: this.setFileHandle,
      enumerateLogs: this.enumerateLogs,
      startWatch: this.startWatch,
      stopWatch: this.stopWatch,
    })
  }

  dispose() {
    this.unregister()
    this.observers.clear()
    this.stopWatching()
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

    this.stopWatching()
    this.fileHandle = params.fileHandle
    this.watchedLogFileNames.clear()

    return {}
  }

  private readonly enumerateLogs = async () => {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      console.warn('[FileWatcher] no EverQuest directory handle is stored')
      return { logs: [] }
    }

    return {
      logs: await enumerateEverQuestLogs(everQuestDirectoryHandle),
    }
  }

  private readonly startWatch = () => {
    const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

    if (!everQuestDirectoryHandle) {
      console.warn('[FileWatcher] no EverQuest directory handle is stored')
      return {}
    }

    if (this.isWatchRunning) {
      return {}
    }

    this.isWatchRunning = true
    void this.runWatchCycle()

    return {}
  }

  private readonly stopWatch = () => {
    this.stopWatching()
    this.watchedLogFileNames.clear()

    return {}
  }

  private async runWatchCycle() {
    try {
      const everQuestDirectoryHandle = this.getEverQuestDirectoryHandle()

      if (!everQuestDirectoryHandle) {
        console.warn('[FileWatcher] no EverQuest directory handle is stored')
        return
      }

      const logs = await enumerateEverQuestLogs(everQuestDirectoryHandle)

      logs.forEach((logFile) => {
        if (this.watchedLogFileNames.has(logFile.fileName)) {
          return
        }

        this.watchedLogFileNames.add(logFile.fileName)
        void this.scanFile(logFile).catch((error: unknown) => {
          console.error('[FileWatcher] scan file failed', error)
        })
      })
    } catch (error) {
      console.error('[FileWatcher] watch cycle failed', error)
    } finally {
      this.scheduleNextWatchCycle()
    }
  }

  private scheduleNextWatchCycle() {
    if (!this.isWatchRunning) {
      return
    }

    this.watchTimeoutId = globalThis.setTimeout(() => {
      this.watchTimeoutId = null
      void this.runWatchCycle()
    }, watchIntervalMs)
  }

  private readonly scanFile = async (logFile: EverQuestLogFile) => {
    if (this.scanTasks.has(logFile.fileName)) {
      return
    }

    const file = await this.getLogFile(logFile)

    if (!file) {
      console.warn('[FileWatcher] log file was not found', logFile.fileName)
      return
    }

    const scanTask: ScanTask = {
      logFile,
      offset: file.size,
      pendingText: '',
      timeoutId: null,
    }

    this.scanTasks.set(logFile.fileName, scanTask)
    this.scheduleNextScanCycle(scanTask)
  }

  private async runScanCycle(scanTask: ScanTask) {
    if (!this.scanTasks.has(scanTask.logFile.fileName)) {
      return
    }

    try {
      const file = await this.getLogFile(scanTask.logFile)

      if (!file) {
        console.warn(
          '[FileWatcher] log file disappeared',
          scanTask.logFile.fileName,
        )
        this.stopScanTask(scanTask.logFile.fileName)
        return
      }

      if (file.size < scanTask.offset) {
        scanTask.offset = file.size
        scanTask.pendingText = ''
        return
      }

      if (file.size === scanTask.offset) {
        return
      }

      const text = await file.slice(scanTask.offset).text()

      scanTask.offset = file.size
      this.reportCompleteLines(scanTask, text)
    } catch (error) {
      console.error('[FileWatcher] scan cycle failed', error)
    } finally {
      this.scheduleNextScanCycle(scanTask)
    }
  }

  private scheduleNextScanCycle(scanTask: ScanTask) {
    if (!this.scanTasks.has(scanTask.logFile.fileName)) {
      return
    }

    scanTask.timeoutId = globalThis.setTimeout(() => {
      scanTask.timeoutId = null
      void this.runScanCycle(scanTask)
    }, scanIntervalMs)
  }

  private reportCompleteLines(scanTask: ScanTask, text: string) {
    const combinedText = `${scanTask.pendingText}${text}`
    const lastNewlineIndex = combinedText.lastIndexOf('\n')

    if (lastNewlineIndex === -1) {
      scanTask.pendingText = combinedText
      return
    }

    scanTask.pendingText = combinedText.slice(lastNewlineIndex + 1)

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
          characterName: scanTask.logFile.characterName,
          serverName: scanTask.logFile.serverName,
          text: parsedLine.text,
          timestamp: parsedLine.timestamp,
        })
      })
  }

  private reportLogLine(record: EverQuestLogLineRecord) {
    this.observers.forEach((observer) => {
      try {
        observer.onLogLine(record)
      } catch (error) {
        console.error('[FileWatcher] observer failed', error)
      }
    })
  }

  private stopWatching() {
    this.isWatchRunning = false

    if (this.watchTimeoutId) {
      globalThis.clearTimeout(this.watchTimeoutId)
      this.watchTimeoutId = null
    }

    this.scanTasks.forEach((scanTask) => {
      if (scanTask.timeoutId) {
        globalThis.clearTimeout(scanTask.timeoutId)
      }
    })
    this.scanTasks.clear()
  }

  private stopScanTask(fileName: string) {
    const scanTask = this.scanTasks.get(fileName)

    if (!scanTask) {
      return
    }

    if (scanTask.timeoutId) {
      globalThis.clearTimeout(scanTask.timeoutId)
    }

    this.scanTasks.delete(fileName)
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
): value is { fileHandle: FileSystemHandleLike } {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<{ fileHandle: FileSystemHandleLike }>

  return (
    !!candidate.fileHandle &&
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

  return logs
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

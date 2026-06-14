import { Parser } from 'htmlparser2'
import { Unzip, UnzipInflate } from 'fflate'
import type {
  JenaSpeechAction,
  JenaTextAction,
  JenaTimerAction,
  JenaTimerStartBehavior,
  JenaTrigger,
  JenaTriggerTimer,
  JenaTriggerTimerType,
} from '../../shared/triggers'

const yieldByteInterval = 16 * 1024
const progressByteInterval = 128 * 1024
const shareDataFileName = 'ShareData.xml'

export type GinaImportProgressCallback = (
  bytesProcessed: number,
  bytesTotal: number,
  elapsedMs: number,
  estimatedMs: number,
) => void

export interface ParseGinaPackageOptions {
  author?: string
  onProgress?: GinaImportProgressCallback
}

interface RawGroup {
  name: string
}

interface RawTimerAction {
  useText: boolean
  displayText: string
  useTextToVoice: boolean
  interruptSpeech: boolean
  textToVoiceText: string
  playMediaFile: boolean
}

interface RawEarlyEnder {
  earlyEndText: string
  enableRegex: boolean
}

interface RawTrigger {
  name: string
  triggerText: string
  comments: string
  enableRegex: boolean
  useText: boolean
  displayText: string
  copyToClipboard: boolean
  clipboardText: string
  useTextToVoice: boolean
  interruptSpeech: boolean
  textToVoiceText: string
  playMediaFile: boolean
  timerType: string
  timerName: string
  restartBasedOnTimerName: boolean
  timerMillisecondDuration: number
  timerDuration: number
  timerStartBehavior: string
  timerEndingTime: number
  useTimerEnding: boolean
  useTimerEnded: boolean
  category: string
  timerEndingTrigger: RawTimerAction | null
  timerEndedTrigger: RawTimerAction | null
  timerEarlyEnders: RawEarlyEnder[]
  groupPath: string[]
}

type TimerActionKind = 'ending' | 'ended'

export async function parseGinaPackageFile(
  file: File,
  options: ParseGinaPackageOptions = {},
): Promise<JenaTrigger[]> {
  const startedAt = performance.now()
  const zipBytesTotal = file.size
  let zipBytesProcessed = 0
  let nextProgressBytes = progressByteInterval

  const emitProgress = () => {
    options.onProgress?.(
      zipBytesProcessed,
      zipBytesTotal,
      performance.now() - startedAt,
      estimateRemainingMs(startedAt, zipBytesProcessed, zipBytesTotal),
    )
  }

  emitProgress()

  const xmlChunkQueue: Uint8Array[] = []
  const xmlParser = new GinaXmlTriggerParser(options.author ?? '')
  const textDecoder = new TextDecoder('utf-8', { fatal: false })
  const unzip = new Unzip((entry) => {
    if (entry.name.endsWith('/')) {
      return
    }

    xmlParser.observePackageFile(entry.name)

    if (entry.name !== shareDataFileName) {
      return
    }

    entry.ondata = (error, chunk) => {
      if (error) {
        xmlParser.fail(error)
        return
      }

      xmlChunkQueue.push(chunk)
    }
    entry.start()
  })

  unzip.register(UnzipInflate)

  const reader = file.stream().getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      for (let offset = 0; offset < value.length; offset += yieldByteInterval) {
        const chunk = value.subarray(offset, offset + yieldByteInterval)
        unzip.push(chunk, false)
        zipBytesProcessed += chunk.length

        await drainXmlChunkQueue(xmlChunkQueue, textDecoder, xmlParser)

        if (zipBytesProcessed >= nextProgressBytes) {
          emitProgress()
          nextProgressBytes += progressByteInterval
        }

        await yieldToEventLoop()
      }
    }

    unzip.push(new Uint8Array(), true)
    await drainXmlChunkQueue(xmlChunkQueue, textDecoder, xmlParser)

    const finalText = textDecoder.decode()
    if (finalText.length > 0) {
      xmlParser.write(finalText)
    }
    xmlParser.end()

    zipBytesProcessed = zipBytesTotal
    emitProgress()

    return await xmlParser.getTriggers()
  } finally {
    reader.releaseLock()
  }
}

async function drainXmlChunkQueue(
  queue: Uint8Array[],
  decoder: TextDecoder,
  xmlParser: GinaXmlTriggerParser,
) {
  while (queue.length > 0) {
    const chunk = queue.shift()

    if (!chunk) {
      continue
    }

    for (let offset = 0; offset < chunk.length; offset += yieldByteInterval) {
      const slice = chunk.subarray(offset, offset + yieldByteInterval)
      const text = decoder.decode(slice, { stream: true })

      if (text.length > 0) {
        xmlParser.write(text)
      }

      await yieldToEventLoop()
    }
  }
}

class GinaXmlTriggerParser {
  private readonly author: string
  private readonly groupStack: RawGroup[] = []
  private readonly textStack: string[] = []
  private readonly tagStack: string[] = []
  private readonly rawTriggers: RawTrigger[] = []
  private readonly packageFiles: string[] = []
  private readonly parser: Parser

  private currentTrigger: RawTrigger | null = null
  private currentTimerActionKind: TimerActionKind | null = null
  private currentEarlyEnder: RawEarlyEnder | null = null
  private seenShareData = false
  private parseError: Error | null = null

  constructor(author: string) {
    this.author = author
    this.parser = new Parser(
      {
        onclosetag: (name) => this.handleCloseTag(name),
        onerror: (error) => this.fail(error),
        onopentag: (name) => this.handleOpenTag(name),
        ontext: (text) => this.appendText(text),
      },
      {
        lowerCaseTags: false,
        recognizeSelfClosing: true,
        xmlMode: true,
      },
    )
  }

  observePackageFile(fileName: string) {
    this.packageFiles.push(fileName)
    if (fileName === shareDataFileName) {
      this.seenShareData = true
    }
  }

  write(text: string) {
    this.throwIfFailed()
    this.parser.write(text)
    this.throwIfFailed()
  }

  end() {
    this.throwIfFailed()
    this.parser.end()
    this.throwIfFailed()

    const dataFiles = this.packageFiles.filter((fileName) => {
      return !fileName.endsWith('/')
    })

    if (!this.seenShareData) {
      throw new Error(`GINA package does not contain ${shareDataFileName}.`)
    }

    if (dataFiles.length !== 1) {
      throw new Error('GINA package must contain exactly one file.')
    }
  }

  async getTriggers() {
    const triggersById = new Map<string, JenaTrigger>()

    for (const rawTrigger of this.rawTriggers) {
      const trigger = toJenaTrigger(rawTrigger, this.author)
      trigger.id = await createTriggerId(trigger)

      if (!triggersById.has(trigger.id)) {
        triggersById.set(trigger.id, trigger)
      }

      await yieldToEventLoop()
    }

    return [...triggersById.values()]
  }

  fail(error: Error) {
    this.parseError = error
  }

  private handleOpenTag(name: string) {
    this.tagStack.push(name)
    this.textStack.push('')

    if (name === 'TriggerGroup') {
      this.groupStack.push({ name: '' })
      return
    }

    if (name === 'Trigger' && this.parentTag() === 'Triggers') {
      this.currentTrigger = createRawTrigger(this.currentGroupPath())
      return
    }

    if (!this.currentTrigger) {
      return
    }

    if (name === 'TimerEndingTrigger') {
      this.currentTimerActionKind = 'ending'
      this.currentTrigger.timerEndingTrigger = createRawTimerAction()
      return
    }

    if (name === 'TimerEndedTrigger') {
      this.currentTimerActionKind = 'ended'
      this.currentTrigger.timerEndedTrigger = createRawTimerAction()
      return
    }

    if (name === 'EarlyEnder') {
      this.currentEarlyEnder = {
        earlyEndText: '',
        enableRegex: false,
      }
    }
  }

  private handleCloseTag(name: string) {
    const text = (this.textStack.pop() ?? '').trim()
    const parent = this.parentTag()

    if (this.currentTrigger) {
      this.assignTriggerText(name, parent, text)
    } else if (name === 'Name' && parent === 'TriggerGroup') {
      const group = this.groupStack.at(-1)
      if (group) {
        group.name = text
      }
    }

    if (name === 'EarlyEnder') {
      if (this.currentTrigger && this.currentEarlyEnder) {
        this.currentTrigger.timerEarlyEnders.push(this.currentEarlyEnder)
      }
      this.currentEarlyEnder = null
    } else if (name === 'TimerEndingTrigger') {
      this.currentTimerActionKind = null
    } else if (name === 'TimerEndedTrigger') {
      this.currentTimerActionKind = null
    } else if (name === 'Trigger') {
      if (this.currentTrigger) {
        this.rawTriggers.push(this.currentTrigger)
      }
      this.currentTrigger = null
    } else if (name === 'TriggerGroup') {
      this.groupStack.pop()
    }

    this.tagStack.pop()
  }

  private appendText(text: string) {
    const textIndex = this.textStack.length - 1
    if (textIndex >= 0) {
      this.textStack[textIndex] += text
    }
  }

  private assignTriggerText(name: string, parent: string | null, text: string) {
    if (!this.currentTrigger) {
      return
    }

    if (this.currentEarlyEnder && parent === 'EarlyEnder') {
      assignEarlyEnderText(this.currentEarlyEnder, name, text)
      return
    }

    const timerAction = this.currentTimerAction()
    if (timerAction && isTimerActionParent(parent)) {
      assignTimerActionText(timerAction, name, text)
      return
    }

    if (parent !== 'Trigger') {
      return
    }

    assignTriggerText(this.currentTrigger, name, text)
  }

  private currentTimerAction() {
    if (!this.currentTrigger || !this.currentTimerActionKind) {
      return null
    }

    return this.currentTimerActionKind === 'ending'
      ? this.currentTrigger.timerEndingTrigger
      : this.currentTrigger.timerEndedTrigger
  }

  private currentGroupPath() {
    return this.groupStack
      .map((group) => group.name)
      .filter((name) => name.length > 0)
  }

  private parentTag() {
    return this.tagStack.length > 1
      ? this.tagStack[this.tagStack.length - 2]
      : null
  }

  private throwIfFailed() {
    if (this.parseError) {
      throw this.parseError
    }
  }
}

function createRawTrigger(groupPath: string[]): RawTrigger {
  return {
    name: '',
    triggerText: '',
    comments: '',
    enableRegex: false,
    useText: false,
    displayText: '',
    copyToClipboard: false,
    clipboardText: '',
    useTextToVoice: false,
    interruptSpeech: false,
    textToVoiceText: '',
    playMediaFile: false,
    timerType: 'NoTimer',
    timerName: '',
    restartBasedOnTimerName: false,
    timerMillisecondDuration: 0,
    timerDuration: 0,
    timerStartBehavior: 'StartNewTimer',
    timerEndingTime: 0,
    useTimerEnding: false,
    useTimerEnded: false,
    category: '',
    timerEndingTrigger: null,
    timerEndedTrigger: null,
    timerEarlyEnders: [],
    groupPath,
  }
}

function createRawTimerAction(): RawTimerAction {
  return {
    useText: false,
    displayText: '',
    useTextToVoice: false,
    interruptSpeech: false,
    textToVoiceText: '',
    playMediaFile: false,
  }
}

function assignTriggerText(trigger: RawTrigger, name: string, text: string) {
  switch (name) {
    case 'Name':
      trigger.name = text
      break
    case 'TriggerText':
      trigger.triggerText = text
      break
    case 'Comments':
      trigger.comments = text
      break
    case 'EnableRegex':
      trigger.enableRegex = parseGinaBoolean(text)
      break
    case 'UseText':
      trigger.useText = parseGinaBoolean(text)
      break
    case 'DisplayText':
      trigger.displayText = text
      break
    case 'CopyToClipboard':
      trigger.copyToClipboard = parseGinaBoolean(text)
      break
    case 'ClipboardText':
      trigger.clipboardText = text
      break
    case 'UseTextToVoice':
      trigger.useTextToVoice = parseGinaBoolean(text)
      break
    case 'InterruptSpeech':
      trigger.interruptSpeech = parseGinaBoolean(text)
      break
    case 'TextToVoiceText':
      trigger.textToVoiceText = text
      break
    case 'PlayMediaFile':
      trigger.playMediaFile = parseGinaBoolean(text)
      break
    case 'TimerType':
      trigger.timerType = text
      break
    case 'TimerName':
      trigger.timerName = text
      break
    case 'RestartBasedOnTimerName':
      trigger.restartBasedOnTimerName = parseGinaBoolean(text)
      break
    case 'TimerMillisecondDuration':
      trigger.timerMillisecondDuration = parseGinaInteger(text)
      break
    case 'TimerDuration':
      trigger.timerDuration = parseGinaInteger(text)
      break
    case 'TimerStartBehavior':
      trigger.timerStartBehavior = text
      break
    case 'TimerEndingTime':
      trigger.timerEndingTime = parseGinaInteger(text)
      break
    case 'UseTimerEnding':
      trigger.useTimerEnding = parseGinaBoolean(text)
      break
    case 'UseTimerEnded':
      trigger.useTimerEnded = parseGinaBoolean(text)
      break
    case 'Category':
      trigger.category = text
      break
  }
}

function assignTimerActionText(
  timerAction: RawTimerAction,
  name: string,
  text: string,
) {
  switch (name) {
    case 'UseText':
      timerAction.useText = parseGinaBoolean(text)
      break
    case 'DisplayText':
      timerAction.displayText = text
      break
    case 'UseTextToVoice':
      timerAction.useTextToVoice = parseGinaBoolean(text)
      break
    case 'InterruptSpeech':
      timerAction.interruptSpeech = parseGinaBoolean(text)
      break
    case 'TextToVoiceText':
      timerAction.textToVoiceText = text
      break
    case 'PlayMediaFile':
      timerAction.playMediaFile = parseGinaBoolean(text)
      break
  }
}

function assignEarlyEnderText(
  earlyEnder: RawEarlyEnder,
  name: string,
  text: string,
) {
  switch (name) {
    case 'EarlyEndText':
      earlyEnder.earlyEndText = text
      break
    case 'EnableRegex':
      earlyEnder.enableRegex = parseGinaBoolean(text)
      break
  }
}

function toJenaTrigger(rawTrigger: RawTrigger, author: string): JenaTrigger {
  return {
    id: '',
    name: rawTrigger.name,
    author,
    comments: rawTrigger.comments,
    category: rawTrigger.category,
    groupPath: rawTrigger.groupPath,
    match: toRegex(rawTrigger.triggerText, rawTrigger.enableRegex),
    actions: {
      display: createTextAction(rawTrigger.useText, rawTrigger.displayText),
      speech: createSpeechAction(
        rawTrigger.useTextToVoice,
        rawTrigger.textToVoiceText,
        rawTrigger.interruptSpeech,
      ),
      clipboard: {
        enabled: rawTrigger.copyToClipboard,
        text: rawTrigger.clipboardText,
      },
    },
    timer: createTimer(rawTrigger),
  }
}

function createTimer(rawTrigger: RawTrigger): JenaTriggerTimer | null {
  const timerType = toTimerType(rawTrigger.timerType)
  if (!timerType) {
    return null
  }

  return {
    type: timerType,
    name: rawTrigger.timerName,
    durationMs: getTimerDurationMs(timerType, rawTrigger),
    startBehavior: toTimerStartBehavior(rawTrigger),
    warningSeconds: rawTrigger.timerEndingTime,
    warningAction:
      rawTrigger.useTimerEnding && rawTrigger.timerEndingTrigger
        ? toTimerAction(rawTrigger.timerEndingTrigger)
        : null,
    endedAction:
      rawTrigger.useTimerEnded && rawTrigger.timerEndedTrigger
        ? toTimerAction(rawTrigger.timerEndedTrigger)
        : null,
    earlyEnders: rawTrigger.timerEarlyEnders.map((earlyEnder) => {
      return toRegex(earlyEnder.earlyEndText, earlyEnder.enableRegex)
    }),
  }
}

function toTimerAction(rawTimerAction: RawTimerAction): JenaTimerAction {
  return {
    display: createTextAction(rawTimerAction.useText, rawTimerAction.displayText),
    speech: createSpeechAction(
      rawTimerAction.useTextToVoice,
      rawTimerAction.textToVoiceText,
      rawTimerAction.interruptSpeech,
    ),
  }
}

function createTextAction(enabled: boolean, text: string): JenaTextAction {
  return {
    enabled,
    text,
  }
}

function createSpeechAction(
  enabled: boolean,
  text: string,
  interrupt: boolean,
): JenaSpeechAction {
  return {
    enabled,
    text,
    interrupt,
  }
}

function toTimerType(timerType: string): JenaTriggerTimerType | null {
  switch (timerType) {
    case 'Timer':
      return 'countdown'
    case 'RepeatingTimer':
      return 'repeating'
    case 'Stopwatch':
      return 'stopwatch'
    default:
      return null
  }
}

function toTimerStartBehavior(rawTrigger: RawTrigger): JenaTimerStartBehavior {
  switch (rawTrigger.timerStartBehavior) {
    case 'StartNewTimer':
      return 'startNew'
    case 'RestartTimer':
      return rawTrigger.restartBasedOnTimerName
        ? 'restartMatchingTimerName'
        : 'restart'
    case 'IgnoreIfRunning':
      return 'ignoreIfRunning'
    default:
      return 'ignoreIfRunning'
  }
}

function getTimerDurationMs(
  timerType: JenaTriggerTimerType,
  rawTrigger: RawTrigger,
) {
  if (rawTrigger.timerMillisecondDuration > 0) {
    return rawTrigger.timerMillisecondDuration
  }

  if (rawTrigger.timerDuration > 0) {
    return rawTrigger.timerDuration * 1000
  }

  return timerType === 'stopwatch' ? 60_000 : 0
}

function toRegex(text: string, isRegex: boolean) {
  return isRegex ? text : escapeRegExp(text)
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function createTriggerId(trigger: JenaTrigger) {
  const canonicalTrigger = {
    name: trigger.name,
    author: trigger.author,
    comments: trigger.comments,
    category: trigger.category,
    groupPath: trigger.groupPath,
    match: trigger.match,
    actions: trigger.actions,
    timer: trigger.timer,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalTrigger))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

function parseGinaBoolean(text: string) {
  return text.trim().toLowerCase() === 'true'
}

function parseGinaInteger(text: string) {
  const value = Number.parseInt(text, 10)
  return Number.isFinite(value) ? value : 0
}

function isTimerActionParent(parent: string | null) {
  return parent === 'TimerEndingTrigger' || parent === 'TimerEndedTrigger'
}

function estimateRemainingMs(
  startedAt: number,
  bytesProcessed: number,
  bytesTotal: number,
) {
  if (bytesProcessed <= 0 || bytesProcessed >= bytesTotal) {
    return 0
  }

  const elapsedMs = performance.now() - startedAt
  return (elapsedMs / bytesProcessed) * (bytesTotal - bytesProcessed)
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

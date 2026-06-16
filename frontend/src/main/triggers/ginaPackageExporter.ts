import { strToU8, zip } from 'fflate'
import type {
  JenaTimerAction,
  JenaTrigger,
  JenaTriggerTimer,
  JenaTriggerTimerType,
} from '../../shared/triggers'

const yieldByteInterval = 16 * 1024
const progressByteInterval = 128 * 1024
const shareDataFileName = 'ShareData.xml'
type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type GinaExportProgressCallback = (
  bytesProcessed: number,
  bytesTotal: number,
  elapsedMs: number,
  estimatedMs: number,
) => void

export interface ExportGinaPackageOptions {
  compressionLevel?: CompressionLevel
  emptyGroupName?: string
  modifiedAt?: Date
  onProgress?: GinaExportProgressCallback
}

interface GroupNode {
  childGroups: GroupNode[]
  childGroupsByName: Map<string, GroupNode>
  name: string
  triggers: JenaTrigger[]
}

export async function exportGinaPackageFile(
  triggers: readonly JenaTrigger[],
  options: ExportGinaPackageOptions = {},
): Promise<Uint8Array> {
  const startedAt = performance.now()
  const groupTree = buildGroupTree(
    triggers,
    options.emptyGroupName?.trim() || 'Default',
  )
  const modifiedAt = formatGinaDateTime(options.modifiedAt ?? new Date())
  const bytesTotal = countXmlBytes(groupTree, modifiedAt)
  let bytesProcessed = 0
  let nextProgressBytes = progressByteInterval

  const emitProgress = () => {
    options.onProgress?.(
      bytesProcessed,
      bytesTotal,
      performance.now() - startedAt,
      estimateRemainingMs(startedAt, bytesProcessed, bytesTotal),
    )
  }

  emitProgress()

  const chunks: Uint8Array[] = []

  for (const line of generateShareDataXml(groupTree, modifiedAt)) {
    const chunk = strToU8(line)
    chunks.push(chunk)
    bytesProcessed += chunk.length

    if (bytesProcessed >= nextProgressBytes) {
      emitProgress()
      nextProgressBytes += progressByteInterval
    }

    if (bytesProcessed % yieldByteInterval < chunk.length) {
      await yieldToEventLoop()
    }
  }

  emitProgress()
  const xmlBytes = concatUint8Arrays(chunks, bytesTotal)
  const zipped = await zipShareDataXml(
    xmlBytes,
    options.compressionLevel ?? 6,
  )

  bytesProcessed = bytesTotal
  emitProgress()

  return zipped
}

function buildGroupTree(
  triggers: readonly JenaTrigger[],
  emptyGroupName: string,
) {
  const root: GroupNode = createGroupNode('')

  triggers.forEach((trigger) => {
    const groupPath =
      trigger.groupPath.length > 0 ? trigger.groupPath : [emptyGroupName]
    let currentGroup = root

    groupPath.forEach((groupName) => {
      let childGroup = currentGroup.childGroupsByName.get(groupName)

      if (!childGroup) {
        childGroup = createGroupNode(groupName)
        currentGroup.childGroups.push(childGroup)
        currentGroup.childGroupsByName.set(groupName, childGroup)
      }

      currentGroup = childGroup
    })

    currentGroup.triggers.push(trigger)
  })

  return root
}

function createGroupNode(name: string): GroupNode {
  return {
    childGroups: [],
    childGroupsByName: new Map(),
    name,
    triggers: [],
  }
}

function countXmlBytes(groupTree: GroupNode, modifiedAt: string) {
  let totalBytes = 0

  for (const line of generateShareDataXml(groupTree, modifiedAt)) {
    totalBytes += strToU8(line).length
  }

  return totalBytes
}

function* generateShareDataXml(
  groupTree: GroupNode,
  modifiedAt: string,
): Generator<string> {
  yield '<?xml version="1.0" encoding="utf-8"?>\n'
  yield '<SharedData>\n'
  yield '  <TriggerGroups>\n'

  for (const group of groupTree.childGroups) {
    yield* generateTriggerGroupXml(group, 2, modifiedAt)
  }

  yield '  </TriggerGroups>\n'
  yield '</SharedData>'
}

function* generateTriggerGroupXml(
  group: GroupNode,
  indentLevel: number,
  modifiedAt: string,
): Generator<string> {
  const indent = getIndent(indentLevel)

  yield `${indent}<TriggerGroup>\n`
  yield xmlElement('Name', group.name, indentLevel + 1)
  yield xmlElement('Comments', '', indentLevel + 1)
  yield xmlElement('SelfCommented', 'False', indentLevel + 1)
  yield xmlElement('GroupId', '0', indentLevel + 1)
  yield xmlElement('EnableByDefault', 'False', indentLevel + 1)

  if (group.childGroups.length > 0) {
    yield `${getIndent(indentLevel + 1)}<TriggerGroups>\n`
    for (const childGroup of group.childGroups) {
      yield* generateTriggerGroupXml(childGroup, indentLevel + 2, modifiedAt)
    }
    yield `${getIndent(indentLevel + 1)}</TriggerGroups>\n`
  }

  if (group.triggers.length > 0) {
    yield `${getIndent(indentLevel + 1)}<Triggers>\n`
    for (const trigger of group.triggers) {
      yield* generateTriggerXml(trigger, indentLevel + 2, modifiedAt)
    }
    yield `${getIndent(indentLevel + 1)}</Triggers>\n`
  }

  yield `${indent}</TriggerGroup>\n`
}

function* generateTriggerXml(
  trigger: JenaTrigger,
  indentLevel: number,
  modifiedAt: string,
): Generator<string> {
  const indent = getIndent(indentLevel)
  const timer = trigger.timer

  yield `${indent}<Trigger>\n`
  yield xmlElement('Name', trigger.name, indentLevel + 1)
  yield xmlElement('TriggerText', trigger.match.text, indentLevel + 1)
  yield xmlElement('Comments', trigger.comments, indentLevel + 1)
  yield xmlBooleanElement('EnableRegex', trigger.match.isRegex, indentLevel + 1)
  yield xmlBooleanElement(
    'UseText',
    trigger.actions.display.enabled,
    indentLevel + 1,
  )
  yield xmlElement('DisplayText', trigger.actions.display.text, indentLevel + 1)
  yield xmlBooleanElement(
    'CopyToClipboard',
    trigger.actions.clipboard.enabled,
    indentLevel + 1,
  )
  yield xmlElement(
    'ClipboardText',
    trigger.actions.clipboard.text,
    indentLevel + 1,
  )
  yield xmlBooleanElement(
    'UseTextToVoice',
    trigger.actions.speech.enabled,
    indentLevel + 1,
  )
  yield xmlBooleanElement(
    'InterruptSpeech',
    trigger.actions.speech.interrupt,
    indentLevel + 1,
  )
  yield xmlElement(
    'TextToVoiceText',
    trigger.actions.speech.text,
    indentLevel + 1,
  )
  yield xmlElement('PlayMediaFile', 'False', indentLevel + 1)
  yield xmlElement('TimerType', toGinaTimerType(timer?.type ?? null), indentLevel + 1)
  yield xmlElement('TimerName', timer?.name ?? '', indentLevel + 1)
  yield xmlBooleanElement(
    'RestartBasedOnTimerName',
    timer?.startBehavior === 'restartMatchingTimerName',
    indentLevel + 1,
  )
  yield xmlElement(
    'TimerMillisecondDuration',
    timer ? String(Math.max(0, Math.trunc(timer.durationMs))) : '0',
    indentLevel + 1,
  )
  yield xmlElement(
    'TimerDuration',
    timer ? String(Math.floor(Math.max(0, timer.durationMs) / 1000)) : '0',
    indentLevel + 1,
  )
  yield xmlElement('TimerVisibleDuration', '0', indentLevel + 1)
  yield xmlElement(
    'TimerStartBehavior',
    toGinaTimerStartBehavior(timer),
    indentLevel + 1,
  )
  yield xmlElement(
    'TimerEndingTime',
    timer?.warningAction ? String(Math.max(0, timer.warningSeconds)) : '0',
    indentLevel + 1,
  )
  yield xmlBooleanElement('UseTimerEnding', !!timer?.warningAction, indentLevel + 1)

  if (timer?.warningAction) {
    yield* generateTimerActionXml(
      'TimerEndingTrigger',
      timer.warningAction,
      indentLevel + 1,
    )
  }

  yield xmlBooleanElement('UseTimerEnded', !!timer?.endedAction, indentLevel + 1)

  if (timer?.endedAction) {
    yield* generateTimerActionXml(
      'TimerEndedTrigger',
      timer.endedAction,
      indentLevel + 1,
    )
  }

  yield xmlElement('UseCounterResetTimer', 'False', indentLevel + 1)
  yield xmlElement('CounterResetDuration', '0', indentLevel + 1)
  yield xmlElement('Category', trigger.category || 'Default', indentLevel + 1)
  yield xmlElement('Modified', modifiedAt, indentLevel + 1)
  yield xmlElement('UseFastCheck', 'True', indentLevel + 1)
  yield* generateTimerEarlyEndersXml(timer, indentLevel + 1)
  yield `${indent}</Trigger>\n`
}

function* generateTimerActionXml(
  tagName: string,
  action: JenaTimerAction,
  indentLevel: number,
): Generator<string> {
  const indent = getIndent(indentLevel)

  yield `${indent}<${tagName}>\n`
  yield xmlBooleanElement('UseText', action.display.enabled, indentLevel + 1)
  yield xmlElement('DisplayText', action.display.text, indentLevel + 1)
  yield xmlBooleanElement(
    'UseTextToVoice',
    action.speech.enabled,
    indentLevel + 1,
  )
  yield xmlBooleanElement('InterruptSpeech', action.speech.interrupt, indentLevel + 1)
  yield xmlElement('TextToVoiceText', action.speech.text, indentLevel + 1)
  yield xmlElement('PlayMediaFile', 'False', indentLevel + 1)
  yield `${indent}</${tagName}>\n`
}

function* generateTimerEarlyEndersXml(
  timer: JenaTriggerTimer | null,
  indentLevel: number,
): Generator<string> {
  const indent = getIndent(indentLevel)
  const earlyEnders = timer?.earlyEnders ?? []

  if (earlyEnders.length === 0) {
    yield `${indent}<TimerEarlyEnders />\n`
    return
  }

  yield `${indent}<TimerEarlyEnders>\n`
  for (const earlyEnder of earlyEnders) {
    yield `${getIndent(indentLevel + 1)}<EarlyEnder>\n`
    yield xmlElement('EarlyEndText', earlyEnder.text, indentLevel + 2)
    yield xmlBooleanElement('EnableRegex', earlyEnder.isRegex, indentLevel + 2)
    yield `${getIndent(indentLevel + 1)}</EarlyEnder>\n`
  }
  yield `${indent}</TimerEarlyEnders>\n`
}

function toGinaTimerType(timerType: JenaTriggerTimerType | null) {
  switch (timerType) {
    case 'countdown':
      return 'Timer'
    case 'repeating':
      return 'RepeatingTimer'
    case 'stopwatch':
      return 'Stopwatch'
    default:
      return 'NoTimer'
  }
}

function toGinaTimerStartBehavior(timer: JenaTriggerTimer | null) {
  switch (timer?.startBehavior) {
    case 'ignoreIfRunning':
      return 'IgnoreIfRunning'
    case 'restart':
    case 'restartMatchingTimerName':
      return 'RestartTimer'
    case 'startNew':
    default:
      return 'StartNewTimer'
  }
}

function xmlBooleanElement(name: string, value: boolean, indentLevel: number) {
  return xmlElement(name, value ? 'True' : 'False', indentLevel)
}

function xmlElement(name: string, value: string, indentLevel: number) {
  return `${getIndent(indentLevel)}<${name}>${escapeXmlText(value)}</${name}>\n`
}

function escapeXmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function getIndent(indentLevel: number) {
  return '  '.repeat(indentLevel)
}

function formatGinaDateTime(date: Date) {
  return [
    date.getFullYear(),
    '-',
    padDatePart(date.getMonth() + 1),
    '-',
    padDatePart(date.getDate()),
    'T',
    padDatePart(date.getHours()),
    ':',
    padDatePart(date.getMinutes()),
    ':',
    padDatePart(date.getSeconds()),
  ].join('')
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function concatUint8Arrays(chunks: Uint8Array[], totalLength: number) {
  const result = new Uint8Array(totalLength)
  let offset = 0

  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.length
  })

  return result
}

function zipShareDataXml(
  xmlBytes: Uint8Array,
  compressionLevel: CompressionLevel,
) {
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(
      {
        [shareDataFileName]: xmlBytes,
      },
      {
        level: compressionLevel,
      },
      (error, data) => {
        if (error) {
          reject(error)
          return
        }

        resolve(data)
      },
    )
  })
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

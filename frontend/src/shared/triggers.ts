export type JenaTriggerId = string
export type JenaTriggerMatcher = string
export type JenaTimerEarlyEnder = string

export type JenaTriggerTimerType = 'countdown' | 'repeating' | 'stopwatch'

export type JenaTimerStartBehavior =
  | 'startNew'
  | 'restart'
  | 'restartMatchingTimerName'
  | 'ignoreIfRunning'

export interface JenaTrigger {
  id: JenaTriggerId
  name: string
  author: string
  comments: string
  category: string
  groupPath: string[]
  match: JenaTriggerMatcher
  actions: JenaTriggerActions
  timer: JenaTriggerTimer | null
}

export interface JenaTriggerActions {
  display: JenaTextAction
  speech: JenaSpeechAction
  clipboard: JenaClipboardAction
}

export interface JenaTextAction {
  enabled: boolean
  text: string
}

export interface JenaSpeechAction {
  enabled: boolean
  text: string
  interrupt: boolean
}

export interface JenaClipboardAction {
  enabled: boolean
  text: string
}

export interface JenaTriggerTimer {
  type: JenaTriggerTimerType
  name: string
  durationMs: number
  startBehavior: JenaTimerStartBehavior
  warningSeconds: number
  warningAction: JenaTimerAction | null
  endedAction: JenaTimerAction | null
  earlyEnders: JenaTimerEarlyEnder[]
}

export interface JenaTimerAction {
  display: JenaTextAction
  speech: JenaSpeechAction
}

export function createEmptyTrigger(): JenaTrigger {
  return {
    actions: {
      clipboard: createClipboardAction(),
      display: createTextAction(),
      speech: createSpeechAction(),
    },
    author: '',
    category: 'Default',
    comments: '',
    groupPath: [],
    id: 'draft-trigger',
    match: '',
    name: '',
    timer: null,
  }
}

export function createTextAction(): JenaTextAction {
  return {
    enabled: false,
    text: '',
  }
}

export function createClipboardAction(): JenaClipboardAction {
  return {
    enabled: false,
    text: '',
  }
}

export function createSpeechAction(): JenaSpeechAction {
  return {
    enabled: false,
    interrupt: false,
    text: '',
  }
}

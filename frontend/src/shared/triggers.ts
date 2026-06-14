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
  media: JenaMediaAction
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

export interface JenaMediaAction {
  enabled: boolean
  source: string | null
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
  media: JenaMediaAction
}

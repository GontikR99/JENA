import { createContentHashUuid } from './hashIds'

export type JenaTriggerId = string

export interface JenaTriggerMatcher {
  text: string
  isRegex: boolean
}

export interface JenaTimerEarlyEnder {
  text: string
  isRegex: boolean
}

export type JenaTriggerTimerType = 'countdown' | 'repeating' | 'stopwatch'

export type JenaTimerStartBehavior =
  | 'startNew'
  | 'restart'
  | 'restartMatchingTimerName'
  | 'ignoreIfRunning'

export interface JenaTrigger {
  id: JenaTriggerId
  name: string
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

export interface JenaCharacterServer {
  characterName: string
  serverName: string
}

export interface JenaExtendedTrigger {
  triggerId: JenaTriggerId
  enabledFor: JenaCharacterServer[]
}

export interface JenaResolvedTrigger {
  trigger: JenaTrigger
  enabledFor: JenaCharacterServer[]
}

export interface JenaTriggerEnablementChange {
  triggerId: JenaTriggerId
  character: JenaCharacterServer
  enabled: boolean
}

export interface JenaTriggerUpsert {
  trigger: JenaTrigger
  enabledFor?: JenaCharacterServer[]
}

export interface JenaUserTriggerFetchResponse {
  records: JenaExtendedTrigger[]
  revision: string
  triggers: JenaTrigger[]
}

export interface JenaUserTriggerUpdate {
  deletedTriggerIds: JenaTriggerId[]
  revision: string
  upsertedRecords: JenaExtendedTrigger[]
  upsertedTriggers: JenaTrigger[]
}

export function createEmptyTrigger(): JenaTrigger {
  return {
    actions: {
      clipboard: createClipboardAction(),
      display: createTextAction(),
      speech: createSpeechAction(),
    },
    category: 'Default',
    comments: '',
    groupPath: [],
    id: 'draft-trigger',
    match: createTriggerMatcher(),
    name: '',
    timer: null,
  }
}

export function withCanonicalTriggerId(trigger: JenaTrigger): JenaTrigger {
  const content = getJenaTriggerHashContent(trigger)

  return {
    ...content,
    id: createContentHashUuid(content),
  }
}

export function createJenaTriggerId(trigger: JenaTrigger): JenaTriggerId {
  return createContentHashUuid(getJenaTriggerHashContent(trigger))
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

export function createTriggerMatcher(): JenaTriggerMatcher {
  return {
    text: '',
    isRegex: false,
  }
}

export function matcherToRegexSource(matcher: JenaTriggerMatcher) {
  return matcher.isRegex ? matcher.text : escapeRegExp(matcher.text)
}

function getJenaTriggerHashContent(trigger: JenaTrigger) {
  return {
    actions: getTriggerActionsHashContent(trigger.actions),
    category: trigger.category,
    comments: trigger.comments,
    groupPath: [...trigger.groupPath],
    match: getTriggerMatcherHashContent(trigger.match),
    name: trigger.name,
    timer: trigger.timer ? getTriggerTimerHashContent(trigger.timer) : null,
  }
}

function getTriggerMatcherHashContent(matcher: JenaTriggerMatcher) {
  return {
    text: matcher.text,
    isRegex: matcher.isRegex,
  }
}

function getTriggerActionsHashContent(actions: JenaTriggerActions) {
  return {
    display: getTextActionHashContent(actions.display),
    speech: getSpeechActionHashContent(actions.speech),
    clipboard: getTextActionHashContent(actions.clipboard),
  }
}

function getTriggerTimerHashContent(timer: JenaTriggerTimer) {
  return {
    type: timer.type,
    name: timer.name,
    durationMs: timer.durationMs,
    startBehavior: timer.startBehavior,
    warningSeconds: timer.warningSeconds,
    warningAction: timer.warningAction
      ? getTimerActionHashContent(timer.warningAction)
      : null,
    endedAction: timer.endedAction
      ? getTimerActionHashContent(timer.endedAction)
      : null,
    earlyEnders: timer.earlyEnders.map(getTriggerMatcherHashContent),
  }
}

function getTimerActionHashContent(action: JenaTimerAction) {
  return {
    display: getTextActionHashContent(action.display),
    speech: getSpeechActionHashContent(action.speech),
  }
}

function getTextActionHashContent(action: JenaTextAction | JenaClipboardAction) {
  return {
    enabled: action.enabled,
    text: action.text,
  }
}

function getSpeechActionHashContent(action: JenaSpeechAction) {
  return {
    enabled: action.enabled,
    text: action.text,
    interrupt: action.interrupt,
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

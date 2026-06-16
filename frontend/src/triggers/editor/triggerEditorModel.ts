import type {
  JenaClipboardAction,
  JenaSpeechAction,
  JenaTextAction,
  JenaTimerAction,
  JenaTimerEarlyEnder,
  JenaTriggerMatcher,
  JenaTimerStartBehavior,
  JenaTrigger,
  JenaTriggerTimer,
  JenaTriggerTimerType,
} from '../../shared/triggers'
import {
  createEmptyTrigger,
  createSpeechAction,
  createTextAction,
} from '../../shared/triggers'

export type TriggerEditorAudioMode = 'none' | 'tts'

export interface TriggerEditorTextState {
  display: JenaTextAction
  clipboard: JenaClipboardAction
}

export interface TriggerEditorAudioState {
  mode: TriggerEditorAudioMode
  speech: JenaSpeechAction
}

export interface TriggerEditorTimerState {
  type: 'none' | JenaTriggerTimerType
  name: string
  durationMs: number
  startBehavior: JenaTimerStartBehavior
  warningSeconds: number
  warningAction: JenaTimerAction | null
  endedAction: JenaTimerAction | null
  earlyEnders: JenaTimerEarlyEnder[]
}

export interface TriggerEditorDraft {
  id: string
  name: string
  comments: string
  category: string
  groupPath: string[]
  match: JenaTriggerMatcher
  actions: {
    text: TriggerEditorTextState
    audio: TriggerEditorAudioState
  }
  timer: TriggerEditorTimerState
}

export interface DurationParts {
  hours: number
  minutes: number
  seconds: number
  milliseconds: number
}

export function createDraftFromTrigger(trigger: JenaTrigger): TriggerEditorDraft {
  const normalizedTrigger = normalizeTrigger(trigger)

  return {
    id: normalizedTrigger.id,
    name: normalizedTrigger.name,
    comments: normalizedTrigger.comments,
    category: normalizedTrigger.category || 'Default',
    groupPath: [...normalizedTrigger.groupPath],
    match: cloneMatcher(normalizedTrigger.match),
    actions: {
      text: {
        clipboard: { ...normalizedTrigger.actions.clipboard },
        display: { ...normalizedTrigger.actions.display },
      },
      audio: createAudioState(normalizedTrigger.actions.speech),
    },
    timer: createTimerState(normalizedTrigger.timer),
  }
}

export function createTriggerFromDraft(draft: TriggerEditorDraft): JenaTrigger {
  return {
    id: draft.id,
    name: draft.name,
    comments: draft.comments,
    category: draft.category,
    groupPath: [...draft.groupPath],
    match: cloneMatcher(draft.match),
    actions: {
      clipboard: {
        ...draft.actions.text.clipboard,
        enabled: draft.actions.text.clipboard.enabled,
      },
      display: {
        ...draft.actions.text.display,
        enabled: draft.actions.text.display.enabled,
      },
      speech: {
        ...draft.actions.audio.speech,
        enabled: draft.actions.audio.mode === 'tts',
      },
    },
    timer: createTimerFromDraft(draft.timer),
  }
}

export function createTimerAction(): JenaTimerAction {
  return {
    display: createTextAction(),
    speech: createSpeechAction(),
  }
}

export function validateTriggerDraft(draft: TriggerEditorDraft) {
  const errors: string[] = []

  if (draft.name.trim().length === 0) {
    errors.push('Trigger name is required.')
  }

  if (draft.match.text.trim().length === 0) {
    errors.push('Search text is required.')
  }

  if (
    draft.actions.audio.mode === 'tts' &&
    draft.actions.audio.speech.text.trim().length === 0
  ) {
    errors.push('Text to Say is required when text to speech is enabled.')
  }

  if (draft.timer.type !== 'none') {
    if (draft.timer.name.trim().length === 0) {
      errors.push('Timer name is required when a timer is selected.')
    }

    if (draft.timer.durationMs <= 0) {
      errors.push('Timer duration must be greater than 0.')
    }
  }

  if (
    draft.timer.warningAction &&
    draft.timer.warningSeconds <= 0
  ) {
    errors.push('Timer ending notification duration must be greater than 0.')
  }

  if (
    draft.timer.warningAction?.speech.enabled &&
    draft.timer.warningAction.speech.text.trim().length === 0
  ) {
    errors.push('Timer ending Text to Say is required when text to speech is enabled.')
  }

  if (
    draft.timer.endedAction?.speech.enabled &&
    draft.timer.endedAction.speech.text.trim().length === 0
  ) {
    errors.push('Timer ended Text to Say is required when text to speech is enabled.')
  }

  return errors
}

export function durationMsToParts(durationMs: number): DurationParts {
  const boundedDurationMs = Math.max(0, Math.trunc(durationMs))
  const hours = Math.floor(boundedDurationMs / 3_600_000)
  const minutes = Math.floor((boundedDurationMs % 3_600_000) / 60_000)
  const seconds = Math.floor((boundedDurationMs % 60_000) / 1000)
  const milliseconds = boundedDurationMs % 1000

  return {
    hours,
    milliseconds,
    minutes,
    seconds,
  }
}

export function partsToDurationMs(parts: DurationParts) {
  return (
    Math.max(0, parts.hours) * 3_600_000 +
    Math.max(0, parts.minutes) * 60_000 +
    Math.max(0, parts.seconds) * 1000 +
    Math.max(0, parts.milliseconds)
  )
}

export function secondsToParts(totalSeconds: number): DurationParts {
  const boundedSeconds = Math.max(0, Math.trunc(totalSeconds))
  const hours = Math.floor(boundedSeconds / 3600)
  const minutes = Math.floor((boundedSeconds % 3600) / 60)
  const seconds = boundedSeconds % 60

  return {
    hours,
    milliseconds: 0,
    minutes,
    seconds,
  }
}

export function partsToSeconds(parts: DurationParts) {
  return (
    Math.max(0, parts.hours) * 3600 +
    Math.max(0, parts.minutes) * 60 +
    Math.max(0, parts.seconds)
  )
}

function createAudioState(speech: JenaSpeechAction): TriggerEditorAudioState {
  const mode = speech.enabled ? 'tts' : 'none'

  return {
    mode,
    speech: { ...speech },
  }
}

function normalizeTrigger(trigger: JenaTrigger): JenaTrigger {
  const emptyTrigger = createEmptyTrigger()

  return {
    actions: {
      clipboard: {
        ...emptyTrigger.actions.clipboard,
        ...trigger.actions?.clipboard,
      },
      display: {
        ...emptyTrigger.actions.display,
        ...trigger.actions?.display,
      },
      speech: {
        ...emptyTrigger.actions.speech,
        ...trigger.actions?.speech,
      },
    },
    category: trigger.category ?? emptyTrigger.category,
    comments: trigger.comments ?? emptyTrigger.comments,
    groupPath: Array.isArray(trigger.groupPath) ? trigger.groupPath : [],
    id: trigger.id || emptyTrigger.id,
    match: trigger.match
      ? cloneMatcher(trigger.match)
      : cloneMatcher(emptyTrigger.match),
    name: trigger.name ?? emptyTrigger.name,
    timer: trigger.timer ?? null,
  }
}

function createTimerState(
  timer: JenaTriggerTimer | null,
): TriggerEditorTimerState {
  if (!timer) {
    return {
      durationMs: 0,
      earlyEnders: [createEmptyEarlyEnder()],
      endedAction: null,
      name: '',
      startBehavior: 'startNew',
      type: 'none',
      warningAction: null,
      warningSeconds: 1,
    }
  }

  return {
    durationMs: timer.durationMs,
    earlyEnders:
      timer.earlyEnders.length > 0
        ? timer.earlyEnders.map(cloneMatcher)
        : [createEmptyEarlyEnder()],
    endedAction: timer.endedAction
      ? cloneTimerAction(timer.endedAction)
      : null,
    name: timer.name,
    startBehavior: timer.startBehavior,
    type: timer.type,
    warningAction: timer.warningAction
      ? cloneTimerAction(timer.warningAction)
      : null,
    warningSeconds: timer.warningSeconds,
  }
}

function createTimerFromDraft(
  timer: TriggerEditorTimerState,
): JenaTriggerTimer | null {
  if (timer.type === 'none') {
    return null
  }

  return {
    durationMs: timer.durationMs,
    earlyEnders: timer.earlyEnders
      .filter((earlyEnder) => earlyEnder.text.trim().length > 0)
      .map(cloneMatcher),
    endedAction: timer.endedAction,
    name: timer.name,
    startBehavior: timer.startBehavior,
    type: timer.type,
    warningAction: timer.warningAction,
    warningSeconds: timer.warningSeconds,
  }
}

function cloneTimerAction(action: JenaTimerAction): JenaTimerAction {
  return {
    display: { ...action.display },
    speech: { ...action.speech },
  }
}

function createEmptyEarlyEnder(): JenaTimerEarlyEnder {
  return {
    text: '',
    isRegex: false,
  }
}

function cloneMatcher<TMatcher extends JenaTriggerMatcher>(matcher: TMatcher): TMatcher {
  return {
    text: matcher.text,
    isRegex: matcher.isRegex,
  } as TMatcher
}

import { useEffect } from 'react'
import type {
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
  TriggerStopRequestedMessage,
  TriggerTimerActionMessage,
} from '../../shared/messages'
import { useListen } from '../../shared/messageBrokerHooks'
import { useSettings } from '../../settings/settingsContext'
import type { IncludeCharacterNameForTriggerMatches } from '../../settings/settingsTypes'
import {
  useAlertEventCoordinator,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from './AlertEventCoordinator'

export type { TimerEarlyEnderEvent, TriggerMatchEvent }

export interface TriggerStopEvent {
  alert: TriggerStopRequestedMessage
}

export interface TriggerTimerActionEvent {
  alert: TriggerTimerActionMessage
}

interface TriggerAlertHookOptions {
  decorate?: boolean
}

export function useOnTriggerMatch(
  callback: (event: TriggerMatchEvent) => void,
  options: TriggerAlertHookOptions = {},
) {
  const { subscribeTriggerMatch } = useAlertEventCoordinator()
  const { machineSettings } = useSettings()
  const decorate = options.decorate ?? true

  useEffect(() => {
    return subscribeTriggerMatch((event) => {
      callback(
        decorate
          ? {
              ...event,
              alert: decorateTriggerAlert(
                event.alert,
                machineSettings.includeCharacterNameForTriggerMatches,
              ),
            }
          : event,
      )
    })
  }, [
    callback,
    decorate,
    machineSettings.includeCharacterNameForTriggerMatches,
    subscribeTriggerMatch,
  ])
}

export function useOnTimerEarlyEnder(
  callback: (event: TimerEarlyEnderEvent) => void,
  options: TriggerAlertHookOptions = {},
) {
  const { subscribeTimerEarlyEnder } = useAlertEventCoordinator()
  const { machineSettings } = useSettings()
  const decorate = options.decorate ?? true

  useEffect(() => {
    return subscribeTimerEarlyEnder((event) => {
      callback(
        decorate
          ? {
              ...event,
              alert: decorateTimerEarlyEnderAlert(
                event.alert,
                machineSettings.includeCharacterNameForTriggerMatches,
              ),
            }
          : event,
      )
    })
  }, [
    callback,
    decorate,
    machineSettings.includeCharacterNameForTriggerMatches,
    subscribeTimerEarlyEnder,
  ])
}

export function useOnTriggerStop(callback: (event: TriggerStopEvent) => void) {
  useListen('alert.stop-requested', (message) => {
    callback({
      alert: message.payload as TriggerStopRequestedMessage,
    })
  })
}

export function useOnTimerAction(
  callback: (event: TriggerTimerActionEvent) => void,
  options: TriggerAlertHookOptions = {},
) {
  const { machineSettings } = useSettings()
  const decorate = options.decorate ?? true

  useListen('alert.timer-action', (message) => {
    const alert = message.payload as TriggerTimerActionMessage

    callback({
      alert: decorate
        ? decorateTimerActionAlert(
            alert,
            machineSettings.includeCharacterNameForTriggerMatches,
          )
        : alert,
    })
  })
}

function decorateTriggerAlert(
  alert: TriggerAlertMatchedMessage,
  includeCharacterNameMode: IncludeCharacterNameForTriggerMatches,
) {
  return withoutUndefinedValues({
    ...alert,
    displayText:
      alert.displayText === undefined
        ? undefined
        : withCharacterPrefix(
            alert.displayText,
            alert.trigger.actions.display.text,
            alert.characterName,
            includeCharacterNameMode,
          ),
    speechText:
      alert.speechText === undefined
        ? undefined
        : withCharacterPrefix(
            alert.speechText,
            alert.trigger.actions.speech.text,
            alert.characterName,
            includeCharacterNameMode,
          ),
    timerName:
      alert.timerName === undefined
        ? undefined
        : alert.trigger.timer
          ? withCharacterPrefix(
              alert.timerName,
              alert.trigger.timer.name,
              alert.characterName,
              includeCharacterNameMode,
            )
          : alert.timerName,
  })
}

function decorateTimerEarlyEnderAlert(
  alert: TriggerEarlyEnderMatchedMessage,
  includeCharacterNameMode: IncludeCharacterNameForTriggerMatches,
) {
  return withoutUndefinedValues({
    ...alert,
    timerName:
      alert.timerName === undefined
        ? undefined
        : alert.trigger.timer
          ? withCharacterPrefix(
              alert.timerName,
              alert.trigger.timer.name,
              alert.characterName,
              includeCharacterNameMode,
            )
          : alert.timerName,
  })
}

function decorateTimerActionAlert(
  alert: TriggerTimerActionMessage,
  includeCharacterNameMode: IncludeCharacterNameForTriggerMatches,
) {
  const action =
    alert.kind === 'warning'
      ? alert.trigger.timer?.warningAction
      : alert.trigger.timer?.endedAction

  return withoutUndefinedValues({
    ...alert,
    displayText:
      alert.displayText === undefined
        ? undefined
        : action
          ? withCharacterPrefix(
              alert.displayText,
              action.display.text,
              alert.characterName,
              includeCharacterNameMode,
            )
          : alert.displayText,
    speechText:
      alert.speechText === undefined
        ? undefined
        : action
          ? withCharacterPrefix(
              alert.speechText,
              action.speech.text,
              alert.characterName,
              includeCharacterNameMode,
            )
          : alert.speechText,
  })
}

function withCharacterPrefix(
  text: string,
  template: string,
  characterName: string,
  mode: IncludeCharacterNameForTriggerMatches,
) {
  if (text.trim().length === 0 || mode === 'never') {
    return text
  }
  if (mode === 'if-not-present' && template.includes('{C}')) {
    return text
  }

  return `[${characterName}] ${text}`
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

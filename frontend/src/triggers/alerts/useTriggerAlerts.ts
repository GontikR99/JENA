import { useMemo } from 'react'
import type {
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
  TriggerStopRequestedMessage,
} from '../../shared/messages'
import type { JenaResolvedTrigger } from '../../shared/triggers'
import { useListen } from '../../shared/messageBrokerHooks'
import { useTriggerRuntime } from '../../runtime/TriggerRuntime'
import { useSubscribedTriggerManager } from '../model/SubscribedTriggerManager'
import { useTriggerManager } from '../model/UserTriggerManager'

export interface TriggerMatchEvent {
  alert: TriggerAlertMatchedMessage
  resolvedTrigger?: JenaResolvedTrigger
  trigger: TriggerAlertMatchedMessage['trigger']
}

export interface TimerEarlyEnderEvent {
  alert: TriggerEarlyEnderMatchedMessage
  trigger: TriggerEarlyEnderMatchedMessage['trigger']
}

export interface TriggerStopEvent {
  alert: TriggerStopRequestedMessage
}

export function useOnTriggerMatch(
  callback: (event: TriggerMatchEvent) => void,
) {
  const { areTriggersRunning } = useTriggerRuntime()
  const {
    isTriggerEnabledForCharacter: isUserTriggerEnabledForCharacter,
    triggers,
  } = useTriggerManager()
  const {
    isTriggerEnabledForCharacter: isSubscribedTriggerEnabledForCharacter,
  } = useSubscribedTriggerManager()
  const triggersById = useMemo(() => {
    return new Map(
      triggers.map((resolvedTrigger) => [
        resolvedTrigger.trigger.id,
        resolvedTrigger,
      ]),
    )
  }, [triggers])

  useListen('alert.trigger-matched', (message) => {
    if (!areTriggersRunning) {
      return
    }

    const alert = message.payload as TriggerAlertMatchedMessage
    const resolvedTrigger = triggersById.get(alert.trigger.id)
    const character = {
      characterName: alert.characterName,
      serverName: alert.serverName,
    }

    if (
      !isUserTriggerEnabledForCharacter(alert.trigger.id, character) &&
      !isSubscribedTriggerEnabledForCharacter(alert.trigger.id, character)
    ) {
      return
    }

    callback(withoutUndefinedValues({
      alert,
      resolvedTrigger,
      trigger: alert.trigger,
    }))
  })
}

export function useOnTimerEarlyEnder(
  callback: (event: TimerEarlyEnderEvent) => void,
) {
  useListen('alert.timer-early-ended', (message) => {
    const alert = message.payload as TriggerEarlyEnderMatchedMessage

    callback({
      alert,
      trigger: alert.trigger,
    })
  })
}

export function useOnTriggerStop(callback: (event: TriggerStopEvent) => void) {
  useListen('alert.stop-requested', (message) => {
    callback({
      alert: message.payload as TriggerStopRequestedMessage,
    })
  })
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

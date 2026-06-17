import { useMemo } from 'react'
import type {
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
  TriggerStopRequestedMessage,
} from '../../shared/messages'
import {
  isJenaTriggerEnabledForCharacter,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import { useListen } from '../../shared/messageBrokerHooks'
import { useTriggerRuntime } from '../../runtime/TriggerRuntime'
import { useTriggerManager } from '../model/UserTriggerManager'

export interface TriggerMatchEvent {
  alert: TriggerAlertMatchedMessage
  resolvedTrigger: JenaResolvedTrigger
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
  const { triggers } = useTriggerManager()
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

    // TODO: Check SubscribedTriggerStore records here once broadcast/subscribed
    // trigger alerts can arrive over the network.
    if (!resolvedTrigger) {
      return
    }

    if (
      !isJenaTriggerEnabledForCharacter(resolvedTrigger, {
        characterName: alert.characterName,
        serverName: alert.serverName,
      })
    ) {
      return
    }

    callback({
      alert,
      resolvedTrigger,
      trigger: alert.trigger,
    })
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

import { useEffect } from 'react'
import type { TriggerStopRequestedMessage } from '../../shared/messages'
import { useListen } from '../../shared/messageBrokerHooks'
import {
  useAlertEventCoordinator,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from './AlertEventCoordinator'

export type { TimerEarlyEnderEvent, TriggerMatchEvent }

export interface TriggerStopEvent {
  alert: TriggerStopRequestedMessage
}

export function useOnTriggerMatch(
  callback: (event: TriggerMatchEvent) => void,
) {
  const { subscribeTriggerMatch } = useAlertEventCoordinator()

  useEffect(() => {
    return subscribeTriggerMatch(callback)
  }, [callback, subscribeTriggerMatch])
}

export function useOnTimerEarlyEnder(
  callback: (event: TimerEarlyEnderEvent) => void,
) {
  const { subscribeTimerEarlyEnder } = useAlertEventCoordinator()

  useEffect(() => {
    return subscribeTimerEarlyEnder(callback)
  }, [callback, subscribeTimerEarlyEnder])
}

export function useOnTriggerStop(callback: (event: TriggerStopEvent) => void) {
  useListen('alert.stop-requested', (message) => {
    callback({
      alert: message.payload as TriggerStopRequestedMessage,
    })
  })
}

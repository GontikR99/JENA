import { useCallback } from 'react'
import { useRpc } from '../../shared/messageBrokerHooks'
import type { JenaBroadcastMode } from '../../shared/triggers'
import {
  useOnTimerEarlyEnder,
  useOnTriggerMatch,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from './useTriggerAlerts'

type BroadcastableMode = Extract<JenaBroadcastMode, 'boxes' | 'subscribers'>

export function BroadcastReflector() {
  const call = useRpc('broadcast-reflector')

  const reflectTriggerMatch = useCallback(
    (event: TriggerMatchEvent) => {
      if (event.origin !== 'local') {
        return
      }

      const request = createReflectRequest(event, { requireEnabled: true })
      if (!request) {
        return
      }

      void call('server.broadcast', 'reflectAlert', {
        ...request,
        alert: event.alert,
        eventId: event.eventId,
        kind: 'triggerMatched',
      }).catch((error: unknown) => {
        console.warn('[BroadcastReflector] trigger broadcast failed', error)
      })
    },
    [call],
  )

  const reflectTimerEarlyEnder = useCallback(
    (event: TimerEarlyEnderEvent) => {
      if (event.origin !== 'local') {
        return
      }

      const request = createReflectRequest(event, { requireEnabled: false })
      if (!request) {
        return
      }

      void call('server.broadcast', 'reflectAlert', {
        ...request,
        alert: event.alert,
        eventId: event.eventId,
        kind: 'timerEarlyEnded',
      }).catch((error: unknown) => {
        console.warn('[BroadcastReflector] timer early ender broadcast failed', error)
      })
    },
    [call],
  )

  useOnTriggerMatch(reflectTriggerMatch, { decorate: false })
  useOnTimerEarlyEnder(reflectTimerEarlyEnder, { decorate: false })

  return null
}

function createReflectRequest(
  event: Pick<TriggerMatchEvent | TimerEarlyEnderEvent, 'registrations'>,
  options: {
    requireEnabled: boolean
  },
) {
  const subscriptionIds = [
    ...new Set(
      event.registrations.flatMap((registration) => {
        if (
          registration.source === 'subscription' &&
          registration.broadcastMode === 'subscribers' &&
          (!options.requireEnabled || registration.enabled)
        ) {
          return [registration.subscriptionId]
        }

        return []
      }),
    ),
  ].sort()
  const userBroadcastMode = strongestBroadcastMode(
      event.registrations.flatMap((registration) => {
        if (
          registration.source === 'user' &&
          registration.broadcastMode !== 'private' &&
          (!options.requireEnabled || registration.enabled)
        ) {
          return [registration.broadcastMode]
        }

      return []
    }),
  )

  if (!userBroadcastMode && subscriptionIds.length === 0) {
    return null
  }

  return {
    subscriptionIds,
    ...(userBroadcastMode ? { userBroadcastMode } : {}),
  }
}

function strongestBroadcastMode(modes: BroadcastableMode[]) {
  if (modes.includes('subscribers')) {
    return 'subscribers'
  }

  if (modes.includes('boxes')) {
    return 'boxes'
  }

  return null
}

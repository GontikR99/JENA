import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import type {
  BroadcastAlertMessage,
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
} from '../../shared/messages'
import { createMessageId } from '../../shared/messages'
import type { JenaResolvedTrigger } from '../../shared/triggers'
import { useLocalCharacters } from '../../characters/LocalCharactersProvider'
import { useListen } from '../../shared/messageBrokerHooks'
import { useTriggerRuntime } from '../../runtime/TriggerRuntime'
import {
  useSubscribedTriggerManager,
  type SubscribedTriggerAlertRegistration,
} from '../model/SubscribedTriggerManager'
import {
  useTriggerManager,
  type UserTriggerAlertRegistration,
} from '../model/UserTriggerManager'

const broadcastDedupeTtlMs = 60_000
const recentTriggerStartGraceMs = 5 * 60_000

export type AlertEventOrigin = 'broadcast' | 'local'

export type AlertRegistration =
  | UserTriggerAlertRegistration
  | SubscribedTriggerAlertRegistration

export interface TriggerMatchEvent {
  alert: TriggerAlertMatchedMessage
  eventId: string
  origin: AlertEventOrigin
  registrations: AlertRegistration[]
  resolvedTrigger?: JenaResolvedTrigger
  trigger: TriggerAlertMatchedMessage['trigger']
}

export interface TimerEarlyEnderEvent {
  alert: TriggerEarlyEnderMatchedMessage
  eventId: string
  origin: AlertEventOrigin
  registrations: AlertRegistration[]
  trigger: TriggerEarlyEnderMatchedMessage['trigger']
}

interface AlertEventCoordinatorApi {
  subscribeTimerEarlyEnder: (
    callback: (event: TimerEarlyEnderEvent) => void,
  ) => () => void
  subscribeTriggerMatch: (
    callback: (event: TriggerMatchEvent) => void,
  ) => () => void
}

const AlertEventCoordinatorContext =
  createContext<AlertEventCoordinatorApi | null>(null)

export function AlertEventCoordinatorProvider({
  children,
}: {
  children: ReactNode
}) {
  const { areTriggersRunning, lastStartedAtMs } = useTriggerRuntime()
  const localCharacters = useLocalCharacters()
  const {
    getTimerEarlyEnderBroadcastRegistration,
    getTriggerAlertRegistration,
    triggers,
  } = useTriggerManager()
  const {
    getTimerEarlyEnderBroadcastRegistrations,
    getTriggerAlertRegistrations,
    hasSubscriptionTrigger,
    isSubscriptionTriggerEnabledForCharacter,
  } = useSubscribedTriggerManager()
  const dedupeRef = useRef(new Map<string, number>())
  const timerEarlyEnderCallbacksRef = useRef(
    new Set<(event: TimerEarlyEnderEvent) => void>(),
  )
  const triggerMatchCallbacksRef = useRef(
    new Set<(event: TriggerMatchEvent) => void>(),
  )
  const triggersById = useMemo(() => {
    return new Map(
      triggers.map((resolvedTrigger) => [
        resolvedTrigger.trigger.id,
        resolvedTrigger,
      ]),
    )
  }, [triggers])

  const markEventSeen = useCallback((eventId: string) => {
    const now = Date.now()
    const expiresBefore = now - broadcastDedupeTtlMs

    for (const [seenEventId, firstSeenAt] of dedupeRef.current) {
      if (firstSeenAt < expiresBefore) {
        dedupeRef.current.delete(seenEventId)
      }
    }

    if (dedupeRef.current.has(eventId)) {
      return false
    }

    dedupeRef.current.set(eventId, now)
    return true
  }, [])

  const emitTriggerMatch = useCallback((event: TriggerMatchEvent) => {
    triggerMatchCallbacksRef.current.forEach((callback) => {
      callback(event)
    })
  }, [])

  const emitTimerEarlyEnder = useCallback((event: TimerEarlyEnderEvent) => {
    timerEarlyEnderCallbacksRef.current.forEach((callback) => {
      callback(event)
    })
  }, [])

  const handleLocalTriggerMatch = useCallback(
    (alert: TriggerAlertMatchedMessage) => {
      if (!areTriggersRunning) {
        return
      }

      const character = {
        characterName: alert.characterName,
        serverName: alert.serverName,
      }
      const registrations = withoutNulls([
        getTriggerAlertRegistration(alert.trigger.id, character),
        ...getTriggerAlertRegistrations(alert.trigger.id, character),
      ])
      if (!registrations.some((registration) => registration.enabled)) {
        return
      }

      const eventId = createMessageId()

      markEventSeen(eventId)
      emitTriggerMatch(
        withoutUndefinedValues({
          alert,
          eventId,
          origin: 'local' as const,
          registrations,
          resolvedTrigger: triggersById.get(alert.trigger.id),
          trigger: alert.trigger,
        }),
      )
    },
    [
      areTriggersRunning,
      emitTriggerMatch,
      getTriggerAlertRegistration,
      getTriggerAlertRegistrations,
      markEventSeen,
      triggersById,
    ],
  )

  const handleLocalTimerEarlyEnder = useCallback(
    (alert: TriggerEarlyEnderMatchedMessage) => {
      const registrations = withoutNulls([
        getTimerEarlyEnderBroadcastRegistration(alert.trigger.id),
        ...getTimerEarlyEnderBroadcastRegistrations(alert.trigger.id),
      ])
      const eventId = createMessageId()

      markEventSeen(eventId)
      emitTimerEarlyEnder({
        alert,
        eventId,
        origin: 'local',
        registrations,
        trigger: alert.trigger,
      })
    },
    [
      emitTimerEarlyEnder,
      getTimerEarlyEnderBroadcastRegistration,
      getTimerEarlyEnderBroadcastRegistrations,
      markEventSeen,
    ],
  )

  const handleBroadcastAlert = useCallback(
    (broadcast: BroadcastAlertMessage) => {
      if (broadcast.kind === 'triggerMatched') {
        if (!areTriggersRunning) {
          return
        }

        const alert = broadcast.alert as TriggerAlertMatchedMessage
        if (
          broadcast.subscriptionId &&
          !localCharacters.some((character) => {
            return (
              (character.active ||
                isWithinRecentTriggerStartGrace(lastStartedAtMs)) &&
              isSubscriptionTriggerEnabledForCharacter(
                broadcast.subscriptionId ?? '',
                alert.trigger.id,
                character,
              )
            )
          })
        ) {
          return
        }

        if (!markEventSeen(broadcast.eventId)) {
          return
        }

        emitTriggerMatch({
          alert,
          eventId: broadcast.eventId,
          origin: 'broadcast',
          registrations: [],
          trigger: alert.trigger,
        })
        return
      }

      const alert = broadcast.alert as TriggerEarlyEnderMatchedMessage
      if (
        broadcast.subscriptionId &&
        !hasSubscriptionTrigger(broadcast.subscriptionId, alert.trigger.id)
      ) {
        return
      }

      if (!markEventSeen(broadcast.eventId)) {
        return
      }

      emitTimerEarlyEnder({
        alert,
        eventId: broadcast.eventId,
        origin: 'broadcast',
        registrations: [],
        trigger: alert.trigger,
      })
    },
    [
      areTriggersRunning,
      emitTimerEarlyEnder,
      emitTriggerMatch,
      hasSubscriptionTrigger,
      isSubscriptionTriggerEnabledForCharacter,
      lastStartedAtMs,
      localCharacters,
      markEventSeen,
    ],
  )

  useListen('alert.trigger-matched', (message) => {
    handleLocalTriggerMatch(message.payload as TriggerAlertMatchedMessage)
  })
  useListen('alert.timer-early-ended', (message) => {
    handleLocalTimerEarlyEnder(message.payload as TriggerEarlyEnderMatchedMessage)
  })
  useListen('alert.broadcast', (message) => {
    handleBroadcastAlert(message.payload as BroadcastAlertMessage)
  })

  const subscribeTriggerMatch = useCallback(
    (callback: (event: TriggerMatchEvent) => void) => {
      triggerMatchCallbacksRef.current.add(callback)

      return () => {
        triggerMatchCallbacksRef.current.delete(callback)
      }
    },
    [],
  )

  const subscribeTimerEarlyEnder = useCallback(
    (callback: (event: TimerEarlyEnderEvent) => void) => {
      timerEarlyEnderCallbacksRef.current.add(callback)

      return () => {
        timerEarlyEnderCallbacksRef.current.delete(callback)
      }
    },
    [],
  )

  const value = useMemo(
    () => ({
      subscribeTimerEarlyEnder,
      subscribeTriggerMatch,
    }),
    [subscribeTimerEarlyEnder, subscribeTriggerMatch],
  )

  return (
    <AlertEventCoordinatorContext.Provider value={value}>
      {children}
    </AlertEventCoordinatorContext.Provider>
  )
}

export function useAlertEventCoordinator() {
  const coordinator = useContext(AlertEventCoordinatorContext)
  if (!coordinator) {
    throw new Error(
      'useAlertEventCoordinator must be used within AlertEventCoordinatorProvider',
    )
  }

  return coordinator
}

function withoutNulls<TValue>(values: Array<TValue | null>) {
  return values.filter((value): value is TValue => value !== null)
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

function isWithinRecentTriggerStartGrace(lastStartedAtMs: number | null) {
  return (
    lastStartedAtMs !== null &&
    Date.now() - lastStartedAtMs <= recentTriggerStartGraceMs
  )
}

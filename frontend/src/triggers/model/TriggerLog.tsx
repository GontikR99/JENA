import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  useOnTriggerMatch,
  type TriggerMatchEvent,
} from '../alerts/useTriggerAlerts'
import type { TriggerLogRecord } from './types'

const maxTriggerLogRecords = 1000

interface TriggerLogContextValue {
  records: TriggerLogRecord[]
}

const TriggerLogContext = createContext<TriggerLogContextValue | null>(null)

export function TriggerLogProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<TriggerLogRecord[]>([])
  const nextLogRecordIdRef = useRef(0)

  useOnTriggerMatch(
    useCallback((event) => {
      nextLogRecordIdRef.current += 1
      const alert = event.alert
      const record: TriggerLogRecord = {
        characterName: alert.characterName,
        id: `${alert.timestamp}-${alert.trigger.id}-${nextLogRecordIdRef.current}`,
        logLine: alert.text,
        serverName: alert.serverName,
        subscriptionId: getLogSubscriptionId(event),
        timestamp: alert.timestamp,
        triggerId: alert.trigger.id,
        triggerName: alert.trigger.name,
      }

      setRecords((currentRecords) => {
        return [record, ...currentRecords].slice(0, maxTriggerLogRecords)
      })
    }, []),
  )

  const value = useMemo(
    () => ({
      records,
    }),
    [records],
  )

  return (
    <TriggerLogContext.Provider value={value}>
      {children}
    </TriggerLogContext.Provider>
  )
}

export function useTriggerLog() {
  const context = useContext(TriggerLogContext)
  if (!context) {
    throw new Error('useTriggerLog must be used within TriggerLogProvider.')
  }

  return context
}

function getLogSubscriptionId(event: TriggerMatchEvent) {
  if (event.subscriptionId) {
    return event.subscriptionId
  }

  if (
    event.registrations.some(
      (registration) => registration.source === 'user' && registration.enabled,
    )
  ) {
    return undefined
  }

  return event.registrations.find(isSubscriptionRegistration)?.subscriptionId
}

function isSubscriptionRegistration(
  registration: TriggerMatchEvent['registrations'][number],
): registration is Extract<
  TriggerMatchEvent['registrations'][number],
  { source: 'subscription' }
> {
  return registration.source === 'subscription'
}

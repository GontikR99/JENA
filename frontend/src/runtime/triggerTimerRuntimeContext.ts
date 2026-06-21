import { createContext, useContext } from 'react'
import type {
  AlertCaptureSnapshot,
  TriggerSpeechProfile,
  TriggerTimerActionPayload,
} from '../shared/messages'
import type { JenaTriggerTimerType } from '../shared/triggers'
import type { TriggerMatchEvent } from '../triggers/alerts/useTriggerAlerts'

export interface RuntimeTimer {
  characterName: string
  durationMs: number
  endedAction?: TriggerTimerActionPayload
  endedCycleIndex: number | null
  endedFired: boolean
  generation: number
  id: string
  lastCycleIndex: number | null
  matchCaptures: AlertCaptureSnapshot
  serverName: string
  speechProfile?: TriggerSpeechProfile
  startedAtMs: number
  timerName: string
  triggerId: string
  trigger: TriggerMatchEvent['trigger']
  type: JenaTriggerTimerType
  warnedCycleIndex: number | null
  warningAction?: TriggerTimerActionPayload
  warningFired: boolean
  warningSeconds: number
}

export interface TriggerTimerRuntimeContextValue {
  removeTimer: (timerId: string) => void
  timers: RuntimeTimer[]
}

export const TriggerTimerRuntimeContext =
  createContext<TriggerTimerRuntimeContextValue | null>(null)

export function useTriggerTimerRuntime() {
  const context = useContext(TriggerTimerRuntimeContext)

  if (!context) {
    throw new Error(
      'useTriggerTimerRuntime must be used within TriggerTimerRuntimeProvider.',
    )
  }

  return context
}

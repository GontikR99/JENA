import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AlertCaptureSnapshot,
  TriggerTimerActionKind,
  TriggerTimerActionMessage,
  TriggerTimerActionPayload,
} from '../shared/messages'
import type { JenaTriggerTimer } from '../shared/triggers'
import { useSender } from '../shared/messageBrokerHooks'
import { useSettings } from '../settings/settingsContext'
import {
  useOnTimerEarlyEnder,
  useOnTriggerMatch,
  useOnTriggerStop,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from '../triggers/alerts/useTriggerAlerts'
import { useTriggerRuntime } from './TriggerRuntime'
import { getTimerFrame, type TimerFrame } from './triggerTimerFrame'
import {
  TriggerTimerRuntimeContext,
  type RuntimeTimer,
  type TriggerTimerRuntimeContextValue,
} from './triggerTimerRuntimeContext'

const timerTickIntervalMs = 250

export function TriggerTimerRuntimeProvider({
  children,
}: {
  children: ReactNode
}) {
  const send = useSender('trigger-timer-runtime')
  const { areTriggersRunning } = useTriggerRuntime()
  const { machineSettings } = useSettings()
  const areTimerActionsActive = areTriggersRunning || machineSettings.headlessMode
  const areTimerActionsActiveRef = useRef(areTimerActionsActive)
  const nextTimerId = useRef(1)
  const [timers, setTimers] = useState<RuntimeTimer[]>([])
  const timersRef = useRef<RuntimeTimer[]>([])

  const setRuntimeTimers = useCallback(
    (updater: (currentTimers: RuntimeTimer[]) => RuntimeTimer[]) => {
      setTimers((currentTimers) => {
        const nextTimers = updater(currentTimers)
        timersRef.current = nextTimers
        return nextTimers
      })
    },
    [],
  )

  const removeTimer = useCallback(
    (timerId: string) => {
      setRuntimeTimers((currentTimers) =>
        currentTimers.filter((timer) => timer.id !== timerId),
      )
    },
    [setRuntimeTimers],
  )

  useEffect(() => {
    timersRef.current = timers
  }, [timers])

  useEffect(() => {
    areTimerActionsActiveRef.current = areTimerActionsActive

    if (!areTimerActionsActive) {
      setRuntimeTimers(() => [])
    }
  }, [areTimerActionsActive, setRuntimeTimers])

  useEffect(() => {
    if (!areTimerActionsActive) {
      return
    }

    const intervalId = window.setInterval(() => {
      const actions: TriggerTimerActionMessage[] = []
      const currentTimers = timersRef.current
      const nextTimers = advanceTimers(currentTimers, Date.now(), actions)

      if (nextTimers !== currentTimers) {
        setRuntimeTimers(() => nextTimers)
      }
      actions.forEach((action) => send('alert.timer-action', action))
    }, timerTickIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [areTimerActionsActive, send, setRuntimeTimers])

  const handleTriggerStop = useCallback(() => {
    setRuntimeTimers(() => [])
  }, [setRuntimeTimers])

  const handleTriggerMatch = useCallback(
    (event: TriggerMatchEvent) => {
      if (!areTimerActionsActiveRef.current) {
        return
      }

      const timer = event.trigger.timer
      if (!timer || timer.durationMs <= 0) {
        return
      }

      const timerName = event.alert.timerName ?? timer.name
      const startedAtMs = Date.now()

      setRuntimeTimers((currentTimers) =>
        upsertRuntimeTimer(
          currentTimers,
          timer,
          event,
          timerName,
          startedAtMs,
          () => `runtime-timer-${nextTimerId.current++}`,
        ),
      )
    },
    [setRuntimeTimers],
  )

  const handleTimerEarlyEnder = useCallback(
    (event: TimerEarlyEnderEvent) => {
      setRuntimeTimers((currentTimers) =>
        currentTimers.filter((timer) => !doesEarlyEnderMatchTimer(event, timer)),
      )
    },
    [setRuntimeTimers],
  )

  useOnTriggerStop(handleTriggerStop)
  useOnTriggerMatch(handleTriggerMatch)
  useOnTimerEarlyEnder(handleTimerEarlyEnder)

  const value = useMemo<TriggerTimerRuntimeContextValue>(
    () => ({
      removeTimer,
      timers,
    }),
    [removeTimer, timers],
  )

  return (
    <TriggerTimerRuntimeContext.Provider value={value}>
      {children}
    </TriggerTimerRuntimeContext.Provider>
  )
}

function upsertRuntimeTimer(
  currentTimers: RuntimeTimer[],
  timer: JenaTriggerTimer,
  event: TriggerMatchEvent,
  timerName: string,
  startedAtMs: number,
  createTimerId: () => string,
) {
  const existingIndex = findTimerIndex(currentTimers, timer, event, timerName)

  if (timer.startBehavior === 'ignoreIfRunning' && existingIndex >= 0) {
    return currentTimers
  }

  if (existingIndex >= 0) {
    return currentTimers.map((runtimeTimer, index) => {
      if (index !== existingIndex) {
        return runtimeTimer
      }

      return resetRuntimeTimer({
        ...runtimeTimer,
        characterName: event.alert.characterName,
        durationMs: timer.durationMs,
        endedAction: event.alert.timerEndedAction,
        generation: runtimeTimer.generation + 1,
        matchCaptures: getAlertCaptureSnapshot(event.alert.matchCaptures),
        serverName: event.alert.serverName,
        speechProfile: event.alert.speechProfile,
        startedAtMs,
        timerName,
        trigger: event.trigger,
        triggerId: event.trigger.id,
        type: timer.type,
        warningAction: event.alert.timerWarningAction,
        warningSeconds: timer.warningSeconds,
      })
    })
  }

  return [
    ...currentTimers,
    resetRuntimeTimer({
      characterName: event.alert.characterName,
      durationMs: timer.durationMs,
      endedAction: event.alert.timerEndedAction,
      endedCycleIndex: null,
      endedFired: false,
      generation: 0,
      id: createTimerId(),
      lastCycleIndex: null,
      matchCaptures: getAlertCaptureSnapshot(event.alert.matchCaptures),
      serverName: event.alert.serverName,
      speechProfile: event.alert.speechProfile,
      startedAtMs,
      timerName,
      trigger: event.trigger,
      triggerId: event.trigger.id,
      type: timer.type,
      warnedCycleIndex: null,
      warningAction: event.alert.timerWarningAction,
      warningFired: false,
      warningSeconds: timer.warningSeconds,
    }),
  ]
}

function resetRuntimeTimer(timer: RuntimeTimer): RuntimeTimer {
  return {
    ...timer,
    endedCycleIndex: null,
    endedFired: false,
    lastCycleIndex: null,
    warnedCycleIndex: null,
    warningFired: false,
  }
}

function advanceTimers(
  currentTimers: RuntimeTimer[],
  nowMs: number,
  actions: TriggerTimerActionMessage[],
) {
  let changed = false
  const nextTimers: RuntimeTimer[] = []

  currentTimers.forEach((timer) => {
    const frame = getTimerFrame(timer, nowMs - timer.startedAtMs)
    const nextTimer = emitDueTimerActions(timer, frame, actions)

    if (frame.complete) {
      changed = true
      return
    }

    if (nextTimer !== timer) {
      changed = true
    }
    nextTimers.push(nextTimer)
  })

  return changed ? nextTimers : currentTimers
}

function emitDueTimerActions(
  timer: RuntimeTimer,
  frame: TimerFrame,
  actions: TriggerTimerActionMessage[],
) {
  if (timer.type === 'countdown') {
    const afterWarning = maybeEmitCountdownWarning(timer, frame, actions)
    return maybeEmitCountdownEnded(afterWarning, frame, actions)
  }

  if (timer.type === 'repeating') {
    const afterEnded = maybeEmitRepeatingEnded(timer, frame, actions)
    return maybeEmitRepeatingWarning(afterEnded, frame, actions)
  }

  return timer
}

function maybeEmitCountdownWarning(
  timer: RuntimeTimer,
  frame: TimerFrame,
  actions: TriggerTimerActionMessage[],
) {
  if (
    timer.warningFired ||
    !timer.warningAction ||
    timer.warningSeconds <= 0 ||
    frame.remainingMs > timer.warningSeconds * 1000
  ) {
    return timer
  }

  emitTimerAction('warning', timer, timer.warningAction, actions)
  return {
    ...timer,
    warningFired: true,
  }
}

function maybeEmitCountdownEnded(
  timer: RuntimeTimer,
  frame: TimerFrame,
  actions: TriggerTimerActionMessage[],
) {
  if (timer.endedFired || !timer.endedAction || !frame.complete) {
    return timer
  }

  emitTimerAction('ended', timer, timer.endedAction, actions)
  return {
    ...timer,
    endedFired: true,
  }
}

function maybeEmitRepeatingWarning(
  timer: RuntimeTimer,
  frame: TimerFrame,
  actions: TriggerTimerActionMessage[],
) {
  if (
    !timer.warningAction ||
    timer.warningSeconds <= 0 ||
    timer.warnedCycleIndex === frame.cycleIndex ||
    frame.remainingMs > timer.warningSeconds * 1000
  ) {
    return timer
  }

  emitTimerAction('warning', timer, timer.warningAction, actions)
  return {
    ...timer,
    warnedCycleIndex: frame.cycleIndex,
  }
}

function maybeEmitRepeatingEnded(
  timer: RuntimeTimer,
  frame: TimerFrame,
  actions: TriggerTimerActionMessage[],
) {
  const lastCycleIndex = timer.lastCycleIndex

  if (lastCycleIndex === null) {
    return {
      ...timer,
      lastCycleIndex: frame.cycleIndex,
    }
  }

  if (
    frame.cycleIndex <= lastCycleIndex ||
    timer.endedCycleIndex === lastCycleIndex
  ) {
    return timer
  }

  if (!timer.endedAction) {
    return {
      ...timer,
      lastCycleIndex: frame.cycleIndex,
    }
  }

  emitTimerAction('ended', timer, timer.endedAction, actions)
  return {
    ...timer,
    endedCycleIndex: lastCycleIndex,
    lastCycleIndex: frame.cycleIndex,
  }
}

function emitTimerAction(
  kind: TriggerTimerActionKind,
  timer: RuntimeTimer,
  action: TriggerTimerActionPayload,
  actions: TriggerTimerActionMessage[],
) {
  if (!action.displayText && !action.speechText) {
    return
  }

  actions.push(
    withoutUndefinedValues({
      characterName: timer.characterName,
      displayText: action.displayText,
      kind,
      serverName: timer.serverName,
      speechProfile: timer.speechProfile,
      speechInterrupt: action.speechInterrupt,
      speechText: action.speechText,
      timerName: timer.timerName,
      timestamp: new Date().toISOString(),
      trigger: timer.trigger,
    }),
  )
}

function findTimerIndex(
  timers: RuntimeTimer[],
  timer: JenaTriggerTimer,
  event: TriggerMatchEvent,
  timerName: string,
) {
  if (timer.startBehavior === 'startNew') {
    return -1
  }

  if (timer.startBehavior === 'restartMatchingTimerName') {
    return timers.findIndex((runtimeTimer) => runtimeTimer.timerName === timerName)
  }

  return timers.findIndex(
    (runtimeTimer) => runtimeTimer.triggerId === event.trigger.id,
  )
}

function doesEarlyEnderMatchTimer(
  event: TimerEarlyEnderEvent,
  timer: RuntimeTimer,
) {
  if (event.trigger.id !== timer.triggerId) {
    return false
  }

  if (!isSameText(event.alert.characterName, timer.characterName)) {
    return false
  }

  if (!isSameText(event.alert.serverName, timer.serverName)) {
    return false
  }

  return doCaptureConstraintsMatchTimer(
    getAlertCaptureSnapshot(event.alert.matchCaptures),
    timer.matchCaptures,
  )
}

function isSameText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function doCaptureConstraintsMatchTimer(
  constraints: AlertCaptureSnapshot,
  timerCaptures: AlertCaptureSnapshot,
) {
  return (
    doRecordConstraintsMatch(constraints.capturesByKey, timerCaptures.capturesByKey) &&
    doRecordConstraintsMatch(constraints.namedCaptures, timerCaptures.namedCaptures) &&
    doPositionalConstraintsMatch(
      constraints.positionalCaptures,
      timerCaptures.positionalCaptures,
    )
  )
}

function doRecordConstraintsMatch(
  constraints: Record<string, string>,
  timerCaptures: Record<string, string>,
) {
  return Object.entries(constraints).every(([key, value]) => {
    return timerCaptures[key] === value
  })
}

function doPositionalConstraintsMatch(
  constraints: string[],
  timerCaptures: string[],
) {
  return constraints.every((value, index) => timerCaptures[index] === value)
}

function getAlertCaptureSnapshot(
  captures: AlertCaptureSnapshot | undefined,
): AlertCaptureSnapshot {
  return captures ?? emptyAlertCaptureSnapshot
}

const emptyAlertCaptureSnapshot: AlertCaptureSnapshot = {
  capturesByKey: {},
  namedCaptures: {},
  positionalCaptures: [],
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

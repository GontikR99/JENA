import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  TriggerTimerActionKind,
  TriggerTimerActionMessage,
  TriggerTimerActionPayload,
} from '../shared/messages'
import type {
  JenaTriggerTimer,
  JenaTriggerTimerType,
} from '../shared/triggers'
import jenaBrandLockupLargeUrl from '../assets/jena-brand-lockup-large.webp'
import { useSender } from '../shared/messageBrokerHooks'
import { useSettings } from '../settings/settingsContext'
import type {
  PipTextStyleSettings,
  PipTimerStyleSettings,
} from '../settings/settingsTypes'
import {
  useOnTimerAction,
  useOnTimerEarlyEnder,
  useOnTriggerStop,
  useOnTriggerMatch,
  type TriggerTimerActionEvent,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from '../triggers/alerts/useTriggerAlerts'
import './pip.css'

const defaultTextLifetimeMs = 5000
interface RuntimeTimer {
  characterName: string
  durationMs: number
  endedAction?: TriggerTimerActionPayload
  generation: number
  id: string
  serverName: string
  startedAtMs: number
  timerName: string
  triggerId: string
  trigger: TriggerMatchEvent['trigger']
  type: JenaTriggerTimerType
  warningAction?: TriggerTimerActionPayload
  warningSeconds: number
}

interface RuntimeText {
  createdAtMs: number
  id: string
  text: string
}

export function Pip() {
  const { machineSettings } = useSettings()
  const send = useSender('pip')
  const nextTimerId = useRef(1)
  const nextTextId = useRef(1)
  const [timers, setTimers] = useState<RuntimeTimer[]>([])
  const [texts, setTexts] = useState<RuntimeText[]>([])

  const removeTimer = useCallback((timerId: string) => {
    setTimers((currentTimers) =>
      currentTimers.filter((timer) => timer.id !== timerId),
    )
  }, [])

  const removeText = useCallback((textId: string) => {
    setTexts((currentTexts) =>
      currentTexts.filter((text) => text.id !== textId),
    )
  }, [])

  useOnTriggerStop(() => {
    setTimers([])
    setTexts([])
  })

  const handleTimerMatch = useCallback((event: TriggerMatchEvent) => {
    const timer = event.trigger.timer
    if (!timer || timer.durationMs <= 0) {
      return
    }

    const timerName = event.alert.timerName ?? timer.name
    const startedAtMs = performance.now()

    setTimers((currentTimers) => {
      const existingIndex = findTimerIndex(currentTimers, timer, event, timerName)

      if (timer.startBehavior === 'ignoreIfRunning' && existingIndex >= 0) {
        return currentTimers
      }

      if (existingIndex >= 0) {
        return currentTimers.map((runtimeTimer, index) => {
          if (index !== existingIndex) {
            return runtimeTimer
          }

          return {
            ...runtimeTimer,
            characterName: event.alert.characterName,
            durationMs: timer.durationMs,
            endedAction: event.alert.timerEndedAction,
            generation: runtimeTimer.generation + 1,
            serverName: event.alert.serverName,
            startedAtMs,
            timerName,
            trigger: event.trigger,
            triggerId: event.trigger.id,
            type: timer.type,
            warningAction: event.alert.timerWarningAction,
            warningSeconds: timer.warningSeconds,
          }
        })
      }

      return [
        ...currentTimers,
        {
          characterName: event.alert.characterName,
          durationMs: timer.durationMs,
          endedAction: event.alert.timerEndedAction,
          generation: 0,
          id: `pip-timer-${nextTimerId.current++}`,
          serverName: event.alert.serverName,
          startedAtMs,
          timerName,
          trigger: event.trigger,
          triggerId: event.trigger.id,
          type: timer.type,
          warningAction: event.alert.timerWarningAction,
          warningSeconds: timer.warningSeconds,
        },
      ]
    })
  }, [])

  const handleTextMatch = useCallback((event: TriggerMatchEvent) => {
    if (!event.alert.displayText) {
      return
    }

    setTexts((currentTexts) => [
      ...currentTexts,
      {
        createdAtMs: performance.now(),
        id: `pip-text-${nextTextId.current++}`,
        text: event.alert.displayText ?? '',
      },
    ])
  }, [])

  const handleTimerAction = useCallback(
    (alert: TriggerTimerActionMessage) => {
      send('alert.timer-action', alert)
    },
    [send],
  )

  const handleTimerActionText = useCallback((event: TriggerTimerActionEvent) => {
    if (!event.alert.displayText) {
      return
    }

    setTexts((currentTexts) => [
      ...currentTexts,
      {
        createdAtMs: performance.now(),
        id: `pip-text-${nextTextId.current++}`,
        text: event.alert.displayText ?? '',
      },
    ])
  }, [])

  return (
    <main className="pip-view">
      <TriggerMatchTimerLauncher onMatch={handleTimerMatch} />
      <TriggerMatchTextLauncher onMatch={handleTextMatch} />
      <TimerActionTextLauncher onAction={handleTimerActionText} />

      <div aria-hidden="true" className="pip-watermark-layer">
        <div className="pip-watermark-label pip-watermark-label-top">
          TIMERS
        </div>
        <img
          alt=""
          className="pip-watermark-lockup"
          src={jenaBrandLockupLargeUrl}
        />
        <div className="pip-watermark-label pip-watermark-label-bottom">
          ALERTS
        </div>
      </div>

      <section aria-label="Timers" className="pip-timer-stack">
        {timers.map((timer) => (
          <TimerBar
            key={timer.id}
            onRemove={removeTimer}
            onTimerAction={handleTimerAction}
            settings={machineSettings.pip.timers}
            timer={timer}
          />
        ))}
      </section>

      <section aria-label="Trigger text" className="pip-text-stack">
        {texts.map((text) => (
          <TextLine
            key={text.id}
            onRemove={removeText}
            settings={machineSettings.pip.alerts}
            text={text}
          />
        ))}
      </section>
    </main>
  )
}

function TriggerMatchTimerLauncher({
  onMatch,
}: {
  onMatch: (event: TriggerMatchEvent) => void
}) {
  useOnTriggerMatch(onMatch)
  return null
}

function TriggerMatchTextLauncher({
  onMatch,
}: {
  onMatch: (event: TriggerMatchEvent) => void
}) {
  useOnTriggerMatch(onMatch)
  return null
}

function TimerActionTextLauncher({
  onAction,
}: {
  onAction: (event: TriggerTimerActionEvent) => void
}) {
  useOnTimerAction(onAction)
  return null
}

function TimerBar({
  onRemove,
  onTimerAction,
  settings,
  timer,
}: {
  onRemove: (timerId: string) => void
  onTimerAction: (alert: TriggerTimerActionMessage) => void
  settings: PipTimerStyleSettings
  timer: RuntimeTimer
}) {
  const fillRef = useRef<HTMLDivElement | null>(null)
  const durationRef = useRef<HTMLSpanElement | null>(null)
  const endedCycleRef = useRef<number | null>(null)
  const endedFiredRef = useRef(false)
  const lastCycleIndexRef = useRef<number | null>(null)
  const removedRef = useRef(false)
  const timerRef = useRef(timer)
  const warnedCycleRef = useRef<number | null>(null)
  const warningFiredRef = useRef(false)

  useEffect(() => {
    timerRef.current = timer
    endedCycleRef.current = null
    endedFiredRef.current = false
    lastCycleIndexRef.current = null
    removedRef.current = false
    warnedCycleRef.current = null
    warningFiredRef.current = false
  }, [timer])

  useEffect(() => {
    let frameId = requestAnimationFrame(updateTimerBar)

    function updateTimerBar(nowMs: number) {
      const currentTimer = timerRef.current
      const elapsedMs = Math.max(0, nowMs - currentTimer.startedAtMs)
      const frame = getTimerFrame(currentTimer, elapsedMs)

      emitDueTimerActions(currentTimer, frame)

      if (fillRef.current) {
        fillRef.current.style.width = `${frame.progress * 100}%`
      }
      if (durationRef.current) {
        durationRef.current.textContent = frame.label
      }

      if (frame.complete && !removedRef.current) {
        removedRef.current = true
        onRemove(currentTimer.id)
        return
      }

      frameId = requestAnimationFrame(updateTimerBar)
    }

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [onRemove, onTimerAction, timer.generation, timer.id])

  function emitDueTimerActions(
    currentTimer: RuntimeTimer,
    frame: TimerFrame,
  ) {
    if (currentTimer.type === 'countdown') {
      maybeEmitCountdownWarning(currentTimer, frame)
      maybeEmitCountdownEnded(currentTimer, frame)
      return
    }

    if (currentTimer.type === 'repeating') {
      maybeEmitRepeatingEnded(currentTimer, frame)
      maybeEmitRepeatingWarning(currentTimer, frame)
    }
  }

  function maybeEmitCountdownWarning(
    currentTimer: RuntimeTimer,
    frame: TimerFrame,
  ) {
    if (
      warningFiredRef.current ||
      !currentTimer.warningAction ||
      currentTimer.warningSeconds <= 0
    ) {
      return
    }

    if (frame.remainingMs <= currentTimer.warningSeconds * 1000) {
      warningFiredRef.current = true
      emitTimerAction('warning', currentTimer, currentTimer.warningAction)
    }
  }

  function maybeEmitCountdownEnded(
    currentTimer: RuntimeTimer,
    frame: TimerFrame,
  ) {
    if (endedFiredRef.current || !currentTimer.endedAction || !frame.complete) {
      return
    }

    endedFiredRef.current = true
    emitTimerAction('ended', currentTimer, currentTimer.endedAction)
  }

  function maybeEmitRepeatingWarning(
    currentTimer: RuntimeTimer,
    frame: TimerFrame,
  ) {
    if (
      !currentTimer.warningAction ||
      currentTimer.warningSeconds <= 0 ||
      warnedCycleRef.current === frame.cycleIndex
    ) {
      return
    }

    if (frame.remainingMs <= currentTimer.warningSeconds * 1000) {
      warnedCycleRef.current = frame.cycleIndex
      emitTimerAction('warning', currentTimer, currentTimer.warningAction)
    }
  }

  function maybeEmitRepeatingEnded(
    currentTimer: RuntimeTimer,
    frame: TimerFrame,
  ) {
    const lastCycleIndex = lastCycleIndexRef.current

    if (lastCycleIndex === null) {
      lastCycleIndexRef.current = frame.cycleIndex
      return
    }

    if (
      frame.cycleIndex <= lastCycleIndex ||
      endedCycleRef.current === lastCycleIndex
    ) {
      return
    }

    lastCycleIndexRef.current = frame.cycleIndex
    if (!currentTimer.endedAction) {
      return
    }

    endedCycleRef.current = lastCycleIndex
    emitTimerAction('ended', currentTimer, currentTimer.endedAction)
  }

  function emitTimerAction(
    kind: TriggerTimerActionKind,
    currentTimer: RuntimeTimer,
    action: TriggerTimerActionPayload,
  ) {
    if (!action.displayText && !action.speechText) {
      return
    }

    onTimerAction(
      withoutUndefinedValues({
        characterName: currentTimer.characterName,
        displayText: action.displayText,
        kind,
        serverName: currentTimer.serverName,
        speechInterrupt: action.speechInterrupt,
        speechText: action.speechText,
        timerName: currentTimer.timerName,
        timestamp: new Date().toISOString(),
        trigger: currentTimer.trigger,
      }),
    )
  }

  useOnTimerEarlyEnder((event) => {
    if (!doesEarlyEnderMatchTimer(event, timerRef.current)) {
      return
    }

    if (!removedRef.current) {
      removedRef.current = true
      onRemove(timerRef.current.id)
    }
  })

  const lineHeightPx = getPipLineHeight(settings.fontSizePx)
  const timerBarStyle: CSSProperties = {
    backgroundColor: settings.backgroundColor,
    color: settings.foregroundColor,
    fontSize: `${settings.fontSizePx}px`,
    height: `${lineHeightPx}px`,
    lineHeight: `${lineHeightPx}px`,
  }
  const fillStyle: CSSProperties = {
    backgroundColor: settings.fillColor,
  }
  const textStyle: CSSProperties = {
    height: `${lineHeightPx}px`,
    lineHeight: `${lineHeightPx}px`,
  }

  return (
    <div className="pip-timer-bar" style={timerBarStyle}>
      <div className="pip-timer-fill" ref={fillRef} style={fillStyle} />
      <span className="pip-timer-name" style={textStyle}>
        {timer.timerName}
      </span>
      <span className="pip-timer-duration" ref={durationRef} style={textStyle}>
        {getInitialDurationLabel(timer)}
      </span>
    </div>
  )
}

function TextLine({
  onRemove,
  settings,
  text,
}: {
  onRemove: (textId: string) => void
  settings: PipTextStyleSettings
  text: RuntimeText
}) {
  useEffect(() => {
    const elapsedMs = performance.now() - text.createdAtMs
    const remainingMs = Math.max(0, defaultTextLifetimeMs - elapsedMs)
    const timeoutId = window.setTimeout(() => {
      onRemove(text.id)
    }, remainingMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [onRemove, text])

  const lineHeightPx = getPipLineHeight(settings.fontSizePx)
  const style: CSSProperties = {
    backgroundColor: settings.backgroundColor,
    color: settings.foregroundColor,
    flexBasis: `${lineHeightPx}px`,
    fontSize: `${settings.fontSizePx}px`,
    height: `${lineHeightPx}px`,
    lineHeight: `${lineHeightPx}px`,
  }

  return (
    <div className="pip-text-line" style={style}>
      {text.text}
    </div>
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

interface TimerFrame {
  complete: boolean
  cycleIndex: number
  label: string
  progress: number
  remainingMs: number
}

function getTimerFrame(timer: RuntimeTimer, elapsedMs: number): TimerFrame {
  switch (timer.type) {
    case 'countdown': {
      const remainingMs = Math.max(0, timer.durationMs - elapsedMs)
      return {
        complete: remainingMs <= 0,
        cycleIndex: 0,
        label: formatRemainingDuration(remainingMs),
        progress: timer.durationMs > 0 ? remainingMs / timer.durationMs : 0,
        remainingMs,
      }
    }
    case 'repeating': {
      const cycleElapsedMs = timer.durationMs > 0 ? elapsedMs % timer.durationMs : 0
      const remainingMs = Math.max(0, timer.durationMs - cycleElapsedMs)
      return {
        complete: false,
        cycleIndex: timer.durationMs > 0 ? Math.floor(elapsedMs / timer.durationMs) : 0,
        label: formatRemainingDuration(remainingMs),
        progress: timer.durationMs > 0 ? remainingMs / timer.durationMs : 0,
        remainingMs,
      }
    }
    case 'stopwatch':
      return {
        complete: false,
        cycleIndex: 0,
        label: formatElapsedDuration(elapsedMs),
        progress: timer.durationMs > 0 ? Math.min(1, elapsedMs / timer.durationMs) : 1,
        remainingMs: Number.POSITIVE_INFINITY,
      }
  }
}

function getInitialDurationLabel(timer: RuntimeTimer) {
  if (timer.type === 'stopwatch') {
    return formatElapsedDuration(0)
  }

  return formatRemainingDuration(timer.durationMs)
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

  return true
}

function formatRemainingDuration(durationMs: number) {
  return formatDuration(Math.ceil(Math.max(0, durationMs) / 1000))
}

function formatElapsedDuration(durationMs: number) {
  return formatDuration(Math.floor(Math.max(0, durationMs) / 1000))
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${padTimePart(minutes)}:${padTimePart(seconds)}`
  }

  if (minutes > 0) {
    return `${minutes}:${padTimePart(seconds)}`
  }

  return `${seconds}s`
}

function getPipLineHeight(fontSizePx: number) {
  return fontSizePx + 2
}

function padTimePart(value: number) {
  return value.toString().padStart(2, '0')
}

function isSameText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

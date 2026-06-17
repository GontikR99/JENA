import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  JenaTriggerTimer,
  JenaTriggerTimerType,
} from '../shared/triggers'
import {
  useOnTimerEarlyEnder,
  useOnTriggerStop,
  useOnTriggerMatch,
  type TimerEarlyEnderEvent,
  type TriggerMatchEvent,
} from '../triggers/alerts/useTriggerAlerts'
import './pip.css'

const defaultTextLifetimeMs = 5000
interface RuntimeTimer {
  characterName: string
  durationMs: number
  generation: number
  id: string
  serverName: string
  startedAtMs: number
  timerName: string
  triggerId: string
  type: JenaTriggerTimerType
}

interface RuntimeText {
  createdAtMs: number
  id: string
  text: string
}

export function Pip() {
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
            generation: runtimeTimer.generation + 1,
            serverName: event.alert.serverName,
            startedAtMs,
            timerName,
            triggerId: event.trigger.id,
            type: timer.type,
          }
        })
      }

      return [
        ...currentTimers,
        {
          characterName: event.alert.characterName,
          durationMs: timer.durationMs,
          generation: 0,
          id: `pip-timer-${nextTimerId.current++}`,
          serverName: event.alert.serverName,
          startedAtMs,
          timerName,
          triggerId: event.trigger.id,
          type: timer.type,
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

  return (
    <main className="pip-view">
      <TriggerMatchTimerLauncher onMatch={handleTimerMatch} />
      <TriggerMatchTextLauncher onMatch={handleTextMatch} />

      <section aria-label="Timers" className="pip-timer-stack">
        {timers.map((timer) => (
          <TimerBar key={timer.id} onRemove={removeTimer} timer={timer} />
        ))}
      </section>

      <section aria-label="Trigger text" className="pip-text-stack">
        {texts.map((text) => (
          <TextLine key={text.id} onRemove={removeText} text={text} />
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

function TimerBar({
  onRemove,
  timer,
}: {
  onRemove: (timerId: string) => void
  timer: RuntimeTimer
}) {
  const fillRef = useRef<HTMLDivElement | null>(null)
  const durationRef = useRef<HTMLSpanElement | null>(null)
  const removedRef = useRef(false)
  const timerRef = useRef(timer)

  useEffect(() => {
    timerRef.current = timer
    removedRef.current = false
  }, [timer])

  useEffect(() => {
    let frameId = requestAnimationFrame(updateTimerBar)

    function updateTimerBar(nowMs: number) {
      const currentTimer = timerRef.current
      const elapsedMs = Math.max(0, nowMs - currentTimer.startedAtMs)
      const frame = getTimerFrame(currentTimer, elapsedMs)

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
  }, [onRemove, timer.generation, timer.id])

  useOnTimerEarlyEnder((event) => {
    if (!doesEarlyEnderMatchTimer(event, timerRef.current)) {
      return
    }

    if (!removedRef.current) {
      removedRef.current = true
      onRemove(timerRef.current.id)
    }
  })

  return (
    <div className="pip-timer-bar">
      <div className="pip-timer-fill" ref={fillRef} />
      <span className="pip-timer-name">{timer.timerName}</span>
      <span className="pip-timer-duration" ref={durationRef}>
        {getInitialDurationLabel(timer)}
      </span>
    </div>
  )
}

function TextLine({
  onRemove,
  text,
}: {
  onRemove: (textId: string) => void
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

  return <div className="pip-text-line">{text.text}</div>
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

function getTimerFrame(timer: RuntimeTimer, elapsedMs: number) {
  switch (timer.type) {
    case 'countdown': {
      const remainingMs = Math.max(0, timer.durationMs - elapsedMs)
      return {
        complete: remainingMs <= 0,
        label: formatRemainingDuration(remainingMs),
        progress: timer.durationMs > 0 ? remainingMs / timer.durationMs : 0,
      }
    }
    case 'repeating': {
      const cycleElapsedMs = timer.durationMs > 0 ? elapsedMs % timer.durationMs : 0
      const remainingMs = Math.max(0, timer.durationMs - cycleElapsedMs)
      return {
        complete: false,
        label: formatRemainingDuration(remainingMs),
        progress: timer.durationMs > 0 ? remainingMs / timer.durationMs : 0,
      }
    }
    case 'stopwatch':
      return {
        complete: false,
        label: formatElapsedDuration(elapsedMs),
        progress: timer.durationMs > 0 ? Math.min(1, elapsedMs / timer.durationMs) : 1,
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

  if (event.alert.timerName && event.alert.timerName !== timer.timerName) {
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

function padTimePart(value: number) {
  return value.toString().padStart(2, '0')
}

function isSameText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

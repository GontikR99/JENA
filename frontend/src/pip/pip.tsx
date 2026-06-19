import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import jenaBrandLockupLargeUrl from '../assets/jena-brand-lockup-large.webp'
import { useSettings } from '../settings/settingsContext'
import type {
  PipTextStyleSettings,
  PipTimerStyleSettings,
} from '../settings/settingsTypes'
import {
  getInitialDurationLabel,
  getTimerFrame,
} from '../runtime/triggerTimerFrame'
import {
  useTriggerTimerRuntime,
  type RuntimeTimer,
} from '../runtime/triggerTimerRuntimeContext'
import {
  useOnTimerAction,
  useOnTriggerStop,
  useOnTriggerMatch,
  type TriggerTimerActionEvent,
  type TriggerMatchEvent,
} from '../triggers/alerts/useTriggerAlerts'
import './pip.css'

const defaultTextLifetimeMs = 5000

interface RuntimeText {
  createdAtMs: number
  id: string
  text: string
}

export function Pip() {
  const { machineSettings } = useSettings()
  const { removeTimer, timers } = useTriggerTimerRuntime()
  const nextTextId = useRef(1)
  const [texts, setTexts] = useState<RuntimeText[]>([])

  const removeText = useCallback((textId: string) => {
    setTexts((currentTexts) =>
      currentTexts.filter((text) => text.id !== textId),
    )
  }, [])

  useOnTriggerStop(() => {
    setTexts([])
  })

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
  settings,
  timer,
}: {
  onRemove: (timerId: string) => void
  settings: PipTimerStyleSettings
  timer: RuntimeTimer
}) {
  const fillRef = useRef<HTMLDivElement | null>(null)
  const durationRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef(timer)

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    let frameId = requestAnimationFrame(updateTimerBar)

    function updateTimerBar() {
      const currentTimer = timerRef.current
      const elapsedMs = Math.max(0, Date.now() - currentTimer.startedAtMs)
      const frame = getTimerFrame(currentTimer, elapsedMs)

      if (fillRef.current) {
        fillRef.current.style.width = `${frame.progress * 100}%`
      }
      if (durationRef.current) {
        durationRef.current.textContent = frame.label
      }

      frameId = requestAnimationFrame(updateTimerBar)
    }

    return () => {
      cancelAnimationFrame(frameId)
    }
  }, [timer.generation, timer.id])

  function handleCancelClick() {
    onRemove(timerRef.current.id)
  }

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
  const cancelButtonStyle: CSSProperties = {
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
      <button
        aria-label={`Cancel timer ${timer.timerName}`}
        className="pip-timer-cancel"
        onClick={handleCancelClick}
        style={cancelButtonStyle}
        type="button"
      >
        X
      </button>
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

function getPipLineHeight(fontSizePx: number) {
  return fontSizePx + 2
}

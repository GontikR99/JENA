import type { RuntimeTimer } from './triggerTimerRuntimeContext'

export interface TimerFrame {
  complete: boolean
  cycleIndex: number
  label: string
  progress: number
  remainingMs: number
}

export function getTimerFrame(
  timer: RuntimeTimer,
  elapsedMs: number,
): TimerFrame {
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
      const cycleElapsedMs =
        timer.durationMs > 0 ? elapsedMs % timer.durationMs : 0
      const remainingMs = Math.max(0, timer.durationMs - cycleElapsedMs)
      return {
        complete: false,
        cycleIndex:
          timer.durationMs > 0 ? Math.floor(elapsedMs / timer.durationMs) : 0,
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
        progress:
          timer.durationMs > 0 ? Math.min(1, elapsedMs / timer.durationMs) : 1,
        remainingMs: Number.POSITIVE_INFINITY,
      }
  }
}

export function getInitialDurationLabel(timer: RuntimeTimer) {
  if (timer.type === 'stopwatch') {
    return formatElapsedDuration(0)
  }

  return formatRemainingDuration(timer.durationMs)
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

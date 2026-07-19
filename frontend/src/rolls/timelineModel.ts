import type { RollTimeRange } from './types'

const quarterMinuteMs = 15_000
const halfMinuteMs = 30_000
const minuteMs = 60_000
const minimumMinorTickSpacingPx = 3
const minimumLabelSpacingPx = 18

export const timelineRangeDragThresholdPx = 10

export interface TimelineTick {
  kind: 'half' | 'minute' | 'quarter'
  showLabel: boolean
  timestampMs: number
  y: number
}

export function createTimelineTicks(
  nowMs: number,
  durationMs: number,
  height: number,
) {
  if (height <= 0 || durationMs <= 0) {
    return []
  }

  const quarterSpacingPx = (quarterMinuteMs / durationMs) * height
  const halfSpacingPx = (halfMinuteMs / durationMs) * height
  const minuteSpacingPx = (minuteMs / durationMs) * height
  const labelEveryMinutes = getLabelIntervalMinutes(minuteSpacingPx)
  const startMs = nowMs - durationMs
  const firstTickMs = Math.floor(nowMs / quarterMinuteMs) * quarterMinuteMs
  const ticks: TimelineTick[] = []

  for (
    let timestampMs = firstTickMs;
    timestampMs >= startMs;
    timestampMs -= quarterMinuteMs
  ) {
    const date = new Date(timestampMs)
    const second = date.getSeconds()
    const minute = date.getMinutes()
    const isMinute = second === 0
    const isHalfMinute = second === 30

    if (
      !isMinute &&
      ((isHalfMinute && halfSpacingPx < minimumMinorTickSpacingPx) ||
        (!isHalfMinute && quarterSpacingPx < minimumMinorTickSpacingPx))
    ) {
      continue
    }

    ticks.push({
      kind: isMinute ? 'minute' : isHalfMinute ? 'half' : 'quarter',
      showLabel: isMinute && minute % labelEveryMinutes === 0,
      timestampMs,
      y: getTimelineY(timestampMs, nowMs, durationMs, height),
    })
  }

  return ticks
}

export function getTimelineY(
  timestampMs: number,
  nowMs: number,
  durationMs: number,
  height: number,
) {
  return ((nowMs - timestampMs) / durationMs) * height
}

export function getTimelineTimestamp(
  y: number,
  nowMs: number,
  durationMs: number,
  height: number,
) {
  return nowMs - (y / height) * durationMs
}

export function isTimelineRangeDrag(
  startClientY: number,
  currentClientY: number,
) {
  return (
    Math.abs(currentClientY - startClientY) >=
    timelineRangeDragThresholdPx
  )
}

export function createTimelineRange(
  firstY: number,
  secondY: number,
  nowMs: number,
  durationMs: number,
  height: number,
): RollTimeRange {
  const firstTimestampMs = getTimelineTimestamp(
    firstY,
    nowMs,
    durationMs,
    height,
  )
  const secondTimestampMs = getTimelineTimestamp(
    secondY,
    nowMs,
    durationMs,
    height,
  )

  return {
    beginMs: Math.min(firstTimestampMs, secondTimestampMs),
    endMs: Math.max(firstTimestampMs, secondTimestampMs),
  }
}

function getLabelIntervalMinutes(minuteSpacingPx: number) {
  const minimumInterval = Math.max(
    1,
    Math.ceil(minimumLabelSpacingPx / minuteSpacingPx),
  )
  const intervals = [1, 2, 5, 10, 15, 30, 60]

  return intervals.find((interval) => interval >= minimumInterval) ?? 60
}

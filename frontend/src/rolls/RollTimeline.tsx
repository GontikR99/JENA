import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { RollRecord } from './types'
import {
  createTimelineTicks,
  getTimelineY,
  type TimelineTick,
} from './timelineModel'

const maximumTimelineUpdateIntervalMs = 250
const minimumTimelineUpdateIntervalMs = 16
const timelineUpdateDisplacementPx = 0.15
const cutoffKeyboardStepMs = 15_000
const rollSnapDistancePx = 6

interface RollTimelineProps {
  cutoffMs: number | null
  durationMs: number
  onCutoffChange: (cutoffMs: number | null) => void
  rolls: RollRecord[]
}

interface TimelineSize {
  height: number
  width: number
}

export function RollTimeline({
  cutoffMs,
  durationMs,
  onCutoffChange,
  rolls,
}: RollTimelineProps) {
  const [nowMs, setNowMs] = useState(Date.now)
  const [size, setSize] = useState<TimelineSize>({ height: 0, width: 0 })
  const svgRef = useRef<SVGSVGElement | null>(null)
  const patternId = `roll-cutoff-hatch-${useId().replaceAll(':', '')}`

  useEffect(() => {
    const pixelsPerMs = size.height / durationMs
    const updateIntervalMs =
      pixelsPerMs > 0
        ? clamp(
            timelineUpdateDisplacementPx / pixelsPerMs,
            minimumTimelineUpdateIntervalMs,
            maximumTimelineUpdateIntervalMs,
          )
        : maximumTimelineUpdateIntervalMs
    let animationFrameId: number | null = null
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null
    let disposed = false

    const scheduleUpdate = () => {
      timeoutId = globalThis.setTimeout(() => {
        animationFrameId = globalThis.requestAnimationFrame(() => {
          if (disposed) {
            return
          }

          setNowMs(Date.now())
          scheduleUpdate()
        })
      }, updateIntervalMs)
    }

    scheduleUpdate()

    return () => {
      disposed = true
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId)
      }
      if (animationFrameId !== null) {
        globalThis.cancelAnimationFrame(animationFrameId)
      }
    }
  }, [durationMs, size.height])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) {
      return
    }

    const updateSize = () => {
      const bounds = svg.getBoundingClientRect()
      setSize({
        height: Math.max(0, bounds.height),
        width: Math.max(0, bounds.width),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(svg)

    return () => {
      observer.disconnect()
    }
  }, [])

  const visibleRolls = useMemo(
    () =>
      rolls.filter(
        (roll) =>
          roll.timestampMs >= nowMs - durationMs &&
          roll.timestampMs <= nowMs,
      ),
    [durationMs, nowMs, rolls],
  )
  const ticks = useMemo(
    () => createTimelineTicks(nowMs, durationMs, size.height),
    [durationMs, nowMs, size.height],
  )
  const cutoffY =
    cutoffMs === null
      ? size.height
      : clamp(
          getTimelineY(cutoffMs, nowMs, durationMs, size.height),
          0,
          size.height,
        )

  const selectCutoffAtY = useCallback(
    (pointerY: number) => {
      if (size.height <= 0 || pointerY >= size.height - 1) {
        onCutoffChange(null)
        return
      }

      const clampedY = clamp(pointerY, 0, size.height)
      const snappedRoll = getNearestRollAtY(
        visibleRolls,
        clampedY,
        nowMs,
        durationMs,
        size.height,
      )
      const timestampMs = snappedRoll
        ? snappedRoll.timestampMs
        : Math.round(
            getTimelineTimestamp(
              clampedY,
              nowMs,
              durationMs,
              size.height,
            ) / 1000,
          ) * 1000

      onCutoffChange(clamp(timestampMs, nowMs - durationMs, nowMs))
    }, [durationMs, nowMs, onCutoffChange, size.height, visibleRolls],
  )

  function handleClick(event: MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    selectCutoffAtY(event.clientY - bounds.top)
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape' || event.key === 'End') {
      event.preventDefault()
      onCutoffChange(null)
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      onCutoffChange(nowMs)
      return
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    event.preventDefault()
    const effectiveCutoffMs = cutoffMs ?? nowMs - durationMs
    const direction = event.key === 'ArrowUp' ? 1 : -1
    const nextCutoffMs = clamp(
      effectiveCutoffMs + direction * cutoffKeyboardStepMs,
      nowMs - durationMs,
      nowMs,
    )

    onCutoffChange(
      nextCutoffMs <= nowMs - durationMs ? null : nextCutoffMs,
    )
  }

  return (
    <section className="roll-timeline" aria-label="Roll timeline">
      <svg
        aria-label="Roll cutoff"
        aria-orientation="vertical"
        aria-valuemax={Math.round(nowMs)}
        aria-valuemin={Math.round(nowMs - durationMs)}
        aria-valuenow={Math.round(cutoffMs ?? nowMs - durationMs)}
        aria-valuetext={
          cutoffMs === null
            ? 'No cutoff'
            : `Rolls since ${formatTimelineTime(cutoffMs)}`
        }
        className="roll-timeline-svg"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        ref={svgRef}
        role="slider"
        tabIndex={0}
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
      >
        <defs>
          <clipPath id={`${patternId}-clip`}>
            <rect height={size.height} width={size.width} x="0" y="0" />
          </clipPath>
          <pattern
            height="12"
            id={patternId}
            patternUnits="userSpaceOnUse"
            width="12"
          >
            <path
              className="roll-timeline-cutoff-hatch-line"
              d="M-3 12 L12 -3 M6 15 L15 6"
            />
          </pattern>
        </defs>

        <g clipPath={`url(#${patternId}-clip)`}>
          {cutoffY < size.height ? (
            <rect
              className="roll-timeline-cutoff-hatch"
              fill={`url(#${patternId})`}
              height={size.height - cutoffY}
              width={size.width}
              x="0"
              y={cutoffY}
            />
          ) : null}

          {visibleRolls.map((roll) => (
            <line
              className="roll-timeline-density-line"
              key={roll.id}
              x1="0"
              x2={size.width}
              y1={getTimelineY(
                roll.timestampMs,
                nowMs,
                durationMs,
                size.height,
              )}
              y2={getTimelineY(
                roll.timestampMs,
                nowMs,
                durationMs,
                size.height,
              )}
            />
          ))}

          {ticks.map((tick) => (
            <TimelineTickMarks
              key={tick.timestampMs}
              tick={tick}
              width={size.width}
            />
          ))}

          {cutoffMs !== null ? (
            <line
              className="roll-timeline-cutoff-line"
              x1="0"
              x2={size.width}
              y1={cutoffY}
              y2={cutoffY}
            />
          ) : null}
        </g>
      </svg>
    </section>
  )
}

function TimelineTickMarks({
  tick,
  width,
}: {
  tick: TimelineTick
  width: number
}) {
  const centerGap = Math.min(64, width * 0.44)
  const maximumTickLength = Math.max(0, (width - centerGap) / 2)
  const tickScale = tick.kind === 'minute' ? 1 : tick.kind === 'half' ? 0.62 : 0.36
  const tickLength = maximumTickLength * tickScale
  const leftEnd = tickLength
  const rightStart = width - tickLength

  return (
    <g className={`roll-timeline-tick roll-timeline-tick-${tick.kind}`}>
      <line x1="0" x2={leftEnd} y1={tick.y} y2={tick.y} />
      <line x1={rightStart} x2={width} y1={tick.y} y2={tick.y} />
      {tick.showLabel ? (
        <text
          className="roll-timeline-label"
          dominantBaseline="middle"
          textAnchor="middle"
          x={width / 2}
          y={tick.y}
        >
          {formatTimelineTime(tick.timestampMs)}
        </text>
      ) : null}
    </g>
  )
}

function getTimelineTimestamp(
  y: number,
  nowMs: number,
  durationMs: number,
  height: number,
) {
  return nowMs - (y / height) * durationMs
}

function getNearestRollAtY(
  rolls: RollRecord[],
  y: number,
  nowMs: number,
  durationMs: number,
  height: number,
) {
  return rolls.reduce<RollRecord | null>((nearestRoll, roll) => {
    const distance = Math.abs(
      getTimelineY(roll.timestampMs, nowMs, durationMs, height) - y,
    )
    if (distance > rollSnapDistancePx) {
      return nearestRoll
    }

    if (!nearestRoll) {
      return roll
    }

    const nearestDistance = Math.abs(
      getTimelineY(nearestRoll.timestampMs, nowMs, durationMs, height) - y,
    )
    return distance < nearestDistance ? roll : nearestRoll
  }, null)
}

function formatTimelineTime(timestampMs: number) {
  const date = new Date(timestampMs)
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`
}

function padNumber(value: number) {
  return String(value).padStart(2, '0')
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

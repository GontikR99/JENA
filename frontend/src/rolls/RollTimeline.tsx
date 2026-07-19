import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import type { RollRecord, RollTimeRange } from './types'
import {
  createTimelineRange,
  createTimelineTicks,
  getTimelineTimestamp,
  getTimelineY,
  isTimelineRangeDrag,
  type TimelineTick,
} from './timelineModel'

const maximumTimelineUpdateIntervalMs = 250
const minimumTimelineUpdateIntervalMs = 16
const timelineUpdateDisplacementPx = 0.15

interface RollTimelineProps {
  durationMs: number
  onRangeChange: (range: RollTimeRange) => void
  range: RollTimeRange
  rolls: RollRecord[]
}

interface TimelineSize {
  height: number
  width: number
}

interface TimelineDragState {
  currentY: number
  durationMs: number
  isRangeDrag: boolean
  nowMs: number
  pointerId: number
  startClientY: number
  startY: number
  timelineHeight: number
}

export function RollTimeline({
  durationMs,
  onRangeChange,
  range,
  rolls,
}: RollTimelineProps) {
  const [nowMs, setNowMs] = useState(Date.now)
  const [size, setSize] = useState<TimelineSize>({ height: 0, width: 0 })
  const [draftRange, setDraftRange] = useState<RollTimeRange | null>(null)
  const dragRef = useRef<TimelineDragState | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const patternId = `roll-range-hatch-${useId().replaceAll(':', '')}`

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
  const displayedRange = draftRange ?? range
  const beginY = getRangeBoundaryY(
    displayedRange.beginMs,
    size.height,
    nowMs,
    durationMs,
    size.height,
  )
  const endY = getRangeBoundaryY(
    displayedRange.endMs,
    0,
    nowMs,
    durationMs,
    size.height,
  )

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary || size.height <= 0) {
      return
    }

    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const startY = getPointerY(event.clientY, bounds, size.height)

    dragRef.current = {
      currentY: startY,
      durationMs,
      isRangeDrag: false,
      nowMs,
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startY,
      timelineHeight: size.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const currentY = getPointerY(
      event.clientY,
      bounds,
      drag.timelineHeight,
    )
    const isRangeDrag =
      drag.isRangeDrag ||
      isTimelineRangeDrag(drag.startClientY, event.clientY)
    const nextDrag = {
      ...drag,
      currentY,
      isRangeDrag,
    }

    dragRef.current = nextDrag
    if (isRangeDrag) {
      setDraftRange(createRangeFromDrag(nextDrag))
    }
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    const currentY = getPointerY(
      event.clientY,
      bounds,
      drag.timelineHeight,
    )
    const completedDrag = {
      ...drag,
      currentY,
      isRangeDrag:
        drag.isRangeDrag ||
        isTimelineRangeDrag(drag.startClientY, event.clientY),
    }

    onRangeChange(
      completedDrag.isRangeDrag
        ? createRangeFromDrag(completedDrag)
        : {
            beginMs: getTimelineTimestamp(
              currentY,
              completedDrag.nowMs,
              completedDrag.durationMs,
              completedDrag.timelineHeight,
            ),
            endMs: null,
          },
    )
    clearDrag(event.currentTarget, event.pointerId)
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return
    }

    clearDrag(event.currentTarget, event.pointerId)
  }

  function handleLostPointerCapture(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return
    }

    dragRef.current = null
    setDraftRange(null)
  }

  function clearDrag(svg: SVGSVGElement, pointerId: number) {
    dragRef.current = null
    setDraftRange(null)
    if (svg.hasPointerCapture(pointerId)) {
      svg.releasePointerCapture(pointerId)
    }
  }

  return (
    <div className="roll-timeline">
      <svg
        className="roll-timeline-svg"
        onLostPointerCapture={handleLostPointerCapture}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={svgRef}
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
              className="roll-timeline-range-hatch-line"
              d="M-3 12 L12 -3 M6 15 L15 6"
            />
          </pattern>
        </defs>

        <g clipPath={`url(#${patternId}-clip)`}>
          {displayedRange.endMs !== null && endY > 0 ? (
            <rect
              className="roll-timeline-range-hatch"
              fill={`url(#${patternId})`}
              height={endY}
              width={size.width}
              x="0"
              y="0"
            />
          ) : null}

          {displayedRange.beginMs !== null && beginY < size.height ? (
            <rect
              className="roll-timeline-range-hatch"
              fill={`url(#${patternId})`}
              height={size.height - beginY}
              width={size.width}
              x="0"
              y={beginY}
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

          {displayedRange.beginMs !== null ? (
            <line
              className="roll-timeline-range-line"
              x1="0"
              x2={size.width}
              y1={beginY}
              y2={beginY}
            />
          ) : null}

          {displayedRange.endMs !== null ? (
            <line
              className="roll-timeline-range-line"
              x1="0"
              x2={size.width}
              y1={endY}
              y2={endY}
            />
          ) : null}
        </g>
      </svg>
    </div>
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

function getRangeBoundaryY(
  timestampMs: number | null,
  defaultY: number,
  nowMs: number,
  durationMs: number,
  height: number,
) {
  return timestampMs === null
    ? defaultY
    : clamp(getTimelineY(timestampMs, nowMs, durationMs, height), 0, height)
}

function getPointerY(
  clientY: number,
  bounds: DOMRect,
  timelineHeight: number,
) {
  if (bounds.height <= 0) {
    return 0
  }

  return clamp(
    ((clientY - bounds.top) / bounds.height) * timelineHeight,
    0,
    timelineHeight,
  )
}

function createRangeFromDrag(drag: TimelineDragState): RollTimeRange {
  return createTimelineRange(
    drag.startY,
    drag.currentY,
    drag.nowMs,
    drag.durationMs,
    drag.timelineHeight,
  )
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

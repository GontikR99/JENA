import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CategorizedRolls } from './CategorizedRolls'
import { RollTimeline } from './RollTimeline'
import { useRolls } from './useRolls'
import './RollsView.css'

const minuteMs = 60_000
const categorizedClockIntervalMs = 1000

const durationOptions = [
  { label: '5 minutes', value: 5 * minuteMs },
  { label: '10 minutes', value: 10 * minuteMs },
  { label: '15 minutes', value: 15 * minuteMs },
  { label: '30 minutes', value: 30 * minuteMs },
  { label: '45 minutes', value: 45 * minuteMs },
  { label: '1 hour', value: 60 * minuteMs },
]

export function RollsView() {
  const { rolls } = useRolls()
  const [durationMs, setDurationMs] = useState(10 * minuteMs)
  const [cutoffMs, setCutoffMs] = useState<number | null>(null)
  const [nowMs, setNowMs] = useState(Date.now)

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => {
      const nextNowMs = Date.now()
      setNowMs(nextNowMs)
      setCutoffMs((currentCutoffMs) => {
        return currentCutoffMs !== null &&
          currentCutoffMs <= nextNowMs - durationMs
          ? null
          : currentCutoffMs
      })
    }, categorizedClockIntervalMs)

    return () => {
      globalThis.clearInterval(intervalId)
    }
  }, [durationMs])

  const effectiveCutoffMs = cutoffMs ?? nowMs - durationMs
  const visibleRolls = useMemo(
    () =>
      rolls.filter(
        (roll) =>
          roll.timestampMs >= effectiveCutoffMs &&
          roll.timestampMs <= nowMs,
      ),
    [effectiveCutoffMs, nowMs, rolls],
  )

  return (
    <div className="rolls-view">
      <RollTimeline
        cutoffMs={cutoffMs}
        durationMs={durationMs}
        onCutoffChange={setCutoffMs}
        rolls={rolls}
      />

      <section className="rolls-results" aria-label="Categorized rolls">
        <header className="rolls-toolbar">
          <label className="rolls-duration-control">
            <span>Show last</span>
            <select
              onChange={(event) => {
                const nextDurationMs = Number(event.target.value)
                const nextNowMs = Date.now()

                setDurationMs(nextDurationMs)
                setNowMs(nextNowMs)
                setCutoffMs((currentCutoffMs) => {
                  return currentCutoffMs !== null &&
                    currentCutoffMs <= nextNowMs - nextDurationMs
                    ? null
                    : currentCutoffMs
                })
              }}
              value={durationMs}
            >
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <span className="rolls-visible-count">
            {visibleRolls.length} {visibleRolls.length === 1 ? 'roll' : 'rolls'}
          </span>

          <button
            aria-label="Clear roll cutoff"
            className="rolls-reset-cutoff"
            disabled={cutoffMs === null}
            onClick={() => setCutoffMs(null)}
            title="Clear cutoff"
            type="button"
          >
            <RotateCcw aria-hidden="true" size={17} />
          </button>
        </header>

        <div className="rolls-results-scroll">
          <CategorizedRolls rolls={visibleRolls} />
        </div>
      </section>
    </div>
  )
}

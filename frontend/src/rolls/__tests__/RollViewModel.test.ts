import { describe, expect, it } from 'vitest'
import { categorizeRolls } from '../categorizedRollsModel'
import {
  createTimelineRange,
  createTimelineTicks,
  getTimelineTimestamp,
  getTimelineY,
  isTimelineRangeDrag,
} from '../timelineModel'
import type { RollRecord } from '../types'

describe('roll view models', () => {
  it('groups every roll for the same bounds into one descending table', () => {
    const categories = categorizeRolls([
      createRoll({ id: 'low', value: 34 }),
      createRoll({ id: 'other-range', lowerBound: 1, upperBound: 100, value: 50 }),
      createRoll({ id: 'high', roller: 'Jephian', value: 947 }),
    ])

    expect(categories.map((category) => category.key)).toEqual([
      ['1', '100'].join('\0'),
      ['0', '1000'].join('\0'),
    ])
    expect(categories[1].rolls.map((roll) => roll.id)).toEqual(['high', 'low'])
  })

  it('maps current time to the top and the duration boundary to the bottom', () => {
    expect(getTimelineY(100_000, 100_000, 10_000, 600)).toBe(0)
    expect(getTimelineY(90_000, 100_000, 10_000, 600)).toBe(600)
    expect(getTimelineTimestamp(150, 100_000, 10_000, 600)).toBe(97_500)
  })

  it('requires ten vertical pixels before treating a pointer gesture as a range drag', () => {
    expect(isTimelineRangeDrag(100, 109.99)).toBe(false)
    expect(isTimelineRangeDrag(100, 110)).toBe(true)
    expect(isTimelineRangeDrag(100, 90)).toBe(true)
  })

  it('creates the same absolute range in either drag direction without snapping', () => {
    expect(createTimelineRange(100.25, 300.75, 100_000, 10_000, 600)).toEqual({
      beginMs: 94_987.5,
      endMs: 98_329.16666666667,
    })
    expect(createTimelineRange(300.75, 100.25, 100_000, 10_000, 600)).toEqual({
      beginMs: 94_987.5,
      endMs: 98_329.16666666667,
    })
  })

  it('reduces labels and quarter-minute ticks for a one-hour ruler', () => {
    const nowMs = new Date(2026, 5, 20, 10, 0, 0).getTime()
    const ticks = createTimelineTicks(nowMs, 60 * 60_000, 600)
    const labels = ticks.filter((tick) => tick.showLabel)

    expect(ticks.some((tick) => tick.kind === 'quarter')).toBe(false)
    expect(ticks.some((tick) => tick.kind === 'half')).toBe(true)
    expect(labels.length).toBeLessThanOrEqual(31)
    expect(labels.length).toBeGreaterThan(0)
  })
})

function createRoll(overrides: Partial<RollRecord> = {}): RollRecord {
  return {
    firstObservedAtMs: 10_000,
    id: 'roll',
    lastObservedAtMs: 10_000,
    lowerBound: 0,
    observations: [
      {
        characterName: 'Jephian',
        observedAtMs: 10_000,
        serverName: 'Fangbreaker',
        timestamp: 'Sat Jun 20 21:32:31 2026',
        timestampMs: 20_000,
      },
    ],
    roller: 'Darkpeaches',
    serverName: 'Fangbreaker',
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs: 20_000,
    upperBound: 1000,
    value: 34,
    ...overrides,
  }
}

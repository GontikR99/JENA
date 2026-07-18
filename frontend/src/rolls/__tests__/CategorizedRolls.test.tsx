// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategorizedRolls } from '../CategorizedRolls'
import type { RollRecord } from '../types'

describe('CategorizedRolls', () => {
  it('renders every roll for a bounds pair in one descending table', () => {
    render(
      <CategorizedRolls
        rolls={[
          createRoll({ id: 'low', value: 34 }),
          createRoll({ id: 'high', roller: 'Jephian', value: 947 }),
        ]}
      />,
    )

    expect(screen.getByRole('heading', { name: '0..1000' })).toBeVisible()
    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')

    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('947Jephian')
    expect(rows[2]).toHaveTextContent('34Darkpeaches')
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

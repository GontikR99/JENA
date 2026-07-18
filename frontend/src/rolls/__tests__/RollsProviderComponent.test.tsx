// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import { rollPattern } from '../rollModel'
import { RollsProvider } from '../RollsProvider'
import { useRolls } from '../useRolls'

const hookState = vi.hoisted(() => ({
  listener: null as null | ((message: { payload: unknown }) => void),
  rpc: vi.fn(),
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (
    destination: string,
    callback: (message: { payload: unknown }) => void,
  ) => {
    if (destination === 'matcher.match-found') {
      hookState.listener = callback
    }
  },
  useRpc: () => hookState.rpc,
}))

describe('RollsProvider', () => {
  beforeEach(() => {
    hookState.listener = null
    hookState.rpc.mockReset()
    hookState.rpc.mockResolvedValue({})
  })

  it('registers its always-on matcher namespace', async () => {
    render(
      <RollsProvider>
        <RollCount />
      </RollsProvider>,
    )

    await waitFor(() => {
      expect(hookState.rpc).toHaveBeenCalledWith(
        'worker.matcher-service',
        'replace-patterns',
        {
          namespace: 'rolls',
          patterns: [{ pattern: rollPattern }],
        },
      )
    })
  })

  it('records roll matches while consumers are mounted', async () => {
    render(
      <RollsProvider>
        <RollCount />
      </RollsProvider>,
    )

    hookState.listener?.({ payload: createMatch() })

    await waitFor(() => {
      expect(screen.getByTestId('roll-count')).toHaveTextContent('1')
    })
  })
})

function RollCount() {
  const { rolls } = useRolls()
  return <span data-testid="roll-count">{rolls.length}</span>
}

function createMatch(): RegexMatchFoundMessage {
  const nowMs = Date.now()

  return {
    captures: {
      named: {
        lowerBound: '0',
        roller: 'Darkpeaches',
        upperBound: '1000',
        value: '34',
      },
      positional: ['Darkpeaches', '0', '1000', '34'],
    },
    characterName: 'Jephian',
    observedAtMs: nowMs,
    pattern: rollPattern,
    serverName: 'Fangbreaker',
    text: '**A Magic Die is rolled by Darkpeaches.',
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs: nowMs,
  }
}

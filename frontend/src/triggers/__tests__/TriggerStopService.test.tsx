// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import {
  TriggerStopService,
  triggerStopPattern,
} from '../alerts/TriggerStopService'

const hookState = vi.hoisted(() => ({
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  rpc: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (destination: string, callback: (message: { payload: unknown }) => void) => {
    hookState.listeners.set(destination, callback)
  },
  useRpc: () => hookState.rpc,
  useSender: () => hookState.send,
}))

describe('TriggerStopService', () => {
  beforeEach(() => {
    hookState.listeners.clear()
    hookState.rpc.mockReset()
    hookState.rpc.mockResolvedValue({})
    hookState.send.mockReset()
  })

  it('registers the inline case-insensitive stop pattern', async () => {
    render(<TriggerStopService />)

    await waitFor(() => {
      expect(hookState.rpc).toHaveBeenCalledWith(
        'worker.matcher-service',
        'add-patterns',
        {
          namespace: 'stop',
          patterns: [{ pattern: triggerStopPattern }],
        },
      )
    })
  })

  it('publishes stop requests for stop pattern matches', () => {
    render(<TriggerStopService />)

    emitMatch({
      pattern: triggerStopPattern,
      text: 'Incoming {gina:stop}',
    })

    expect(hookState.send).toHaveBeenCalledWith('alert.stop-requested', {
      characterName: 'Mesozoic',
      command: '{GINA:STOP}',
      serverName: 'Bristlebane',
      text: 'Incoming {gina:stop}',
      timestamp: '2026-06-17T12:00:00Z',
    })
  })

  it('ignores unrelated pattern matches', () => {
    render(<TriggerStopService />)

    emitMatch({
      pattern: '^other$',
      text: '{jena:stop}',
    })

    expect(hookState.send).not.toHaveBeenCalled()
  })
})

function emitMatch(overrides: Partial<RegexMatchFoundMessage>) {
  const listener = hookState.listeners.get('matcher.match-found')
  if (!listener) {
    throw new Error('matcher listener was not registered')
  }

  listener({
    payload: {
      captures: {
        named: {},
        positional: [],
      },
      characterName: 'Mesozoic',
      pattern: triggerStopPattern,
      serverName: 'Bristlebane',
      text: '{JENA:STOP}',
      timestamp: '2026-06-17T12:00:00Z',
      ...overrides,
    } satisfies RegexMatchFoundMessage,
  })
}

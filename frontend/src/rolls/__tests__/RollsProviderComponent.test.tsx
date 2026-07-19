// @vitest-environment jsdom

import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LogSearchMatchMessage,
  RegexMatchFoundMessage,
} from '../../shared/messages'
import { rollPattern } from '../rollModel'
import { RollsProvider } from '../RollsProvider'
import { useRolls } from '../useRolls'

const hookState = vi.hoisted(() => ({
  listeners: new Map<
    string,
    (message: { payload: unknown }) => void
  >(),
  rpc: vi.fn(),
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (
    destination: string,
    callback: (message: { payload: unknown }) => void,
  ) => {
    hookState.listeners.set(destination, callback)
  },
  useRpc: () => hookState.rpc,
}))

describe('RollsProvider', () => {
  beforeEach(() => {
    hookState.listeners.clear()
    hookState.rpc.mockReset()
    hookState.rpc.mockImplementation(
      async (_destination: string, method: string) => {
        return method === 'startLogSearch' ? { started: true } : {}
      },
    )
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

    emit('matcher.match-found', createMatch())

    await waitFor(() => {
      expect(screen.getByTestId('roll-count')).toHaveTextContent('1')
    })
  })

  it('prepopulates rolls by searching the initial log snapshot', async () => {
    const nowMs = Date.now()

    render(
      <RollsProvider>
        <RollCount />
      </RollsProvider>,
    )

    emit('file-watcher.logs-ready', {
      logs: [createLogFile(nowMs)],
    })

    const request = await getBackfillRequest()
    emit('log-search.match-found', createSearchMatch(request.searchId, nowMs))

    expect(screen.getByTestId('roll-count')).toHaveTextContent('0')

    emit('log-search.done', {
      matchCount: 1,
      searchId: request.searchId,
      status: 'complete',
      truncated: false,
    })

    await waitFor(() => {
      expect(screen.getByTestId('roll-count')).toHaveTextContent('1')
    })
    expect(request).toEqual(expect.objectContaining({
      characterName: 'Jephian',
      query: rollPattern,
      serverName: 'fangbreaker',
      startPolicy: 'ifIdle',
      useRegex: true,
    }))
  })

  it('discards partial history when a backfill search is canceled', async () => {
    const nowMs = Date.now()

    render(
      <RollsProvider>
        <RollCount />
      </RollsProvider>,
    )

    emit('file-watcher.logs-ready', {
      logs: [createLogFile(nowMs)],
    })

    const request = await getBackfillRequest()
    emit('log-search.match-found', createSearchMatch(request.searchId, nowMs))
    emit('log-search.done', {
      matchCount: 1,
      searchId: request.searchId,
      status: 'canceled',
      truncated: false,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByTestId('roll-count')).toHaveTextContent('0')
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
    text: createRollText(),
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs: nowMs,
  }
}

function createLogFile(nowMs: number) {
  return {
    characterName: 'Jephian',
    fileName: 'eqlog_Jephian_fangbreaker.txt',
    lastLogWriteMs: nowMs,
    serverName: 'fangbreaker',
  }
}

function createSearchMatch(
  searchId: string,
  nowMs: number,
): LogSearchMatchMessage {
  const timestampMs = nowMs - 30 * 60 * 1000
  const text = createRollText()

  return {
    characterName: 'Jephian',
    index: 0,
    rawLine: `[Sat Jun 20 21:32:31 2026] ${text}`,
    searchId,
    serverName: 'fangbreaker',
    text,
    timestamp: 'Sat Jun 20 21:32:31 2026',
    timestampMs,
  }
}

function createRollText() {
  return '**A Magic Die is rolled by Darkpeaches. It could have been any number from 0 to 1000, but this time it turned up a 34.'
}

function emit(destination: string, payload: unknown) {
  act(() => {
    hookState.listeners.get(destination)?.({ payload })
  })
}

async function getBackfillRequest() {
  await waitFor(() => {
    expect(hookState.rpc).toHaveBeenCalledWith(
      'worker.file-watcher',
      'startLogSearch',
      expect.any(Object),
    )
  })

  const call = hookState.rpc.mock.calls.find(
    ([destination, method]) =>
      destination === 'worker.file-watcher' && method === 'startLogSearch',
  )

  return call?.[2] as {
    characterName: string
    query: string
    searchId: string
    serverName: string
    startPolicy: string
    useRegex: boolean
  }
}

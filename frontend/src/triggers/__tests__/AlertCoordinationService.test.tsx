// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaTrigger,
} from '../../shared/triggers'
import { AlertCoordinationService } from '../alerts/AlertCoordinationService'

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

vi.mock('../../settings/settingsContext', () => ({
  useSettings: () => ({
    machineSettings: {
      includeCharacterNameForTriggerMatches: 'never',
    },
  }),
}))

describe('AlertCoordinationService', () => {
  beforeEach(() => {
    hookState.listeners.clear()
    hookState.rpc.mockReset()
    hookState.rpc.mockResolvedValue({})
    hookState.send.mockReset()
  })

  it('emits substituted clipboard text on trigger matches', () => {
    const trigger = createTrigger()

    render(<AlertCoordinationService />)
    emit('trigger-store.triggers-seen', {
      triggers: [trigger],
    })
    emit('matcher.match-found', createMatch())

    expect(hookState.send).toHaveBeenCalledWith(
      'alert.trigger-matched',
      expect.objectContaining({
        characterName: 'Mesozoic',
        clipboardText: 'Copy Fireball for Mesozoic',
        displayText: 'Display Fireball',
        speechText: 'Say Mesozoic',
        timerName: 'Timer Fireball',
      }),
    )
  })
})

function emit(destination: string, payload: unknown) {
  const listener = hookState.listeners.get(destination)
  if (!listener) {
    throw new Error(`No listener registered for ${destination}`)
  }

  listener({ payload })
}

function createTrigger(): JenaTrigger {
  return withCanonicalTriggerId({
    ...createEmptyTrigger(),
    actions: {
      clipboard: {
        enabled: true,
        text: 'Copy ${spell} for {C}',
      },
      display: {
        enabled: true,
        text: 'Display ${spell}',
      },
      speech: {
        enabled: true,
        interrupt: false,
        text: 'Say {C}',
      },
    },
    match: {
      isRegex: true,
      text: '^Boss casts (?<spell>.+) on {C}$',
    },
    name: 'Clipboard Trigger',
    timer: {
      durationMs: 10_000,
      earlyEnders: [],
      endedAction: null,
      name: 'Timer ${spell}',
      startBehavior: 'restart',
      type: 'countdown',
      warningAction: null,
      warningSeconds: 0,
    },
  })
}

function createMatch(): RegexMatchFoundMessage {
  const pattern = hookState.rpc.mock.calls[0]?.[2]?.patterns?.[0]?.pattern
  if (typeof pattern !== 'string') {
    throw new Error('Trigger pattern was not registered')
  }
  const text = 'Boss casts Fireball on Mesozoic'
  const match = new RegExp(pattern, 'i').exec(text)
  if (!match) {
    throw new Error(`Pattern did not match: ${pattern}`)
  }

  return {
    captures: {
      named: Object.fromEntries(
        Object.entries(match.groups ?? {}).map(([name, value]) => [
          name,
          value ?? null,
        ]),
      ),
      positional: match.slice(1).map((value) => value ?? null),
    },
    characterName: 'Mesozoic',
    pattern,
    serverName: 'Bristlebane',
    text,
    timestamp: '2026-06-17T12:00:00Z',
  }
}

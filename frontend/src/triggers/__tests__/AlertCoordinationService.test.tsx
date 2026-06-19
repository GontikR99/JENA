// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { act } from 'react'
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
      tts: {
        pitch: 1.2,
        rate: 0.9,
        useBroadcasterSpeechProfile: true,
        voiceURI: 'voice:test',
        volume: 0.75,
      },
    },
  }),
}))

vi.mock('../../settings/speechVoiceContext', () => ({
  useSpeechVoices: () => ({
    voiceByURI: new Map([
      [
        'voice:test',
        {
          default: false,
          lang: 'en-US',
          localService: true,
          name: 'Test Voice',
          voiceURI: 'voice:test',
        },
      ],
    ]),
  }),
}))

describe('AlertCoordinationService', () => {
  beforeEach(() => {
    hookState.listeners.clear()
    hookState.rpc.mockReset()
    hookState.rpc.mockImplementation((endpoint: string, method: string) => {
      if (endpoint === 'worker.character-presence' && method === 'getCharacters') {
        return Promise.resolve({
          characters: [
            {
              active: true,
              characterName: 'Mesozoic',
              serverName: 'Bristlebane',
              zone: 'Guild Lobby',
            },
          ],
        })
      }

      return Promise.resolve({})
    })
    hookState.send.mockReset()
  })

  it('emits substituted clipboard text on trigger matches', async () => {
    const trigger = createTrigger()

    render(<AlertCoordinationService />)
    emit('trigger-store.triggers-seen', {
      triggers: [trigger],
    })
    await flushPatternRegistration()
    emit('matcher.match-found', createMatch())

    expect(hookState.send).toHaveBeenCalledWith(
      'alert.trigger-matched',
      expect.objectContaining({
        characterName: 'Mesozoic',
        clipboardText: 'Copy Fireball for Mesozoic',
        displayText: 'Display Fireball in Guild Lobby',
        speechProfile: {
          pitch: 1.2,
          rate: 0.9,
          voiceLang: 'en-US',
          voiceName: 'Test Voice',
          voiceURI: 'voice:test',
          volume: 0.75,
        },
        speechText: 'Say Mesozoic',
        timerEndedAction: {
          displayText: 'Ended Fireball',
          speechInterrupt: true,
          speechText: 'Ended Mesozoic',
        },
        timerName: 'Timer Fireball',
        timerWarningAction: {
          displayText: 'Warning Fireball',
          speechInterrupt: false,
          speechText: 'Warning Mesozoic',
        },
      }),
    )
  })

  it('batches pattern registration for seen triggers', async () => {
    const firstTrigger = createTrigger()
    const secondTrigger = createTrigger({
      matchText: '^Boss begins casting (?<spell>.+)$',
      name: 'Second Trigger',
    })

    render(<AlertCoordinationService />)
    emit('trigger-store.triggers-seen', {
      triggers: [firstTrigger, secondTrigger],
    })
    await flushPatternRegistration()

    expect(hookState.rpc).toHaveBeenCalledWith(
      'worker.matcher-service',
      'add-patterns',
      {
        patterns: [
          expect.objectContaining({ pattern: expect.any(String) }),
          expect.objectContaining({ pattern: expect.any(String) }),
        ],
      },
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

async function flushPatternRegistration() {
  await act(async () => {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))
  })
}

function createTrigger({
  matchText = '^Boss casts (?<spell>.+) on {C}$',
  name = 'Clipboard Trigger',
} = {}): JenaTrigger {
  return withCanonicalTriggerId({
    ...createEmptyTrigger(),
    actions: {
      clipboard: {
        enabled: true,
        text: 'Copy ${spell} for {C}',
      },
      display: {
        enabled: true,
        text: 'Display ${spell} in {Z}',
      },
      speech: {
        enabled: true,
        interrupt: false,
        text: 'Say {C}',
      },
    },
    match: {
      isRegex: true,
      text: matchText,
    },
    name,
    timer: {
      durationMs: 10_000,
      earlyEnders: [],
      endedAction: {
        display: {
          enabled: true,
          text: 'Ended ${spell}',
        },
        speech: {
          enabled: true,
          interrupt: true,
          text: 'Ended {C}',
        },
      },
      name: 'Timer ${spell}',
      startBehavior: 'restart',
      type: 'countdown',
      warningAction: {
        display: {
          enabled: true,
          text: 'Warning ${spell}',
        },
        speech: {
          enabled: true,
          interrupt: false,
          text: 'Warning {C}',
        },
      },
      warningSeconds: 0,
    },
  })
}

function createMatch(): RegexMatchFoundMessage {
  const patternRegistrationCall = hookState.rpc.mock.calls.find(([endpoint, method]) => {
    return endpoint === 'worker.matcher-service' && method === 'add-patterns'
  })
  const pattern = patternRegistrationCall?.[2]?.patterns?.[0]?.pattern
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

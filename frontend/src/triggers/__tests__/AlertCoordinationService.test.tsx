// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaTrigger,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import { AlertCoordinationService } from '../alerts/AlertCoordinationService'

const hookState = vi.hoisted(() => ({
  localCharacters: [
    {
      active: true,
      characterName: 'Mesozoic',
      lastLogWriteMs: 1,
      serverName: 'Bristlebane',
      zone: 'Guild Lobby',
    },
  ],
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  rpc: vi.fn(),
  send: vi.fn(),
  subscribedTriggers: [] as JenaTrigger[],
  userTriggers: [] as JenaResolvedTrigger[],
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

vi.mock('../../characters/LocalCharactersProvider', () => ({
  useLocalCharacters: () => hookState.localCharacters,
}))

vi.mock('../model/UserTriggerManager', () => ({
  useTriggerManager: () => ({
    getTriggerAlertRegistration: (
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      const resolvedTrigger = hookState.userTriggers.find(
        (candidate) => candidate.trigger.id === triggerId,
      )

      if (!resolvedTrigger) {
        return null
      }

      return {
        broadcastMode: resolvedTrigger.broadcastMode,
        enabled: resolvedTrigger.enabledFor.some((enabledCharacter) => {
          return (
            enabledCharacter.characterName === character.characterName &&
            enabledCharacter.serverName === character.serverName
          )
        }),
        source: 'user',
      }
    },
    triggers: hookState.userTriggers,
  }),
}))

vi.mock('../model/SubscribedTriggerManager', () => ({
  useSubscribedTriggerManager: () => ({
    getTriggerAlertRegistrations: () => [],
    snapshots: hookState.subscribedTriggers.length
      ? [
          {
            digest: 'test-digest',
            id: 'test-subscription',
            ownerDisplayName: 'Publisher',
            records: hookState.subscribedTriggers.map((trigger) => ({
              broadcastToSubscribers: false,
              triggerId: trigger.id,
            })),
            triggers: hookState.subscribedTriggers.map((trigger) => ({
              broadcastToSubscribers: false,
              trigger,
            })),
          },
        ]
      : [],
  }),
}))

describe('AlertCoordinationService', () => {
  beforeEach(() => {
    hookState.listeners.clear()
    hookState.localCharacters = [
      {
        active: true,
        characterName: 'Mesozoic',
        lastLogWriteMs: 1,
        serverName: 'Bristlebane',
        zone: 'Guild Lobby',
      },
    ]
    hookState.rpc.mockReset()
    hookState.rpc.mockImplementation((endpoint: string, method: string) => {
      if (endpoint === 'worker.character-presence' && method === 'getCharacters') {
        return Promise.resolve({
          characters: [
            {
              active: true,
              characterName: 'Mesozoic',
              lastLogWriteMs: 1,
              serverName: 'Bristlebane',
              zone: 'Guild Lobby',
            },
          ],
        })
      }

      return Promise.resolve({})
    })
    hookState.send.mockReset()
    hookState.subscribedTriggers = []
    hookState.userTriggers = []
  })

  it('emits substituted clipboard text on trigger matches', async () => {
    const trigger = createTrigger()
    hookState.userTriggers = [resolveTrigger(trigger)]

    render(<AlertCoordinationService />)
    await flushPatternRegistration()
    emit('matcher.match-found', createMatch())

    expect(hookState.send).toHaveBeenCalledWith(
      'alert.trigger-matched',
      expect.objectContaining({
        characterName: 'Mesozoic',
        clipboardText: 'Copy Fireball for Mesozoic',
        displayText: 'Display Fireball in Guild Lobby',
        matchCaptures: {
          capturesByKey: {
            C: 'Mesozoic',
          },
          namedCaptures: {
            spell: 'Fireball',
          },
          positionalCaptures: ['Fireball'],
        },
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
    hookState.userTriggers = [
      resolveTrigger(firstTrigger),
      resolveTrigger(secondTrigger),
    ]

    render(<AlertCoordinationService />)
    await flushPatternRegistration()

    expect(hookState.rpc).toHaveBeenCalledWith(
      'worker.matcher-service',
      'replace-patterns',
      {
        namespace: 'alerts',
        patterns: [
          expect.objectContaining({ pattern: expect.any(String) }),
          expect.objectContaining({ pattern: expect.any(String) }),
        ],
      },
    )
  })

  it('ignores a malformed trigger without preventing other patterns from registering', async () => {
    const malformedTrigger = createTrigger({
      matchText:
        "a_mechanical_contraption whirs and clicks, 'Processing... Target --> ${1}",
      name: 'Malformed Trigger',
    })
    const validTrigger = createTrigger()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    hookState.userTriggers = [
      resolveTrigger(malformedTrigger),
      resolveTrigger(validTrigger),
    ]

    try {
      render(<AlertCoordinationService />)
      await flushPatternRegistration()

      const registrationCall = getAlertPatternRegistrationCall()
      expect(registrationCall?.[2]).toEqual({
        namespace: 'alerts',
        patterns: [
          expect.objectContaining({
            pattern: expect.stringContaining('Boss casts'),
          }),
        ],
      })
      expect(warn).toHaveBeenCalledWith(
        '[AlertCoordinationService] trigger pattern ignored',
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Unknown trigger capture reference "1".',
          }),
          triggerId: malformedTrigger.id,
          triggerName: 'Malformed Trigger',
          triggerPattern: malformedTrigger.match.text,
        }),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('registers early enders for disabled triggers', async () => {
    const trigger = createTriggerWithEarlyEnder()
    hookState.userTriggers = [
      {
        ...resolveTrigger(trigger),
        enabledFor: [],
      },
    ]

    render(<AlertCoordinationService />)
    await flushPatternRegistration()

    const registrationCall = getAlertPatternRegistrationCall()
    expect(registrationCall?.[2]).toEqual({
      namespace: 'alerts',
      patterns: [
        expect.objectContaining({
          pattern: expect.stringContaining('early end'),
        }),
      ],
    })
  })

  it('emits early ender match captures for timer validation', async () => {
    const trigger = createTriggerWithEarlyEnder({
      earlyEnderText: '^early end (?<effect>.+) for {S}$',
      isRegex: true,
    })
    hookState.userTriggers = [resolveTrigger(trigger)]

    render(<AlertCoordinationService />)
    await flushPatternRegistration()
    emit('matcher.match-found', createEarlyEnderMatch())

    expect(hookState.send).toHaveBeenCalledWith(
      'alert.timer-early-ended',
      expect.objectContaining({
        matchCaptures: {
          capturesByKey: {
            S: 'Mesozoic',
          },
          namedCaptures: {
            effect: 'Fireball',
          },
          positionalCaptures: ['Fireball'],
        },
      }),
    )
  })

  it('emits original trigger capture references from timer early enders', async () => {
    const trigger = createTriggerWithEarlyEnder({
      earlyEnderText: '^--${player} has looted {item} from .+--$',
      isRegex: true,
      matchText: '^A (?<item>.+) was given to (?<player>[A-Za-z]+)\\.$',
    })
    hookState.userTriggers = [resolveTrigger(trigger)]

    render(<AlertCoordinationService />)
    await flushPatternRegistration()
    emit(
      'matcher.match-found',
      createEarlyEnderMatch(
        "--Succor has looted Supple Slippers of the Stargazer from corpse.--",
      ),
    )

    expect(hookState.send).toHaveBeenCalledWith(
      'alert.timer-early-ended',
      expect.objectContaining({
        matchCaptures: expect.objectContaining({
          namedCaptures: {
            item: 'Supple Slippers of the Stargazer',
            player: 'Succor',
          },
        }),
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

async function flushPatternRegistration() {
  await act(async () => {
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150))
  })
}

function resolveTrigger(trigger: JenaTrigger): JenaResolvedTrigger {
  return {
    broadcastMode: 'private',
    enabledFor: [
      {
        characterName: 'Mesozoic',
        serverName: 'Bristlebane',
      },
    ],
    publish: false,
    trigger,
  }
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

function createTriggerWithEarlyEnder({
  earlyEnderText = 'early end',
  isRegex = false,
  matchText,
}: {
  earlyEnderText?: string
  isRegex?: boolean
  matchText?: string
} = {}): JenaTrigger {
  return withCanonicalTriggerId({
    ...createTrigger({
      ...(matchText ? { matchText } : {}),
      name: 'Disabled Early Ender Trigger',
    }),
    timer: {
      durationMs: 10_000,
      earlyEnders: [
        {
          isRegex,
          text: earlyEnderText,
        },
      ],
      endedAction: null,
      name: 'Timer',
      startBehavior: 'restart',
      type: 'countdown',
      warningAction: null,
      warningSeconds: 0,
    },
  })
}

function createEarlyEnderMatch(
  text = 'early end Fireball for Mesozoic',
): RegexMatchFoundMessage {
  const patternRegistrationCall = getAlertPatternRegistrationCall()
  const pattern = patternRegistrationCall?.[2]?.patterns?.find(
    (registration: { pattern?: unknown }, index: number) => {
      if (index === 0 || typeof registration.pattern !== 'string') {
        return false
      }

      return new RegExp(registration.pattern, 'i').test(text)
    },
  )?.pattern
  if (typeof pattern !== 'string') {
    throw new Error('Early ender pattern was not registered')
  }
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
    timestamp: '2026-06-17T12:00:01Z',
  }
}

function createMatch(): RegexMatchFoundMessage {
  const patternRegistrationCall = getAlertPatternRegistrationCall()
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

function getAlertPatternRegistrationCall() {
  return hookState.rpc.mock.calls.find(([endpoint, method, params]) => {
    return (
      endpoint === 'worker.matcher-service' &&
      method === 'replace-patterns' &&
      params?.namespace === 'alerts'
    )
  })
}

// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AlertCaptureSnapshot,
  BroadcastAlertMessage,
  TriggerTimerActionMessage,
} from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
  type JenaTrigger,
} from '../../shared/triggers'
import { TriggerTimerRuntimeProvider } from '../../runtime/TriggerTimerRuntime'
import { useTriggerTimerRuntime } from '../../runtime/triggerTimerRuntimeContext'
import { AlertEventCoordinatorProvider } from '../alerts/AlertEventCoordinator'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  headlessMode: false,
  lastStartedAtMs: null as number | null,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  localCharacters: [] as Array<{
    active: boolean
    characterName: string
    lastLogWriteMs: number
    serverName: string
    zone: string
  }>,
  sentMessages: [] as Array<{
    destination: string
    payload: TriggerTimerActionMessage
  }>,
  subscribedTriggerIds: new Set<string>(),
  triggers: [] as JenaResolvedTrigger[],
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (destination: string, callback: (message: { payload: unknown }) => void) => {
    hookState.listeners.set(destination, callback)
  },
  useSender: () => (destination: string, payload: TriggerTimerActionMessage) => {
    hookState.sentMessages.push({
      destination,
      payload,
    })
  },
}))

vi.mock('../../runtime/TriggerRuntime', () => ({
  useTriggerRuntime: () => ({
    areTriggersRunning: hookState.areTriggersRunning,
    lastStartedAtMs: hookState.lastStartedAtMs,
  }),
}))

vi.mock('../../characters/LocalCharactersProvider', () => ({
  useLocalCharacters: () => hookState.localCharacters,
}))

vi.mock('../../settings/settingsContext', () => ({
  useSettings: () => ({
    machineSettings: {
      headlessMode: hookState.headlessMode,
      includeCharacterNameForTriggerMatches: 'never',
    },
  }),
}))

vi.mock('../model/UserTriggerManager', () => ({
  useTriggerManager: () => ({
    getTimerEarlyEnderBroadcastRegistration: (triggerId: string) => {
      return hookState.triggers.some(
        (resolvedTrigger) => resolvedTrigger.trigger.id === triggerId,
      )
        ? {
            broadcastMode: 'private',
            enabled: true,
            source: 'user',
          }
        : null
    },
    getTriggerAlertRegistration: (
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      const resolvedTrigger = hookState.triggers.find(
        (candidate) => candidate.trigger.id === triggerId,
      )

      if (!resolvedTrigger) {
        return null
      }

      return {
        broadcastMode: resolvedTrigger.broadcastMode,
        enabled: resolvedTrigger.enabledFor.some((enabledCharacter) =>
          isSameCharacter(enabledCharacter, character),
        ),
        source: 'user',
      }
    },
    triggers: hookState.triggers,
  }),
}))

vi.mock('../model/SubscribedTriggerManager', () => ({
  useSubscribedTriggerManager: () => ({
    getTimerEarlyEnderBroadcastRegistrations: (triggerId: string) => {
      if (!hookState.subscribedTriggerIds.has(triggerId)) {
        return []
      }

      return [
        {
          broadcastMode: 'subscribers',
          enabled: true,
          source: 'subscription',
          subscriptionId: 'test-subscription',
        },
      ]
    },
    getTriggerAlertRegistrations: () => [],
    hasSubscriptionTrigger: (subscriptionId: string, triggerId: string) => {
      return (
        subscriptionId === 'test-subscription' &&
        hookState.subscribedTriggerIds.has(triggerId)
      )
    },
    isSubscriptionTriggerEnabledForCharacter: (
      subscriptionId: string,
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      return (
        subscriptionId === 'test-subscription' &&
        hookState.subscribedTriggerIds.has(triggerId) &&
        isSameCharacter(character, {
          characterName: 'Mesozoic',
          serverName: 'Bristlebane',
        })
      )
    },
  }),
}))

const trigger = withCanonicalTriggerId({
  ...createEmptyTrigger(),
  match: {
    isRegex: true,
    text: '^test$',
  },
  name: 'Broadcast Timer Trigger',
  timer: {
    durationMs: 10_000,
    earlyEnders: [
      {
        isRegex: true,
        text: '{S} fades',
      },
    ],
    endedAction: null,
    name: 'Broadcast Timer',
    startBehavior: 'restart',
    type: 'countdown',
    warningAction: null,
    warningSeconds: 0,
  },
})

describe('broadcast timer runtime integration', () => {
  beforeEach(() => {
    hookState.areTriggersRunning = true
    hookState.headlessMode = false
    hookState.lastStartedAtMs = null
    hookState.listeners.clear()
    hookState.localCharacters = []
    hookState.sentMessages = []
    hookState.subscribedTriggerIds = new Set()
    hookState.triggers = [resolveTrigger(trigger)]
  })

  it('starts a timer from a broadcast trigger and stops it from a matching broadcast early ender', () => {
    renderHarness()

    act(() => {
      emitBroadcast({
        alert: createTriggerAlert({
          matchCaptures: createCaptureSnapshot({
            capturesByKey: {
              S: 'Viral Decay',
            },
          }),
        }),
        eventId: 'broadcast-trigger-start',
        kind: 'triggerMatched',
      })
    })

    expect(screen.getByText('Broadcast Timer')).toBeInTheDocument()

    act(() => {
      emitBroadcast({
        alert: createEarlyEnderAlert({
          matchCaptures: createCaptureSnapshot({
            capturesByKey: {
              S: 'Mana Drain',
            },
          }),
        }),
        eventId: 'broadcast-early-ender-mismatch',
        kind: 'timerEarlyEnded',
      })
    })

    expect(screen.getByText('Broadcast Timer')).toBeInTheDocument()

    act(() => {
      emitBroadcast({
        alert: createEarlyEnderAlert({
          matchCaptures: createCaptureSnapshot({
            capturesByKey: {
              S: 'Viral Decay',
            },
          }),
        }),
        eventId: 'broadcast-early-ender-match',
        kind: 'timerEarlyEnded',
      })
    })

    expect(screen.queryByText('Broadcast Timer')).not.toBeInTheDocument()
  })

  it('starts and stops a timer from subscribed broadcast messages after the subscription gate passes', () => {
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(trigger.id)
    hookState.localCharacters = [
      {
        active: true,
        characterName: 'Mesozoic',
        lastLogWriteMs: 1,
        serverName: 'Bristlebane',
        zone: 'Guild Lobby',
      },
    ]
    renderHarness()

    act(() => {
      emitBroadcast({
        alert: createTriggerAlert({
          characterName: 'Jephine',
          matchCaptures: createCaptureSnapshot({
            capturesByKey: {
              S: 'Mask Click',
            },
          }),
        }),
        eventId: 'subscription-broadcast-trigger-start',
        kind: 'triggerMatched',
        subscriptionId: 'test-subscription',
      })
    })

    expect(screen.getByText('Broadcast Timer')).toBeInTheDocument()

    act(() => {
      emitBroadcast({
        alert: createEarlyEnderAlert({
          characterName: 'Jephine',
          matchCaptures: createCaptureSnapshot({
            capturesByKey: {
              S: 'Mask Click',
            },
          }),
        }),
        eventId: 'subscription-broadcast-early-ender',
        kind: 'timerEarlyEnded',
        subscriptionId: 'test-subscription',
      })
    })

    expect(screen.queryByText('Broadcast Timer')).not.toBeInTheDocument()
  })
})

function renderHarness() {
  render(
    <AlertEventCoordinatorProvider>
      <TriggerTimerRuntimeProvider>
        <TimerList />
      </TriggerTimerRuntimeProvider>
    </AlertEventCoordinatorProvider>,
  )
}

function TimerList() {
  const { timers } = useTriggerTimerRuntime()

  return (
    <div>
      {timers.map((timer) => (
        <div key={timer.id}>{timer.timerName}</div>
      ))}
    </div>
  )
}

function emitBroadcast(payload: BroadcastAlertMessage) {
  const listener = hookState.listeners.get('alert.broadcast')
  if (!listener) {
    throw new Error('No alert.broadcast listener registered.')
  }

  listener({ payload })
}

function resolveTrigger(jenaTrigger: JenaTrigger): JenaResolvedTrigger {
  return {
    broadcastMode: 'private',
    enabledFor: [
      {
        characterName: 'Mesozoic',
        serverName: 'Bristlebane',
      },
    ],
    publish: false,
    trigger: jenaTrigger,
  }
}

function createTriggerAlert({
  characterName = 'Mesozoic',
  matchCaptures = createCaptureSnapshot(),
}: {
  characterName?: string
  matchCaptures?: AlertCaptureSnapshot
} = {}) {
  return {
    characterName,
    matchCaptures,
    serverName: 'Bristlebane',
    text: 'test',
    timerName: 'Broadcast Timer',
    timestamp: '2026-06-20T00:00:00.000Z',
    trigger,
  }
}

function createEarlyEnderAlert({
  characterName = 'Mesozoic',
  matchCaptures = createCaptureSnapshot(),
}: {
  characterName?: string
  matchCaptures?: AlertCaptureSnapshot
} = {}) {
  return {
    characterName,
    matchCaptures,
    serverName: 'Bristlebane',
    text: 'end timer',
    timestamp: '2026-06-20T00:00:01.000Z',
    trigger,
  }
}

function createCaptureSnapshot({
  capturesByKey = {},
  namedCaptures = {},
  positionalCaptures = [],
}: Partial<AlertCaptureSnapshot> = {}): AlertCaptureSnapshot {
  return {
    capturesByKey,
    namedCaptures,
    positionalCaptures,
  }
}

function isSameCharacter(
  left: { characterName: string; serverName: string },
  right: { characterName: string; serverName: string },
) {
  return (
    left.characterName.trim().toLocaleLowerCase() ===
      right.characterName.trim().toLocaleLowerCase() &&
    left.serverName.trim().toLocaleLowerCase() ===
      right.serverName.trim().toLocaleLowerCase()
  )
}

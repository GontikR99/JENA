// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
  TriggerStopRequestedMessage,
} from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import { AlertEventCoordinatorProvider } from '../alerts/AlertEventCoordinator'
import {
  type TriggerMatchEvent,
  useOnTimerAction,
  useOnTimerEarlyEnder,
  useOnTriggerMatch,
  useOnTriggerStop,
} from '../alerts/useTriggerAlerts'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  headlessMode: false,
  includeCharacterNameForTriggerMatches: 'never',
  lastStartedAtMs: null as number | null,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  localCharacters: [] as Array<{
    active: boolean
    characterName: string
    lastLogWriteMs: number
    serverName: string
    zone: string
  }>,
  subscribedTriggerIds: new Set<string>(),
  triggers: [] as JenaResolvedTrigger[],
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (destination: string, callback: (message: { payload: unknown }) => void) => {
    hookState.listeners.set(destination, callback)
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
      includeCharacterNameForTriggerMatches:
        hookState.includeCharacterNameForTriggerMatches,
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
      const enabled = hookState.triggers.some((resolvedTrigger) => {
        return (
          resolvedTrigger.trigger.id === triggerId &&
          resolvedTrigger.enabledFor.some((enabledCharacter) =>
            isSameCharacter(enabledCharacter, character),
          )
        )
      })

      return hookState.triggers.some(
        (resolvedTrigger) => resolvedTrigger.trigger.id === triggerId,
      )
        ? {
            broadcastMode: 'private',
            enabled,
            source: 'user',
          }
        : null
    },
    isTriggerEnabledForCharacter: (
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      return hookState.triggers.some((resolvedTrigger) => {
        return (
          resolvedTrigger.trigger.id === triggerId &&
          resolvedTrigger.enabledFor.some((enabledCharacter) =>
            isSameCharacter(enabledCharacter, character),
          )
        )
      })
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
    getTriggerAlertRegistrations: (
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      if (
        !hookState.subscribedTriggerIds.has(triggerId) ||
        !isSameCharacter(character, {
          characterName: 'Mesozoic',
          serverName: 'Bristlebane',
        })
      ) {
        return []
      }

      return [
        {
          broadcastMode: 'private',
          enabled: true,
          source: 'subscription',
          subscriptionId: 'test-subscription',
        },
      ]
    },
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
    isTriggerEnabledForCharacter: (
      triggerId: string,
      character: { characterName: string; serverName: string },
    ) => {
      return (
        hookState.subscribedTriggerIds.has(triggerId) &&
        isSameCharacter(character, {
          characterName: 'Mesozoic',
          serverName: 'Bristlebane',
        })
      )
    },
  }),
}))

const testTrigger = withCanonicalTriggerId({
  ...createEmptyTrigger(),
  match: {
    isRegex: true,
    text: '^test$',
  },
  name: 'Test Trigger',
})

const resolvedTrigger: JenaResolvedTrigger = {
  broadcastMode: 'private',
  enabledFor: [
    {
      characterName: 'Mesozoic',
      serverName: 'Bristlebane',
    },
  ],
  publish: false,
  trigger: testTrigger,
}

describe('useTriggerAlerts', () => {
  beforeEach(() => {
    hookState.areTriggersRunning = true
    hookState.headlessMode = false
    hookState.includeCharacterNameForTriggerMatches = 'never'
    hookState.lastStartedAtMs = null
    hookState.listeners.clear()
    hookState.localCharacters = []
    hookState.subscribedTriggerIds = new Set()
    hookState.triggers = [resolvedTrigger]
    vi.clearAllMocks()
  })

  it('passes through normal trigger matches when triggers are running and enabled for the character', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      characterName: 'mesozoic',
      serverName: 'BRISTLEBANE',
    })

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      alert,
      eventId: expect.any(String),
      origin: 'local',
      registrations: [
        {
          broadcastMode: 'private',
          enabled: true,
          source: 'user',
        },
      ],
      resolvedTrigger,
      trigger: testTrigger,
    }))
  })

  it('drops normal trigger matches when triggers are stopped', () => {
    const callback = vi.fn()
    hookState.areTriggersRunning = false

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', createTriggerAlert())

    expect(callback).not.toHaveBeenCalled()
  })

  it('passes through normal trigger matches in headless mode when the overlay is hidden', () => {
    const callback = vi.fn()
    hookState.areTriggersRunning = false
    hookState.headlessMode = true

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', createTriggerAlert())

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      alert: createTriggerAlert(),
      eventId: expect.any(String),
      origin: 'local',
      registrations: [
        {
          broadcastMode: 'private',
          enabled: true,
          source: 'user',
        },
      ],
      resolvedTrigger,
      trigger: testTrigger,
    }))
  })

  it('drops normal trigger matches when the trigger is unknown locally', () => {
    const callback = vi.fn()
    hookState.triggers = []

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', createTriggerAlert())

    expect(callback).not.toHaveBeenCalled()
  })

  it('passes through subscribed trigger matches when the trigger is subscribed and enabled for the character', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      characterName: 'mesozoic',
      serverName: 'BRISTLEBANE',
    })
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(testTrigger.id)

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      alert,
      eventId: expect.any(String),
      origin: 'local',
      registrations: [
        {
          broadcastMode: 'private',
          enabled: true,
          source: 'subscription',
          subscriptionId: 'test-subscription',
        },
      ],
      trigger: testTrigger,
    }))
  })

  it('applies character name decoration to trigger match hook callbacks by default', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      clipboardText: 'Clipboard alert',
      displayText: 'Display alert',
      speechText: 'Speech alert',
      timerName: 'Timer alert',
    })
    hookState.includeCharacterNameForTriggerMatches = 'always'

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.trigger-matched', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0]?.[0] as TriggerMatchEvent
    expect(event.origin).toBe('local')
    expect(event.alert.clipboardText).toBe('Clipboard alert')
    expect(event.alert.displayText).toBe('[Mesozoic] Display alert')
    expect(event.alert.speechText).toBe('[Mesozoic] Speech alert')
    expect(event.alert.timerName).toBe('Timer alert')
  })

  it('does not apply character name decoration to clipboard text', () => {
    const callback = vi.fn()
    hookState.includeCharacterNameForTriggerMatches = 'always'

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit(
      'alert.trigger-matched',
      createTriggerAlert({
        clipboardText: 'Clipboard alert',
      }),
    )

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0]?.[0] as TriggerMatchEvent
    expect(event.alert.clipboardText).toBe('Clipboard alert')
  })

  it('can opt out of trigger match hook decoration', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      displayText: 'Display alert',
      speechText: 'Speech alert',
      timerName: 'Timer alert',
    })
    hookState.includeCharacterNameForTriggerMatches = 'always'

    renderHook(() => useOnTriggerMatch(callback, { decorate: false }), { wrapper })
    emit('alert.trigger-matched', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0]?.[0] as TriggerMatchEvent
    expect(event.alert.displayText).toBe('Display alert')
    expect(event.alert.speechText).toBe('Speech alert')
    expect(event.alert.timerName).toBe('Timer alert')
  })

  it('applies local character name decoration to broadcast trigger match callbacks', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      displayText: 'Display alert',
      speechText: 'Speech alert',
      timerName: 'Timer alert',
    })
    hookState.includeCharacterNameForTriggerMatches = 'always'

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert,
      eventId: 'remote-event',
      kind: 'triggerMatched',
    })

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0]?.[0] as TriggerMatchEvent
    expect(event.origin).toBe('broadcast')
    expect(event.alert.displayText).toBe('[Mesozoic] Display alert')
    expect(event.alert.speechText).toBe('[Mesozoic] Speech alert')
    expect(event.alert.timerName).toBe('Timer alert')
  })

  it('does not decorate broadcast callback fields whose raw templates contain character substitution', () => {
    const callback = vi.fn()
    const trigger = withCanonicalTriggerId({
      ...testTrigger,
      actions: {
        ...testTrigger.actions,
        display: {
          enabled: true,
          text: '{C} Display alert',
        },
        speech: {
          enabled: true,
          interrupt: false,
          text: '{C} Speech alert',
        },
      },
      timer: {
        durationMs: 10_000,
        earlyEnders: [],
        endedAction: null,
        name: '{C} Timer alert',
        startBehavior: 'restart',
        type: 'countdown',
        warningAction: null,
        warningSeconds: 0,
      },
    })
    hookState.includeCharacterNameForTriggerMatches = 'if-not-present'

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert: createTriggerAlert({
        displayText: 'Mesozoic Display alert',
        speechText: 'Mesozoic Speech alert',
        timerName: 'Mesozoic Timer alert',
        trigger,
      }),
      eventId: 'remote-event',
      kind: 'triggerMatched',
    })

    expect(callback).toHaveBeenCalledTimes(1)
    const event = callback.mock.calls[0]?.[0] as TriggerMatchEvent
    expect(event.alert.displayText).toBe('Mesozoic Display alert')
    expect(event.alert.speechText).toBe('Mesozoic Speech alert')
    expect(event.alert.timerName).toBe('Mesozoic Timer alert')
  })

  it('accepts subscription broadcasts when an enabled local character is active', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      characterName: 'Jephine',
      serverName: 'Bristlebane',
    })
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(testTrigger.id)
    hookState.localCharacters = [
      {
        active: true,
        characterName: 'Mesozoic',
        lastLogWriteMs: 1,
        serverName: 'Bristlebane',
        zone: 'Guild Lobby',
      },
    ]

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert,
      eventId: 'subscription-broadcast',
      kind: 'triggerMatched',
      subscriptionId: 'test-subscription',
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      alert,
      eventId: 'subscription-broadcast',
      origin: 'broadcast',
      trigger: testTrigger,
    }))
  })

  it('accepts subscription broadcasts for inactive enabled characters shortly after triggers started', () => {
    const callback = vi.fn()
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(testTrigger.id)
    hookState.lastStartedAtMs = Date.now() - 1_000
    hookState.localCharacters = [
      {
        active: false,
        characterName: 'Mesozoic',
        lastLogWriteMs: 1,
        serverName: 'Bristlebane',
        zone: 'Guild Lobby',
      },
    ]

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert: createTriggerAlert({
        characterName: 'Jephine',
        serverName: 'Bristlebane',
      }),
      eventId: 'recent-start-broadcast',
      kind: 'triggerMatched',
      subscriptionId: 'test-subscription',
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('drops subscription broadcasts when no enabled local character is active or recently started', () => {
    const callback = vi.fn()
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(testTrigger.id)
    hookState.localCharacters = [
      {
        active: false,
        characterName: 'Mesozoic',
        lastLogWriteMs: 1,
        serverName: 'Bristlebane',
        zone: 'Guild Lobby',
      },
    ]

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert: createTriggerAlert({
        characterName: 'Jephine',
        serverName: 'Bristlebane',
      }),
      eventId: 'inactive-subscription-broadcast',
      kind: 'triggerMatched',
      subscriptionId: 'test-subscription',
    })

    expect(callback).not.toHaveBeenCalled()
  })

  it('does not mark rejected subscription broadcasts as seen', () => {
    const callback = vi.fn()
    hookState.triggers = []
    hookState.subscribedTriggerIds.add(testTrigger.id)

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit('alert.broadcast', {
      alert: createTriggerAlert({
        characterName: 'Jephine',
        serverName: 'Bristlebane',
      }),
      eventId: 'replayed-after-reject',
      kind: 'triggerMatched',
      subscriptionId: 'test-subscription',
    })
    emit('alert.broadcast', {
      alert: createTriggerAlert({
        characterName: 'Jephine',
        serverName: 'Bristlebane',
      }),
      eventId: 'replayed-after-reject',
      kind: 'triggerMatched',
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('drops subscription timer early enders for unknown subscription triggers', () => {
    const callback = vi.fn()
    hookState.triggers = []

    renderHook(() => useOnTimerEarlyEnder(callback), { wrapper })
    emit('alert.broadcast', {
      alert: createEarlyEnderAlert(),
      eventId: 'unknown-subscription-early-ender',
      kind: 'timerEarlyEnded',
      subscriptionId: 'test-subscription',
    })

    expect(callback).not.toHaveBeenCalled()
  })

  it('drops normal trigger matches when the trigger is not enabled for the character', () => {
    const callback = vi.fn()

    renderHook(() => useOnTriggerMatch(callback), { wrapper })
    emit(
      'alert.trigger-matched',
      createTriggerAlert({
        characterName: 'Suuloti',
        serverName: 'Bristlebane',
      }),
    )

    expect(callback).not.toHaveBeenCalled()
  })

  it('always passes through timer early enders', () => {
    const callback = vi.fn()
    const alert = createEarlyEnderAlert()
    hookState.areTriggersRunning = false
    hookState.triggers = []

    renderHook(() => useOnTimerEarlyEnder(callback), { wrapper })
    emit('alert.timer-early-ended', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      alert,
      eventId: expect.any(String),
      origin: 'local',
      registrations: [],
      trigger: testTrigger,
    }))
  })

  it('applies character name decoration to timer action callbacks by default', () => {
    const callback = vi.fn()
    hookState.includeCharacterNameForTriggerMatches = 'always'

    renderHook(() => useOnTimerAction(callback))
    emit('alert.timer-action', createTimerActionAlert())

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      alert: expect.objectContaining({
        displayText: '[Mesozoic] Timer warning display',
        speechText: '[Mesozoic] Timer warning speech',
      }),
    })
  })

  it('always passes through stop requests', () => {
    const callback = vi.fn()
    const alert = createStopAlert()
    hookState.areTriggersRunning = false
    hookState.triggers = []

    renderHook(() => useOnTriggerStop(callback))
    emit('alert.stop-requested', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      alert,
    })
  })
})

function wrapper({ children }: { children: ReactNode }) {
  return <AlertEventCoordinatorProvider>{children}</AlertEventCoordinatorProvider>
}

function emit(destination: string, payload: unknown) {
  const listener = hookState.listeners.get(destination)

  if (!listener) {
    throw new Error(`No listener registered for ${destination}.`)
  }

  listener({ payload })
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

function createTriggerAlert(
  overrides: Partial<TriggerAlertMatchedMessage> = {},
): TriggerAlertMatchedMessage {
  return {
    characterName: 'Mesozoic',
    serverName: 'Bristlebane',
    text: 'test',
    timestamp: '2026-06-16T00:00:00.000Z',
    trigger: testTrigger,
    ...overrides,
  }
}

function createEarlyEnderAlert(
  overrides: Partial<TriggerEarlyEnderMatchedMessage> = {},
): TriggerEarlyEnderMatchedMessage {
  return {
    characterName: 'Mesozoic',
    serverName: 'Bristlebane',
    text: 'end timer',
    timestamp: '2026-06-16T00:00:00.000Z',
    trigger: testTrigger,
    ...overrides,
  }
}

function createTimerActionAlert() {
  const trigger = withCanonicalTriggerId({
    ...testTrigger,
    timer: {
      durationMs: 10_000,
      earlyEnders: [],
      endedAction: null,
      name: 'Timer',
      startBehavior: 'restart',
      type: 'countdown',
      warningAction: {
        display: {
          enabled: true,
          text: 'Timer warning display',
        },
        speech: {
          enabled: true,
          interrupt: false,
          text: 'Timer warning speech',
        },
      },
      warningSeconds: 2,
    },
  })

  return {
    characterName: 'Mesozoic',
    displayText: 'Timer warning display',
    kind: 'warning',
    serverName: 'Bristlebane',
    speechInterrupt: false,
    speechText: 'Timer warning speech',
    timerName: 'Timer',
    timestamp: '2026-06-16T00:00:00.000Z',
    trigger,
  }
}

function createStopAlert(
  overrides: Partial<TriggerStopRequestedMessage> = {},
): TriggerStopRequestedMessage {
  return {
    characterName: 'Mesozoic',
    command: '{JENA:STOP}',
    serverName: 'Bristlebane',
    text: '{jena:stop}',
    timestamp: '2026-06-16T00:00:00.000Z',
    ...overrides,
  }
}

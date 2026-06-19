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
  useOnTimerEarlyEnder,
  useOnTriggerMatch,
  useOnTriggerStop,
} from '../alerts/useTriggerAlerts'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
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
    getTimerEarlyEnderBroadcastRegistrations: () => [],
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
    hookState.listeners.clear()
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

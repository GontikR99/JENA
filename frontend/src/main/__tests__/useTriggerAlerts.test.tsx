// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TriggerAlertMatchedMessage,
  TriggerEarlyEnderMatchedMessage,
} from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import {
  useOnTimerEarlyEnder,
  useOnTriggerMatch,
} from '../triggers/useTriggerAlerts'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  triggers: [] as JenaResolvedTrigger[],
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: (destination: string, callback: (message: { payload: unknown }) => void) => {
    hookState.listeners.set(destination, callback)
  },
}))

vi.mock('../TriggerRuntime', () => ({
  useTriggerRuntime: () => ({
    areTriggersRunning: hookState.areTriggersRunning,
  }),
}))

vi.mock('../triggers/UserTriggerManager', () => ({
  useTriggerManager: () => ({
    triggers: hookState.triggers,
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
  broadcast: false,
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
    hookState.triggers = [resolvedTrigger]
    vi.clearAllMocks()
  })

  it('passes through normal trigger matches when triggers are running and enabled for the character', () => {
    const callback = vi.fn()
    const alert = createTriggerAlert({
      characterName: 'mesozoic',
      serverName: 'BRISTLEBANE',
    })

    renderHook(() => useOnTriggerMatch(callback))
    emit('alert.trigger-matched', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      alert,
      resolvedTrigger,
      trigger: testTrigger,
    })
  })

  it('drops normal trigger matches when triggers are stopped', () => {
    const callback = vi.fn()
    hookState.areTriggersRunning = false

    renderHook(() => useOnTriggerMatch(callback))
    emit('alert.trigger-matched', createTriggerAlert())

    expect(callback).not.toHaveBeenCalled()
  })

  it('drops normal trigger matches when the trigger is unknown locally', () => {
    const callback = vi.fn()
    hookState.triggers = []

    renderHook(() => useOnTriggerMatch(callback))
    emit('alert.trigger-matched', createTriggerAlert())

    expect(callback).not.toHaveBeenCalled()
  })

  it('drops normal trigger matches when the trigger is not enabled for the character', () => {
    const callback = vi.fn()

    renderHook(() => useOnTriggerMatch(callback))
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

    renderHook(() => useOnTimerEarlyEnder(callback))
    emit('alert.timer-early-ended', alert)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      alert,
      trigger: testTrigger,
    })
  })
})

function emit(destination: string, payload: unknown) {
  const listener = hookState.listeners.get(destination)

  if (!listener) {
    throw new Error(`No listener registered for ${destination}.`)
  }

  listener({ payload })
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

// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  TriggerTimerActionMessage,
  TriggerTimerActionPayload,
} from '../../shared/messages'
import type { JenaTrigger } from '../../shared/triggers'
import type {
  TimerEarlyEnderEvent,
  TriggerTimerActionEvent,
  TriggerMatchEvent,
  TriggerStopEvent,
} from '../../triggers/alerts/useTriggerAlerts'
import { TriggerTimerRuntimeProvider } from '../../runtime/TriggerTimerRuntime'
import { Pip } from '../pip'

const hookState = vi.hoisted(() => ({
  earlyEnderListeners: [] as Array<(event: TimerEarlyEnderEvent) => void>,
  stopListeners: [] as Array<(event: TriggerStopEvent) => void>,
  timerActionListeners: [] as Array<(event: TriggerTimerActionEvent) => void>,
  triggerMatchListeners: [] as Array<(event: TriggerMatchEvent) => void>,
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useSender: () => (_destination: string, payload: TriggerTimerActionMessage) => {
    hookState.timerActionListeners.forEach((listener) => {
      listener({
        alert: payload,
      })
    })
  },
}))

vi.mock('../../triggers/alerts/useTriggerAlerts', () => ({
  useOnTimerAction: (callback: (event: TriggerTimerActionEvent) => void) => {
    hookState.timerActionListeners = [callback]
  },
  useOnTimerEarlyEnder: (callback: (event: TimerEarlyEnderEvent) => void) => {
    hookState.earlyEnderListeners.push(callback)
  },
  useOnTriggerStop: (callback: (event: TriggerStopEvent) => void) => {
    hookState.stopListeners.push(callback)
  },
  useOnTriggerMatch: (callback: (event: TriggerMatchEvent) => void) => {
    hookState.triggerMatchListeners.push(callback)
  },
}))

vi.mock('../../settings/settingsContext', () => ({
  useSettings: () => ({
    machineSettings: {
      headlessMode: false,
      pip: {
        alerts: {
          backgroundColor: '#000000',
          fontSizePx: 20,
          foregroundColor: '#ffff00',
        },
        timers: {
          backgroundColor: '#570f00',
          fillColor: '#ff0000',
          fontSizePx: 16,
          foregroundColor: '#ffff00',
        },
      },
    },
  }),
}))

vi.mock('../../runtime/TriggerRuntime', () => ({
  useTriggerRuntime: () => ({
    areTriggersRunning: true,
  }),
}))

describe('Pip', () => {
  let animationFrames: Map<number, FrameRequestCallback>
  let currentTimeMs: number
  let nextFrameId: number
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    animationFrames = new Map()
    currentTimeMs = 0
    nextFrameId = 1
    hookState.earlyEnderListeners = []
    hookState.stopListeners = []
    hookState.timerActionListeners = []
    hookState.triggerMatchListeners = []
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0)

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const id = nextFrameId++
        animationFrames.set(id, callback)
        return id
      }),
    )
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((id: number) => {
        animationFrames.delete(id)
      }),
    )
  })

  afterEach(() => {
    nowSpy.mockRestore()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders trigger display text on opaque bottom rows', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        displayText: 'Cure curse now',
      })
    })

    expect(screen.getByText('Cure curse now')).toHaveClass('pip-text-line')
  })

  it('restarts matching timers without adding a new row', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: 'AE Timer',
      })
    })

    expect(screen.getAllByText('AE Timer')).toHaveLength(1)

    nowSpy.mockReturnValue(500)
    act(() => {
      emitTriggerMatch({
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: 'AE Timer',
      })
    })

    expect(screen.getAllByText('AE Timer')).toHaveLength(1)
  })

  it('removes countdown timers when they complete', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({
          durationMs: 1000,
          startBehavior: 'restart',
        }),
        timerName: 'Short Timer',
      })
    })

    expect(screen.getByText('Short Timer')).toBeInTheDocument()

    act(() => {
      advanceTo(1000)
    })

    expect(screen.queryByText('Short Timer')).not.toBeInTheDocument()
  })

  it('shows timer warning and ended display text', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({
          durationMs: 10_000,
          endedAction: createTimerAction({
            displayText: 'Timer ended',
          }),
          startBehavior: 'restart',
          warningAction: createTimerAction({
            displayText: 'Timer warning',
          }),
          warningSeconds: 2,
        }),
        timerEndedAction: {
          displayText: 'Timer ended',
        },
        timerName: 'Action Timer',
        timerWarningAction: {
          displayText: 'Timer warning',
        },
      })
    })

    expect(screen.queryByText('Timer warning')).not.toBeInTheDocument()

    act(() => {
      advanceTo(8000)
    })

    expect(screen.getByText('Timer warning')).toBeInTheDocument()

    act(() => {
      advanceTo(10_000)
    })

    expect(screen.getByText('Timer ended')).toBeInTheDocument()
    expect(screen.queryByText('Action Timer')).not.toBeInTheDocument()
  })

  it('removes timers when a matching early ender arrives', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: 'Endable Timer',
      })
    })

    expect(screen.getByText('Endable Timer')).toBeInTheDocument()

    act(() => {
      emitTimerEarlyEnder({
        timerName: 'Endable Timer',
      })
    })

    expect(screen.queryByText('Endable Timer')).not.toBeInTheDocument()
  })

  it('removes timers when their cancel button is clicked', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: 'Cancelable Timer',
      })
    })

    expect(screen.getByText('Cancelable Timer')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel timer Cancelable Timer' }),
    )

    expect(screen.queryByText('Cancelable Timer')).not.toBeInTheDocument()
  })

  it('removes timers when the early ender has a different computed timer name', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: '[Mesozoic] Endable Timer',
      })
    })

    expect(screen.getByText('[Mesozoic] Endable Timer')).toBeInTheDocument()

    act(() => {
      emitTimerEarlyEnder({
        timerName: 'Endable Timer',
      })
    })

    expect(screen.queryByText('[Mesozoic] Endable Timer')).not.toBeInTheDocument()
  })

  it('clears timers and text when a stop request arrives', () => {
    renderPip()

    act(() => {
      emitTriggerMatch({
        displayText: 'Stop visible text',
        timer: createTimer({ startBehavior: 'restart' }),
        timerName: 'Stop Timer',
      })
    })

    expect(screen.getByText('Stop visible text')).toBeInTheDocument()
    expect(screen.getByText('Stop Timer')).toBeInTheDocument()

    act(() => {
      emitTriggerStop()
    })

    expect(screen.queryByText('Stop visible text')).not.toBeInTheDocument()
    expect(screen.queryByText('Stop Timer')).not.toBeInTheDocument()
  })

  function renderPip() {
    render(
      <TriggerTimerRuntimeProvider>
        <Pip />
      </TriggerTimerRuntimeProvider>,
    )
  }

  function advanceTo(nowMs: number) {
    const deltaMs = nowMs - currentTimeMs
    if (deltaMs < 0) {
      throw new Error('Cannot move test time backwards.')
    }

    vi.advanceTimersByTime(deltaMs)
    currentTimeMs = nowMs
    runAnimationFrames(nowMs)
  }

  function runAnimationFrames(nowMs: number) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    callbacks.forEach((callback) => callback(nowMs))
  }
})

function emitTriggerMatch({
  displayText,
  timer,
  timerEndedAction,
  timerName,
  timerWarningAction,
}: {
  displayText?: string
  timer?: JenaTrigger['timer']
  timerEndedAction?: TriggerTimerActionPayload
  timerName?: string
  timerWarningAction?: TriggerTimerActionPayload
}) {
  const trigger = createTrigger(timer ?? null)

  hookState.triggerMatchListeners.forEach((listener) => {
    listener({
      alert: {
        characterName: 'Mesozoic',
        displayText,
        serverName: 'Bristlebane',
        text: 'log line',
        timerEndedAction,
        timerName,
        timerWarningAction,
        timestamp: '2026-06-17T12:00:00Z',
        trigger,
      },
      eventId: 'test-trigger-match',
      origin: 'local',
      registrations: [],
      resolvedTrigger: {
        broadcastMode: 'private',
        enabledFor: [
          {
            characterName: 'Mesozoic',
            serverName: 'Bristlebane',
          },
        ],
        publish: false,
        trigger,
      },
      trigger,
    })
  })
}

function createTimerAction({
  displayText = '',
  speechInterrupt = false,
  speechText = '',
}: TriggerTimerActionPayload = {}): NonNullable<
  NonNullable<JenaTrigger['timer']>['warningAction']
> {
  return {
    display: {
      enabled: displayText.length > 0,
      text: displayText,
    },
    speech: {
      enabled: speechText.length > 0,
      interrupt: speechInterrupt,
      text: speechText,
    },
  }
}

function emitTimerEarlyEnder({ timerName }: { timerName?: string }) {
  const trigger = createTrigger(createTimer({ startBehavior: 'restart' }))

  hookState.earlyEnderListeners.forEach((listener) => {
    listener({
      alert: {
        characterName: 'Mesozoic',
        serverName: 'Bristlebane',
        text: 'end timer',
        timerName,
        timestamp: '2026-06-17T12:00:01Z',
        trigger,
      },
      eventId: 'test-early-ender',
      origin: 'local',
      registrations: [],
      trigger,
    })
  })
}

function emitTriggerStop() {
  hookState.stopListeners.forEach((listener) => {
    listener({
      alert: {
        characterName: 'Mesozoic',
        command: '{JENA:STOP}',
        serverName: 'Bristlebane',
        text: '{jena:stop}',
        timestamp: '2026-06-17T12:00:02Z',
      },
    })
  })
}

function createTrigger(timer: JenaTrigger['timer']): JenaTrigger {
  return {
    actions: {
      clipboard: {
        enabled: false,
        text: '',
      },
      display: {
        enabled: true,
        text: '',
      },
      speech: {
        enabled: false,
        interrupt: false,
        text: '',
      },
    },
    category: 'Default',
    comments: '',
    groupPath: [],
    id: 'trigger-1',
    match: {
      isRegex: true,
      text: '^test$',
    },
    name: 'Test Trigger',
    timer,
  }
}

function createTimer(
  timer: Partial<NonNullable<JenaTrigger['timer']>>,
): NonNullable<JenaTrigger['timer']> {
  return {
    durationMs: 10_000,
    earlyEnders: [],
    endedAction: null,
    name: 'Timer',
    startBehavior: 'startNew',
    type: 'countdown',
    warningAction: null,
    warningSeconds: 0,
    ...timer,
  }
}

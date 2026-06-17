// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JenaTrigger } from '../../shared/triggers'
import type {
  TimerEarlyEnderEvent,
  TriggerMatchEvent,
  TriggerStopEvent,
} from '../../triggers/alerts/useTriggerAlerts'
import { Pip } from '../pip'

const hookState = vi.hoisted(() => ({
  earlyEnderListeners: [] as Array<(event: TimerEarlyEnderEvent) => void>,
  stopListeners: [] as Array<(event: TriggerStopEvent) => void>,
  triggerMatchListeners: [] as Array<(event: TriggerMatchEvent) => void>,
}))

vi.mock('../../triggers/alerts/useTriggerAlerts', () => ({
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

describe('Pip', () => {
  let animationFrames: Map<number, FrameRequestCallback>
  let nextFrameId: number
  let nowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    animationFrames = new Map()
    nextFrameId = 1
    hookState.earlyEnderListeners = []
    hookState.stopListeners = []
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
    vi.unstubAllGlobals()
  })

  it('renders trigger display text on opaque bottom rows', () => {
    render(<Pip />)

    act(() => {
      emitTriggerMatch({
        displayText: 'Cure curse now',
      })
    })

    expect(screen.getByText('Cure curse now')).toHaveClass('pip-text-line')
  })

  it('restarts matching timers without adding a new row', () => {
    render(<Pip />)

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
    render(<Pip />)

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
      runAnimationFrames(1000)
    })

    expect(screen.queryByText('Short Timer')).not.toBeInTheDocument()
  })

  it('removes timers when a matching early ender arrives', () => {
    render(<Pip />)

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

  it('clears timers and text when a stop request arrives', () => {
    render(<Pip />)

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

  function runAnimationFrames(nowMs: number) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    callbacks.forEach((callback) => callback(nowMs))
  }
})

function emitTriggerMatch({
  displayText,
  timer,
  timerName,
}: {
  displayText?: string
  timer?: JenaTrigger['timer']
  timerName?: string
}) {
  const trigger = createTrigger(timer ?? null)

  hookState.triggerMatchListeners.forEach((listener) => {
    listener({
      alert: {
        characterName: 'Mesozoic',
        displayText,
        serverName: 'Bristlebane',
        text: 'log line',
        timerName,
        timestamp: '2026-06-17T12:00:00Z',
        trigger,
      },
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

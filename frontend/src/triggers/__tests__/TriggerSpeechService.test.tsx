// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
  type JenaTrigger,
} from '../../shared/triggers'
import {
  TriggerSpeechService,
} from '../alerts/TriggerSpeechService'
import type {
  TriggerTimerActionEvent,
  TriggerMatchEvent,
  TriggerStopEvent,
} from '../alerts/useTriggerAlerts'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  useBroadcasterSpeechProfile: true,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  stopCallback: null as ((event: TriggerStopEvent) => void) | null,
  timerActionCallback: null as ((event: TriggerTimerActionEvent) => void) | null,
  triggerMatchCallback: null as ((event: TriggerMatchEvent) => void) | null,
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

vi.mock('../../settings/settingsContext', () => ({
  useSettings: () => ({
    machineSettings: {
      tts: {
        pitch: 1,
        rate: 1,
        useBroadcasterSpeechProfile: hookState.useBroadcasterSpeechProfile,
        voiceURI: null,
        volume: 1,
      },
    },
  }),
}))

vi.mock('../../settings/speechVoiceContext', () => ({
  useSpeechVoices: () => ({
    voiceByURI: new Map([
      [
        'voice:broadcaster',
        {
          default: false,
          lang: 'en-US',
          localService: true,
          name: 'Broadcaster Voice',
          voiceURI: 'voice:broadcaster',
        },
      ],
    ]),
  }),
}))

vi.mock('../alerts/useTriggerAlerts', () => ({
  useOnTimerAction: (callback: (event: TriggerTimerActionEvent) => void) => {
    hookState.timerActionCallback = callback
  },
  useOnTriggerMatch: (callback: (event: TriggerMatchEvent) => void) => {
    hookState.triggerMatchCallback = callback
  },
  useOnTriggerStop: (callback: (event: TriggerStopEvent) => void) => {
    hookState.stopCallback = callback
  },
}))

class FakeSpeechSynthesisUtterance {
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  pitch = 1
  rate = 1
  text: string
  voice: SpeechSynthesisVoice | null = null
  volume = 1

  constructor(text: string) {
    this.text = text
  }
}

const spokenUtterances: FakeSpeechSynthesisUtterance[] = []
const speechSynthesis = {
  cancel: vi.fn(),
  speak: vi.fn((utterance: SpeechSynthesisUtterance) => {
    spokenUtterances.push(utterance as unknown as FakeSpeechSynthesisUtterance)
  }),
}

describe('TriggerSpeechService', () => {
  beforeEach(() => {
    hookState.areTriggersRunning = true
    hookState.useBroadcasterSpeechProfile = true
    hookState.listeners.clear()
    hookState.stopCallback = null
    hookState.timerActionCallback = null
    hookState.triggerMatchCallback = null
    spokenUtterances.length = 0
    speechSynthesis.cancel.mockClear()
    speechSynthesis.speak.mockClear()

    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    })
    Object.defineProperty(globalThis, 'speechSynthesis', {
      configurable: true,
      value: speechSynthesis,
    })
  })

  it('speaks queued trigger speech one utterance at a time', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('first')
    fireTriggerMatch('second')

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual(['first'])

    spokenUtterances[0]?.onend?.()

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual([
      'first',
      'second',
    ])
  })

  it('replaces current and queued speech for interrupting triggers', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('first')
    fireTriggerMatch('second')
    fireTriggerMatch('urgent', { interrupt: true })

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1)
    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual([
      'first',
      'urgent',
    ])

    spokenUtterances[0]?.onend?.()

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual([
      'first',
      'urgent',
    ])
  })

  it('cancels current speech and clears queued speech when triggers stop running', () => {
    const { rerender } = render(<TriggerSpeechService />)

    fireTriggerMatch('first')
    fireTriggerMatch('second')

    hookState.areTriggersRunning = false
    rerender(<TriggerSpeechService />)

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1)

    spokenUtterances[0]?.onend?.()

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual(['first'])
  })

  it('cancels current speech and clears queued speech when a stop request arrives', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('first')
    fireTriggerMatch('second')
    fireTriggerStop()

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1)

    spokenUtterances[0]?.onend?.()

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual(['first'])
  })


  it('ignores trigger matches without speech text', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('')

    expect(speechSynthesis.speak).not.toHaveBeenCalled()
  })

  it('speaks timer action speech', () => {
    render(<TriggerSpeechService />)

    fireTimerAction('timer warning')

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual([
      'timer warning',
    ])
  })

  it('uses carried speech profile settings when enabled', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('profile speech', {
      speechProfile: {
        pitch: 1.5,
        rate: 0.8,
        voiceLang: 'en-US',
        voiceName: 'Broadcaster Voice',
        voiceURI: 'voice:broadcaster',
        volume: 0.6,
      },
    })

    expect(spokenUtterances[0]?.pitch).toBe(1.5)
    expect(spokenUtterances[0]?.rate).toBe(0.8)
    expect(spokenUtterances[0]?.volume).toBe(0.6)
    expect(spokenUtterances[0]?.voice?.voiceURI).toBe('voice:broadcaster')
  })

  it('uses local speech settings when broadcaster profiles are disabled', () => {
    hookState.useBroadcasterSpeechProfile = false
    render(<TriggerSpeechService />)

    fireTriggerMatch('local speech', {
      speechProfile: {
        pitch: 1.5,
        rate: 0.8,
        voiceURI: 'voice:broadcaster',
        volume: 0.6,
      },
    })

    expect(spokenUtterances[0]?.pitch).toBe(1)
    expect(spokenUtterances[0]?.rate).toBe(1)
    expect(spokenUtterances[0]?.volume).toBe(1)
    expect(spokenUtterances[0]?.voice).toBeNull()
  })

  it('speaks preview requests even when triggers are stopped', () => {
    hookState.areTriggersRunning = false

    render(<TriggerSpeechService />)
    fireSpeechPreview('preview text')

    expect(spokenUtterances.map((utterance) => utterance.text)).toEqual([
      'preview text',
    ])
  })
})

function fireTriggerMatch(
  speechText: string,
  options: {
    interrupt?: boolean
    speechProfile?: TriggerMatchEvent['alert']['speechProfile']
  } = {},
) {
  if (!hookState.triggerMatchCallback) {
    throw new Error('Trigger match hook was not registered.')
  }

  const trigger = createTrigger({
    interrupt: options.interrupt ?? false,
  })

  hookState.triggerMatchCallback({
      alert: {
        characterName: 'Mesozoic',
        serverName: 'Bristlebane',
        speechProfile: options.speechProfile,
        speechText,
      text: 'log line',
      timestamp: '2026-06-16T00:00:00.000Z',
      trigger,
    },
    eventId: 'test-trigger-match',
    origin: 'local',
    registrations: [],
    resolvedTrigger: createResolvedTrigger(trigger),
    trigger,
  })
}

function fireTimerAction(speechText: string) {
  if (!hookState.timerActionCallback) {
    throw new Error('Timer action hook was not registered.')
  }

  const trigger = createTrigger({
    interrupt: false,
  })

  hookState.timerActionCallback({
    alert: {
      characterName: 'Mesozoic',
      kind: 'warning',
      serverName: 'Bristlebane',
      speechInterrupt: false,
      speechText,
      timerName: 'Timer',
      timestamp: '2026-06-16T00:00:00.000Z',
      trigger,
    },
  })
}

function fireSpeechPreview(text: string) {
  const listener = hookState.listeners.get('speech.preview-requested')

  if (!listener) {
    throw new Error('Speech preview listener was not registered.')
  }

  listener({
    payload: {
      text,
    },
  })
}

function fireTriggerStop() {
  if (!hookState.stopCallback) {
    throw new Error('Trigger stop hook was not registered.')
  }

  hookState.stopCallback({
    alert: {
      characterName: 'Mesozoic',
      command: '{JENA:STOP}',
      serverName: 'Bristlebane',
      text: '{jena:stop}',
      timestamp: '2026-06-16T00:00:01.000Z',
    },
  })
}

function createTrigger({ interrupt }: { interrupt: boolean }) {
  return withCanonicalTriggerId({
    ...createEmptyTrigger(),
    actions: {
      ...createEmptyTrigger().actions,
      speech: {
        enabled: true,
        interrupt,
        text: 'speech',
      },
    },
    match: {
      isRegex: true,
      text: '^test$',
    },
    name: interrupt ? 'Interrupt Trigger' : 'Speech Trigger',
  })
}

function createResolvedTrigger(trigger: JenaTrigger): JenaResolvedTrigger {
  return {
    broadcastMode: 'private',
    enabledFor: [],
    publish: false,
    trigger,
  }
}

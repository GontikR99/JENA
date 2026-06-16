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
} from '../triggers/TriggerSpeechService'
import type { TriggerMatchEvent } from '../triggers/useTriggerAlerts'

const hookState = vi.hoisted(() => ({
  areTriggersRunning: true,
  listeners: new Map<string, (message: { payload: unknown }) => void>(),
  triggerMatchCallback: null as ((event: TriggerMatchEvent) => void) | null,
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

vi.mock('../triggers/useTriggerAlerts', () => ({
  useOnTriggerMatch: (callback: (event: TriggerMatchEvent) => void) => {
    hookState.triggerMatchCallback = callback
  },
}))

class FakeSpeechSynthesisUtterance {
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  text: string

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
    hookState.listeners.clear()
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

  it('ignores trigger matches without speech text', () => {
    render(<TriggerSpeechService />)

    fireTriggerMatch('')

    expect(speechSynthesis.speak).not.toHaveBeenCalled()
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
  options: { interrupt?: boolean } = {},
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
      speechText,
      text: 'log line',
      timestamp: '2026-06-16T00:00:00.000Z',
      trigger,
    },
    resolvedTrigger: createResolvedTrigger(trigger),
    trigger,
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
    broadcast: false,
    enabledFor: [],
    publish: false,
    trigger,
  }
}

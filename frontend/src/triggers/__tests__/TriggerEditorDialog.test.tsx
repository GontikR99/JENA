// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
} from '../../shared/triggers'
import { TriggerEditorDialog } from '../editor/TriggerEditorDialog'

const hookState = vi.hoisted(() => ({
  character: {
    active: true,
    characterName: 'Mesozoic',
    lastLogWriteMs: 1,
    serverName: 'Bristlebane',
    zone: 'Yxtta',
  },
  send: vi.fn(),
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: vi.fn(),
  useRpc: () =>
    vi.fn(async () => ({
      characters: [hookState.character],
    })),
  useSender: () => hookState.send,
}))

describe('TriggerEditorDialog', () => {
  beforeEach(() => {
    hookState.send.mockClear()
  })

  it('sends substituted speech preview text from the test button', async () => {
    const user = userEvent.setup()

    render(
      <TriggerEditorDialog
        setShown={vi.fn()}
        setTrigger={vi.fn()}
        shown
        trigger={withCanonicalTriggerId({
          ...createEmptyTrigger(),
          actions: {
            ...createEmptyTrigger().actions,
            speech: {
              enabled: true,
              interrupt: false,
              text: 'Hello {C} $1',
            },
          },
          match: {
            isRegex: true,
            text: '^{C} says (.+)$',
          },
          name: 'Speech Preview',
        })}
      />,
    )

    await user.click(await screen.findByRole('button', { name: 'Test speech' }))

    expect(hookState.send).toHaveBeenCalledWith('speech.preview-requested', {
      interrupt: true,
      text: 'Hello Mesozoic test',
    })
  })

  it('allows speech preview when viewing a read-only trigger', async () => {
    const user = userEvent.setup()

    render(
      <TriggerEditorDialog
        readOnly
        setShown={vi.fn()}
        setTrigger={vi.fn()}
        shown
        trigger={withCanonicalTriggerId({
          ...createEmptyTrigger(),
          actions: {
            ...createEmptyTrigger().actions,
            speech: {
              enabled: true,
              interrupt: false,
              text: 'Read only {C} $1',
            },
          },
          match: {
            isRegex: true,
            text: '^{C} says (.+)$',
          },
          name: 'Read Only Speech Preview',
        })}
      />,
    )

    const testButton = await screen.findByRole('button', { name: 'Test speech' })
    expect(testButton).toBeEnabled()
    await user.click(testButton)

    expect(hookState.send).toHaveBeenCalledWith('speech.preview-requested', {
      interrupt: true,
      text: 'Read only Mesozoic test',
    })
  })

  it('keeps timer ended text-to-speech radios independent from other tabs', async () => {
    const user = userEvent.setup()

    render(
      <TriggerEditorDialog
        setShown={vi.fn()}
        setTrigger={vi.fn()}
        shown
        trigger={withCanonicalTriggerId({
          ...createEmptyTrigger(),
          name: 'Timer Speech Groups',
          timer: {
            durationMs: 1000,
            earlyEnders: [],
            endedAction: null,
            name: 'Timer',
            startBehavior: 'startNew',
            type: 'countdown',
            warningAction: null,
            warningSeconds: 1,
          },
        })}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Timer Ending' }))
    await user.click(screen.getByRole('tab', { name: 'Timer Ended' }))

    const ttsRadios = screen.getAllByLabelText(
      'Use Text To Speech',
    ) as HTMLInputElement[]
    expect(ttsRadios).toHaveLength(3)
    expect(new Set(ttsRadios.map((radio) => radio.name)).size).toBe(3)
  })

  it('allows saving JavaScript-compatible lookahead regexes', async () => {
    const user = userEvent.setup()
    const setShown = vi.fn()
    const setTrigger = vi.fn()

    render(
      <TriggerEditorDialog
        setShown={setShown}
        setTrigger={setTrigger}
        shown
        trigger={withCanonicalTriggerId({
          ...createEmptyTrigger(),
          match: {
            isRegex: true,
            text: 'Touched tenderly\\.',
          },
          name: 'Lookahead Trigger',
        })}
      />,
    )

    await user.clear(screen.getByLabelText('Search Text'))
    await user.type(
      screen.getByLabelText('Search Text'),
      "^(?:(?! say, '| says, ').)*Touched tenderly\\.",
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(setTrigger).toHaveBeenCalled()
    })
    expect(setShown).toHaveBeenCalledWith(false)
    expect(setTrigger.mock.calls[0]?.[0]).toMatchObject({
      match: {
        isRegex: true,
        text: "^(?:(?! say, '| says, ').)*Touched tenderly\\.",
      },
    })
  })
})

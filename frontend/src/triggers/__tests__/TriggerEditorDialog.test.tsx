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

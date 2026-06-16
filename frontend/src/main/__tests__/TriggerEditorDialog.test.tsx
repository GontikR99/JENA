// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
} from '../../shared/triggers'
import { TriggerEditorDialog } from '../triggers/TriggerEditorDialog'

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
})

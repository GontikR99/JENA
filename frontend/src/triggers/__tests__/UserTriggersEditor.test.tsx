// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import { UserTriggersEditor } from '../views/UserTriggersEditor'

const testTrigger = withCanonicalTriggerId({
  ...createEmptyTrigger(),
  groupPath: ['Raid'],
  match: {
    text: '^test$',
    isRegex: true,
  },
  name: 'Test Trigger',
})

const resolvedTriggers: JenaResolvedTrigger[] = [
  {
    broadcast: false,
    enabledFor: [
      {
        characterName: 'Mesozoic',
        serverName: 'Bristlebane',
      },
    ],
    publish: false,
    trigger: testTrigger,
  },
]

const selectedCharacter: CharacterPresence = {
  active: true,
  characterName: 'Mesozoic',
  serverName: 'Bristlebane',
  zone: 'Yxtta',
}

vi.mock('../model/UserTriggerManager', () => ({
  useTriggerManager: () => ({
    deleteTrigger: vi.fn(),
    deleteTriggers: vi.fn(),
    setTriggerFlags: vi.fn(),
    toggleTriggers: vi.fn(),
    triggers: resolvedTriggers,
    upsertTrigger: vi.fn(),
    upsertTriggers: vi.fn(),
  }),
}))

vi.mock('../../auth/AuthContext', () => ({
  useAuthToken: () => 'test-token',
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: vi.fn(),
  useRpc: () =>
    vi.fn(async () => ({
      characters: [],
    })),
  useSender: () => vi.fn(),
}))

describe('UserTriggersEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides enable controls when no character is selected', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={null} />)

    await user.click(await screen.findByRole('button', { name: 'Expand Raid' }))
    expect(await screen.findByText('Test Trigger')).toBeInTheDocument()
    expect(screen.queryByLabelText('Enable Test Trigger')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Enable triggers in Raid')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Publish')).toHaveLength(2)
    expect(screen.getAllByLabelText('Broadcast')).toHaveLength(2)
  })

  it('shows enable controls when a character is selected', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    await user.click(await screen.findByRole('button', { name: 'Expand Raid' }))
    expect(await screen.findByLabelText('Enable Test Trigger')).toBeInTheDocument()
    expect(screen.getByLabelText('Enable triggers in Raid')).toBeInTheDocument()
  })

  it('opens the trigger editor when a trigger is double-clicked', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    await user.click(await screen.findByRole('button', { name: 'Expand Raid' }))
    await user.dblClick(await screen.findByText('Test Trigger'))

    expect(await screen.findByText('Trigger Editor')).toBeInTheDocument()
  })
})

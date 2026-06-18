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
    broadcastMode: 'private',
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
    collapsedGroupIds: new Set<string>(),
    deleteTrigger: vi.fn(),
    deleteTriggers: vi.fn(),
    reconcileKnownGroupIds: vi.fn(),
    setTriggerFlags: vi.fn(),
    setGroupCollapsed: vi.fn(),
    toggleGroupCollapsed: vi.fn(),
    toggleTriggers: vi.fn(),
    triggers: resolvedTriggers,
    upsertTrigger: vi.fn(),
    upsertTriggers: vi.fn(),
  }),
}))

vi.mock('../../auth/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
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
    render(<UserTriggersEditor selectedCharacter={null} />)

    expect(await screen.findByText('Test Trigger')).toBeInTheDocument()
    expect(screen.queryByLabelText('Enable Test Trigger')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Enable triggers in Raid')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Publish')).toHaveLength(2)
    expect(screen.getAllByLabelText('Private')).toHaveLength(2)
  })

  it('shows enable controls when a character is selected', async () => {
    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    expect(await screen.findByLabelText('Enable Test Trigger')).toBeInTheDocument()
    expect(screen.getByLabelText('Enable triggers in Raid')).toBeInTheDocument()
  })

  it('opens the trigger editor when a trigger is double-clicked', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    await user.dblClick(await screen.findByText('Test Trigger'))

    expect(await screen.findByText('Trigger Editor')).toBeInTheDocument()
  })
})

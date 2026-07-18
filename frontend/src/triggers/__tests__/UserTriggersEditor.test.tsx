// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import {
  createEmptyTrigger,
  withCanonicalTriggerId,
  type JenaResolvedTrigger,
} from '../../shared/triggers'
import { UserTriggersEditor } from '../views/UserTriggersEditor'

const hookState = vi.hoisted(() => ({
  exportGinaPackageFile: vi.fn(),
  rpc: vi.fn(),
  storeTriggers: vi.fn(),
}))

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
  lastLogWriteMs: 1,
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

vi.mock('../model/TriggerStore', () => ({
  useTriggerStore: () => ({
    fetchTriggers: vi.fn(),
    storeTriggers: hookState.storeTriggers,
  }),
}))

vi.mock('../gina/ginaPackageExporter', () => ({
  exportGinaPackageFile: hookState.exportGinaPackageFile,
}))

vi.mock('../../auth/authContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}))

vi.mock('../../shared/messageBrokerHooks', () => ({
  useListen: vi.fn(),
  useRpc: () => hookState.rpc,
  useSender: () => vi.fn(),
}))

describe('UserTriggersEditor', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    hookState.exportGinaPackageFile.mockResolvedValue(new Uint8Array())
    hookState.rpc.mockImplementation(async (destination) => {
      return destination === 'worker.character-presence'
        ? { characters: [] }
        : { code: '{JENA:share:test}' }
    })
    hookState.storeTriggers.mockImplementation(async (triggers) => triggers)
    Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
      configurable: true,
      value: vi.fn(),
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:test'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
    await deleteDatabase('jena')
  })

  it('hides enable controls when no character is selected', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={null} />)

    await user.click(await screen.findByLabelText('Expand Raid'))

    expect(await screen.findByText('Test Trigger')).toBeInTheDocument()
    expect(screen.queryByLabelText('Enable Test Trigger')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Enable triggers in Raid')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Publish')).toHaveLength(2)
    expect(screen.getAllByLabelText('Private')).toHaveLength(2)
  })

  it('shows enable controls when a character is selected', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    await user.click(await screen.findByLabelText('Expand Raid'))

    expect(await screen.findByLabelText('Enable Test Trigger')).toBeInTheDocument()
    expect(screen.getByLabelText('Enable triggers in Raid')).toBeInTheDocument()
  })

  it('opens the trigger editor when a trigger is double-clicked', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    await user.click(await screen.findByLabelText('Expand Raid'))
    await user.dblClick(await screen.findByText('Test Trigger'))

    expect(await screen.findByText('Trigger Editor')).toBeInTheDocument()
  })

  it('exports triggers from a selected collapsed group', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    const groupName = await screen.findByText('Raid')
    expect(screen.queryByText('Test Trigger')).not.toBeInTheDocument()
    fireEvent.contextMenu(groupName)
    await user.click(await screen.findByText('Export this group...'))

    await waitFor(() => {
      expect(hookState.exportGinaPackageFile).toHaveBeenCalledWith(
        [testTrigger],
        expect.any(Object),
      )
    })
  })

  it('shares triggers from a selected collapsed group', async () => {
    const user = userEvent.setup()

    render(<UserTriggersEditor selectedCharacter={selectedCharacter} />)

    const groupName = await screen.findByText('Raid')
    expect(screen.queryByText('Test Trigger')).not.toBeInTheDocument()
    fireEvent.contextMenu(groupName)
    await user.click(await screen.findByText('Share this group'))

    await waitFor(() => {
      expect(hookState.storeTriggers).toHaveBeenCalledWith([testTrigger])
      expect(hookState.rpc).toHaveBeenCalledWith(
        'server.sharing',
        'createSharePackage',
        { triggerIds: [testTrigger.id] },
      )
    })
  })
})

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)

    request.onsuccess = () => resolve()
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to delete IndexedDB database.'))
    request.onblocked = () => resolve()
  })
}

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import { CharacterPane } from '../views/CharacterPane'

const characters: CharacterPresence[] = [
  {
    active: true,
    characterName: 'Mesozoic',
    lastLogWriteMs: 1,
    serverName: 'Bristlebane',
    zone: 'Yxtta',
  },
  {
    active: false,
    characterName: 'Suuloti',
    lastLogWriteMs: 1,
    serverName: 'Bristlebane',
    zone: '',
  },
]

vi.mock('../../characters/LocalCharactersProvider', () => ({
  useLocalCharacters: () => characters,
}))

describe('CharacterPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not select a character by default', async () => {
    const setCharacter = vi.fn()

    render(
      <CharacterPane
        selectedCharacter={null}
        setCharacter={setCharacter}
      />,
    )

    expect(await screen.findByRole('option', { name: /Mesozoic/ })).toHaveAttribute(
      'aria-selected',
      'false',
    )
    expect(setCharacter).not.toHaveBeenCalled()
  })

  it('selects and ctrl-click deselects the selected character', async () => {
    const user = userEvent.setup()
    const setCharacter = vi.fn()

    const { rerender } = render(
      <CharacterPane
        selectedCharacter={null}
        setCharacter={setCharacter}
      />,
    )

    const mesozoic = await screen.findByRole('option', { name: /Mesozoic/ })
    await user.click(mesozoic)
    await waitFor(() => {
      expect(setCharacter).toHaveBeenLastCalledWith(characters[0])
    })

    rerender(
      <CharacterPane
        selectedCharacter={characters[0]}
        setCharacter={setCharacter}
      />,
    )

    fireEvent.click(screen.getByRole('option', { name: /Mesozoic/ }), {
      ctrlKey: true,
    })

    expect(setCharacter).toHaveBeenLastCalledWith(null)
  })
})

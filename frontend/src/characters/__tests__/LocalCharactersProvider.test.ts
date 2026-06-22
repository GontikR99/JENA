import { describe, expect, it } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import type { JenaCharacterServer } from '../../shared/triggers'
import {
  mergeCharacters,
  sortCharactersForDisplay,
} from '../LocalCharactersProvider'

describe('LocalCharactersProvider helpers', () => {
  it('sorts active characters before inactive characters', () => {
    expect(
      sortCharactersForDisplay([
        character('Suuloti', false),
        character('Mesozoic', true),
        character('Arias', true),
      ]),
    ).toEqual([
      character('Arias', true),
      character('Mesozoic', true),
      character('Suuloti', false),
    ])
  })

  it('includes server roster characters as inactive characters', () => {
    expect(
      mergeCharacters(
        characterServersByKey([
          { characterName: 'Joram', serverName: 'Fangbreaker' },
        ]),
        new Map(),
      ),
    ).toEqual([
      {
        active: false,
        characterName: 'Joram',
        lastLogWriteMs: 0,
        serverName: 'Fangbreaker',
        zone: '',
      },
    ])
  })

  it('uses local presence over server roster rows', () => {
    expect(
      mergeCharacters(
        characterServersByKey([
          { characterName: 'jephine', serverName: 'fangbreaker' },
        ]),
        charactersByKey([
          {
            active: true,
            characterName: 'Jephine',
            lastLogWriteMs: 1,
            serverName: 'Fangbreaker',
            zone: 'Tacvi',
          },
        ]),
      ),
    ).toEqual([
      {
        active: true,
        characterName: 'Jephine',
        lastLogWriteMs: 1,
        serverName: 'Fangbreaker',
        zone: 'Tacvi',
      },
    ])
  })
})

function character(
  characterName: string,
  active: boolean,
): CharacterPresence {
  return {
    active,
    characterName,
    lastLogWriteMs: 1,
    serverName: 'Bristlebane',
    zone: '',
  }
}

function charactersByKey(characters: CharacterPresence[]) {
  return new Map(
    characters.map((entry) => [
      `${entry.serverName.toLocaleLowerCase()}\0${entry.characterName.toLocaleLowerCase()}`,
      entry,
    ]),
  )
}

function characterServersByKey(characters: JenaCharacterServer[]) {
  return new Map(
    characters.map((entry) => [
      `${entry.serverName.toLocaleLowerCase()}\0${entry.characterName.toLocaleLowerCase()}`,
      entry,
    ]),
  )
}

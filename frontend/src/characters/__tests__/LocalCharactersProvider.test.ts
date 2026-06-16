import { describe, expect, it } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import { sortCharactersForDisplay } from '../LocalCharactersProvider'

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
})

function character(
  characterName: string,
  active: boolean,
): CharacterPresence {
  return {
    active,
    characterName,
    serverName: 'Bristlebane',
    zone: '',
  }
}

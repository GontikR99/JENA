import { describe, expect, it } from 'vitest'
import type { CharacterPresence } from '../../shared/messages'
import {
  applyNearbyCharactersMessage,
  getNearbyCharactersSnapshot,
} from '../NearbyCharactersProvider'

describe('NearbyCharactersProvider helpers', () => {
  it('replaces previous entries for server and zone from an incoming message', () => {
    let state = new Map<string, CharacterPresence[]>()

    state = applyNearbyCharactersMessage(state, {
      characters: [
        character('Arias', 'bertox', 'The Nexus'),
        character('Brell', 'bertox', 'The Nexus'),
        character('Cazic', 'bertox', 'Plane of Knowledge'),
      ],
    })

    state = applyNearbyCharactersMessage(state, {
      characters: [
        character('Daria', 'bertox', 'The Nexus'),
      ],
    })

    expect(getNearbyCharactersSnapshot(state)).toEqual([
      character('Cazic', 'bertox', 'Plane of Knowledge'),
      character('Daria', 'bertox', 'The Nexus'),
    ])
  })

  it('matches server and zone buckets case-insensitively', () => {
    let state = new Map<string, CharacterPresence[]>()

    state = applyNearbyCharactersMessage(state, {
      characters: [
        character('Arias', 'Bertox', 'The Nexus'),
      ],
    })

    state = applyNearbyCharactersMessage(state, {
      characters: [
        character('Brell', 'bertox', 'the nexus'),
      ],
    })

    expect(getNearbyCharactersSnapshot(state)).toEqual([
      character('Brell', 'bertox', 'the nexus'),
    ])
  })
})

function character(
  characterName: string,
  serverName: string,
  zone: string,
): CharacterPresence {
  return {
    active: true,
    characterName,
    serverName,
    zone,
  }
}

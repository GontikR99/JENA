import type { CharacterPresence } from '../shared/messages'
import type { JenaCharacterServer } from '../shared/triggers'

interface CharacterIdentity {
  characterName: string
  serverName: string
}

export function sortCharactersForDisplay(characters: CharacterPresence[]) {
  return [...characters].sort(compareCharactersForDisplay)
}

export function mergeCharacters(
  serverCharactersByKey: Map<string, JenaCharacterServer>,
  localCharactersByKey: Map<string, CharacterPresence>,
) {
  const merged = new Map<string, CharacterPresence>()

  for (const [key, character] of serverCharactersByKey) {
    merged.set(key, {
      active: false,
      characterName: character.characterName,
      lastLogWriteMs: 0,
      serverName: character.serverName,
      zone: '',
    })
  }

  for (const [key, character] of localCharactersByKey) {
    merged.set(key, character)
  }

  return [...merged.values()]
}

export function getCharacterKey(character: CharacterIdentity) {
  return `${character.serverName.trim().toLocaleLowerCase()}\0${character.characterName.trim().toLocaleLowerCase()}`
}

function compareCharactersForDisplay(
  left: CharacterPresence,
  right: CharacterPresence,
) {
  if (left.active !== right.active) {
    return left.active ? -1 : 1
  }

  const characterComparison = left.characterName.localeCompare(
    right.characterName,
    undefined,
    { sensitivity: 'base' },
  )
  if (characterComparison !== 0) {
    return characterComparison
  }

  return left.serverName.localeCompare(right.serverName, undefined, {
    sensitivity: 'base',
  })
}

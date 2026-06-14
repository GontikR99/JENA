import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  CharacterPresence,
  NearbyCharacterPresenceMessage,
} from '../shared/messages'
import { useListen } from '../shared/messageBrokerHooks'

type NearbyCharactersByZone = Map<string, CharacterPresence[]>

const NearbyCharactersContext = createContext<CharacterPresence[] | null>(null)

interface NearbyCharactersProviderProps {
  children: ReactNode
}

export function NearbyCharactersProvider({
  children,
}: NearbyCharactersProviderProps) {
  const [charactersByZone, setCharactersByZone] =
    useState<NearbyCharactersByZone>(() => new Map())

  useListen('worldwide-presence.nearby-characters', (message) => {
    setCharactersByZone((currentCharactersByZone) => {
      return applyNearbyCharactersMessage(
        currentCharactersByZone,
        message.payload as NearbyCharacterPresenceMessage,
      )
    })
  })

  const characters = useMemo(() => {
    return getNearbyCharactersSnapshot(charactersByZone)
  }, [charactersByZone])

  return (
    <NearbyCharactersContext.Provider value={characters}>
      {children}
    </NearbyCharactersContext.Provider>
  )
}

export function useNearbyCharacters() {
  const characters = useContext(NearbyCharactersContext)

  if (!characters) {
    throw new Error('NearbyCharactersProvider is missing.')
  }

  return characters
}

export function applyNearbyCharactersMessage(
  currentCharactersByZone: NearbyCharactersByZone,
  message: NearbyCharacterPresenceMessage,
): NearbyCharactersByZone {
  const nextCharactersByZone = new Map(currentCharactersByZone)
  const incomingCharactersByZone = groupCharactersByZone(message.characters)

  incomingCharactersByZone.forEach((characters, zoneKey) => {
    nextCharactersByZone.set(zoneKey, sortCharacters(coalesceCharacters(characters)))
  })

  return nextCharactersByZone
}

export function getNearbyCharactersSnapshot(
  charactersByZone: NearbyCharactersByZone,
) {
  return sortCharacters([...charactersByZone.values()].flat())
}

function groupCharactersByZone(characters: CharacterPresence[]) {
  const charactersByZone = new Map<string, CharacterPresence[]>()

  characters.forEach((character) => {
    const zoneKey = getZoneKey(character)
    const existingCharacters = charactersByZone.get(zoneKey) ?? []

    charactersByZone.set(zoneKey, [...existingCharacters, character])
  })

  return charactersByZone
}

function coalesceCharacters(characters: CharacterPresence[]) {
  const charactersByKey = new Map<string, CharacterPresence>()

  characters.forEach((character) => {
    charactersByKey.set(getCharacterKey(character), character)
  })

  return [...charactersByKey.values()]
}

function sortCharacters(characters: CharacterPresence[]) {
  return [...characters].sort(compareCharacters)
}

function getZoneKey(character: CharacterPresence) {
  return `${normalize(character.serverName)}\0${normalize(character.zone)}`
}

function getCharacterKey(character: CharacterPresence) {
  return `${normalize(character.serverName)}\0${normalize(character.characterName)}`
}

function compareCharacters(left: CharacterPresence, right: CharacterPresence) {
  const serverComparison = compareStrings(left.serverName, right.serverName)

  if (serverComparison !== 0) {
    return serverComparison
  }

  const zoneComparison = compareStrings(left.zone, right.zone)

  if (zoneComparison !== 0) {
    return zoneComparison
  }

  return compareStrings(left.characterName, right.characterName)
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase()
}

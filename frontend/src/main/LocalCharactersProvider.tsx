import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  CharacterPresence,
  CharacterPresenceCharactersMessage,
} from '../shared/messages'
import { useListen, useRpc } from '../shared/messageBrokerHooks'

const LocalCharactersContext = createContext<CharacterPresence[] | null>(null)

interface LocalCharactersProviderProps {
  children: ReactNode
}

export function LocalCharactersProvider({
  children,
}: LocalCharactersProviderProps) {
  const callWorker = useRpc('local-characters-provider')
  const [charactersByKey, setCharactersByKey] = useState<
    Map<string, CharacterPresence>
  >(() => new Map())

  useListen('character-presence.characters', (message) => {
    setCharactersByKey(
      getCharactersByKey(
        (message.payload as CharacterPresenceCharactersMessage).characters,
      ),
    )
  })

  useEffect(() => {
    let isCurrent = true

    void callWorker('worker.character-presence', 'getCharacters', {})
      .then(({ characters }) => {
        if (isCurrent) {
          setCharactersByKey(getCharactersByKey(characters))
        }
      })
      .catch((error: unknown) => {
        console.warn('[LocalCharactersProvider] unable to load characters', error)
      })

    return () => {
      isCurrent = false
    }
  }, [callWorker])

  const characters = useMemo(
    () => sortCharactersForDisplay([...charactersByKey.values()]),
    [charactersByKey],
  )

  return (
    <LocalCharactersContext.Provider value={characters}>
      {children}
    </LocalCharactersContext.Provider>
  )
}

export function useLocalCharacters() {
  const characters = useContext(LocalCharactersContext)

  if (!characters) {
    throw new Error('LocalCharactersProvider is missing.')
  }

  return characters
}

export function sortCharactersForDisplay(characters: CharacterPresence[]) {
  return [...characters].sort(compareCharactersForDisplay)
}

function getCharactersByKey(characters: CharacterPresence[]) {
  return new Map(
    characters.map((character) => [getCharacterKey(character), character]),
  )
}

function getCharacterKey(character: CharacterPresence) {
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

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  CharacterPresence,
  CharacterPresenceCharactersMessage,
} from '../shared/messages'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import type { JenaCharacterServer } from '../shared/triggers'
import { useAuth } from '../auth/authContext'

const characterSyncIntervalMs = 60_000

const LocalCharactersContext = createContext<CharacterPresence[] | null>(null)

interface LocalCharactersProviderProps {
  children: ReactNode
}

interface CharacterIdentity {
  characterName: string
  serverName: string
}

export function LocalCharactersProvider({
  children,
}: LocalCharactersProviderProps) {
  const { status } = useAuth()
  const call = useRpc('local-characters-provider')
  const [localCharactersByKey, setLocalCharactersByKey] = useState<
    Map<string, CharacterPresence>
  >(() => new Map())
  const [serverCharactersByKey, setServerCharactersByKey] = useState<
    Map<string, JenaCharacterServer>
  >(() => new Map())
  const localCharactersByKeyRef = useRef(localCharactersByKey)

  useListen('character-presence.characters', (message) => {
    setLocalCharactersByKey(
      getCharactersByKey(
        (message.payload as CharacterPresenceCharactersMessage).characters,
      ),
    )
  })

  useEffect(() => {
    let isCurrent = true

    void call('worker.character-presence', 'getCharacters', {})
      .then(({ characters }) => {
        if (isCurrent) {
          setLocalCharactersByKey(getCharactersByKey(characters))
        }
      })
      .catch((error: unknown) => {
        console.warn('[LocalCharactersProvider] unable to load characters', error)
      })

    return () => {
      isCurrent = false
    }
  }, [call])

  useEffect(() => {
    localCharactersByKeyRef.current = localCharactersByKey
  }, [localCharactersByKey])

  useEffect(() => {
    if (status !== 'authenticated') {
      setServerCharactersByKey(new Map())
      return
    }

    let isCurrent = true

    const syncCharacters = async () => {
      const characters = [...localCharactersByKeyRef.current.values()].map(
        toCharacterServer,
      )

      try {
        const response = await call(
          'server.character-store',
          'syncCharacters',
          { characters },
        )
        if (isCurrent) {
          setServerCharactersByKey(
            getServerCharactersByKey(response.characters),
          )
        }
      } catch (error) {
        if (isCurrent) {
          console.warn(
            '[LocalCharactersProvider] unable to sync user characters',
            error,
          )
        }
      }
    }

    void syncCharacters()
    const intervalId = globalThis.setInterval(
      () => void syncCharacters(),
      characterSyncIntervalMs,
    )

    return () => {
      isCurrent = false
      globalThis.clearInterval(intervalId)
    }
  }, [call, status])

  const characters = useMemo(
    () =>
      sortCharactersForDisplay(
        mergeCharacters(serverCharactersByKey, localCharactersByKey),
      ),
    [localCharactersByKey, serverCharactersByKey],
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

function getServerCharactersByKey(characters: JenaCharacterServer[]) {
  return new Map(
    characters.map((character) => [getCharacterKey(character), character]),
  )
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
      serverName: character.serverName,
      zone: '',
    })
  }

  for (const [key, character] of localCharactersByKey) {
    merged.set(key, character)
  }

  return [...merged.values()]
}

function toCharacterServer(character: CharacterPresence): JenaCharacterServer {
  return {
    characterName: character.characterName,
    serverName: character.serverName,
  }
}

function getCharacterKey(character: CharacterIdentity) {
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

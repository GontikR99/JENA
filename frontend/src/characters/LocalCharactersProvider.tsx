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
  UserCharacterSyncRecord,
} from '../shared/messages'
import { useListen, useRpc } from '../shared/messageBrokerHooks'
import type { JenaCharacterServer } from '../shared/triggers'
import { useAuth } from '../auth/authContext'
import {
  getCharacterKey,
  mergeCharacters,
  sortCharactersForDisplay,
} from './localCharacterHelpers'

const characterSyncIntervalMs = 60_000

const LocalCharactersContext = createContext<CharacterPresence[] | null>(null)

interface LocalCharactersProviderProps {
  children: ReactNode
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

  const effectiveServerCharactersByKey = useMemo(() => {
    if (status !== 'authenticated') {
      return new Map<string, JenaCharacterServer>()
    }

    return serverCharactersByKey
  }, [serverCharactersByKey, status])

  const characters = useMemo(
    () =>
      sortCharactersForDisplay(
        mergeCharacters(effectiveServerCharactersByKey, localCharactersByKey),
      ),
    [effectiveServerCharactersByKey, localCharactersByKey],
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

function toCharacterServer(
  character: CharacterPresence,
): UserCharacterSyncRecord {
  return {
    characterName: character.characterName,
    lastLogWriteMs: character.lastLogWriteMs,
    serverName: character.serverName,
  }
}

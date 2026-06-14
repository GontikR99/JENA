import { useEffect, useState } from 'react'
import activeCharacterUrl from '../../assets/activity-indicator-active.webp'
import inactiveCharacterUrl from '../../assets/activity-indicator-inactive.webp'
import type {
  EverQuestCharacter,
  FileWatcherCharactersMessage,
} from '../../shared/messages'
import { useListen, useRpc } from '../../shared/messageBrokerHooks'

interface CharacterPaneProps {
  selectedCharacter: EverQuestCharacter | null
  setCharacter: (character: EverQuestCharacter) => void
}

export function CharacterPane({
  selectedCharacter,
  setCharacter,
}: CharacterPaneProps) {
  const callWorker = useRpc('client.character-pane')
  const [characters, setCharacters] = useState<EverQuestCharacter[]>([])

  useListen('client.file-watcher.characters', (message) => {
    const nextCharacters = (message.payload as FileWatcherCharactersMessage)
      .characters
    setCharacters(nextCharacters)
  })

  useEffect(() => {
    let isCurrent = true

    void callWorker('worker.file-watcher', 'getCharacters', {})
      .then(({ characters: nextCharacters }) => {
        if (isCurrent) {
          setCharacters(nextCharacters)
        }
      })
      .catch((error: unknown) => {
        console.warn('[CharacterPane] unable to load characters', error)
      })

    return () => {
      isCurrent = false
    }
  }, [callWorker])

  useEffect(() => {
    if (selectedCharacter || characters.length === 0) {
      return
    }

    setCharacter(characters[0])
  }, [characters, selectedCharacter, setCharacter])

  return (
    <aside className="character-pane" aria-label="Characters">
      <div className="character-list" role="listbox">
        {characters.length > 0 ? (
          characters.map((character) => {
            const isSelected = isSameCharacter(character, selectedCharacter)
            const activityLabel = character.active ? 'Active' : 'Inactive'

            return (
              <button
                aria-label={`${character.characterName} on ${character.serverName}, ${activityLabel}`}
                aria-selected={isSelected}
                className={
                  isSelected
                    ? 'character-option character-option-selected'
                    : 'character-option'
                }
                key={`${character.characterName}\0${character.serverName}`}
                onClick={() => setCharacter(character)}
                role="option"
                type="button"
              >
                <div className="character-option-text">
                  <strong>{character.characterName}</strong>
                  <span>{character.serverName}</span>
                </div>
                <img
                  alt=""
                  aria-hidden="true"
                  className="character-activity-image"
                  height="36"
                  src={
                    character.active ? activeCharacterUrl : inactiveCharacterUrl
                  }
                  title={activityLabel}
                  width="36"
                />
              </button>
            )
          })
        ) : (
          <div className="character-empty">No characters detected</div>
        )}
      </div>
    </aside>
  )
}

function isSameCharacter(
  left: EverQuestCharacter,
  right: EverQuestCharacter | null,
) {
  return (
    !!right &&
    left.characterName === right.characterName &&
    left.serverName === right.serverName
  )
}

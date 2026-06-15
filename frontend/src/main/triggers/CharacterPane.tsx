import { useEffect, useMemo, useState } from 'react'
import activeCharacterUrl from '../../assets/activity-indicator-active.webp'
import inactiveCharacterUrl from '../../assets/activity-indicator-inactive.webp'
import type {
  CharacterPresence,
  CharacterPresenceCharactersMessage,
} from '../../shared/messages'
import { useListen, useRpc } from '../../shared/messageBrokerHooks'

interface CharacterPaneProps {
  selectedCharacter: CharacterPresence | null
  setCharacter: (character: CharacterPresence) => void
}

export function CharacterPane({
  selectedCharacter,
  setCharacter,
}: CharacterPaneProps) {
  const callWorker = useRpc('character-pane')
  const [characters, setCharacters] = useState<CharacterPresence[]>([])
  const sortedCharacters = useMemo(
    () => [...characters].sort(compareCharactersForDisplay),
    [characters],
  )

  useListen('character-presence.characters', (message) => {
    const nextCharacters = (message.payload as CharacterPresenceCharactersMessage)
      .characters
    setCharacters(nextCharacters)
  })

  useEffect(() => {
    let isCurrent = true

    void callWorker('worker.character-presence', 'getCharacters', {})
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
    if (selectedCharacter || sortedCharacters.length === 0) {
      return
    }

    setCharacter(sortedCharacters[0])
  }, [selectedCharacter, setCharacter, sortedCharacters])

  return (
    <aside className="character-pane" aria-label="Characters">
      <div className="character-list" role="listbox">
        {sortedCharacters.length > 0 ? (
          sortedCharacters.map((character) => {
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
                  <span>
                    {character.zone
                      ? `${character.zone} — ${character.serverName}`
                      : character.serverName}
                  </span>
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

function isSameCharacter(
  left: CharacterPresence,
  right: CharacterPresence | null,
) {
  return (
    !!right &&
    left.characterName === right.characterName &&
    left.serverName === right.serverName
  )
}

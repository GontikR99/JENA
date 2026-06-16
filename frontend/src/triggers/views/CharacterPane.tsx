import { useEffect } from 'react'
import activeCharacterUrl from '../../assets/activity-indicator-active.webp'
import inactiveCharacterUrl from '../../assets/activity-indicator-inactive.webp'
import type { CharacterPresence } from '../../shared/messages'
import { useLocalCharacters } from '../../characters/LocalCharactersProvider'

interface CharacterPaneProps {
  selectedCharacter: CharacterPresence | null
  setCharacter: (character: CharacterPresence | null) => void
}

export function CharacterPane({
  selectedCharacter,
  setCharacter,
}: CharacterPaneProps) {
  const characters = useLocalCharacters()

  useEffect(() => {
    if (
      selectedCharacter &&
      !characters.some((character) =>
        isSameCharacter(character, selectedCharacter),
      )
    ) {
      setCharacter(null)
    }
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
                onClick={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    isSameCharacter(character, selectedCharacter)
                  ) {
                    setCharacter(null)
                    return
                  }

                  setCharacter(character)
                }}
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

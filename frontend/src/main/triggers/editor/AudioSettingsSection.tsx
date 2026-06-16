import { useEffect, useMemo, useState } from 'react'
import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import type { JenaSpeechAction } from '../../../shared/triggers'
import type { CharacterPresence } from '../../../shared/messages'
import { Section } from './Section'
import type { TriggerEditorAudioMode } from './triggerEditorModel'

interface AudioSettingsSectionProps {
  audioMode: TriggerEditorAudioMode
  characters: CharacterPresence[]
  disabled?: boolean
  onChange?: (state: {
    mode: TriggerEditorAudioMode
    speech: JenaSpeechAction
  }) => void
  onTestSpeech?: (character: CharacterPresence) => void
  state: {
    mode: TriggerEditorAudioMode
    speech: JenaSpeechAction
  }
}

export function AudioSettingsSection({
  audioMode,
  characters,
  disabled = false,
  onChange,
  onTestSpeech,
  state,
}: AudioSettingsSectionProps) {
  const characterOptions = useMemo(() => {
    return characters.map((character) => ({
      character,
      key: getCharacterKey(character),
    }))
  }, [characters])
  const [selectedCharacterKey, setSelectedCharacterKey] = useState(
    characterOptions[0]?.key ?? '',
  )

  useEffect(() => {
    if (
      selectedCharacterKey &&
      characterOptions.some((option) => option.key === selectedCharacterKey)
    ) {
      return
    }

    setSelectedCharacterKey(characterOptions[0]?.key ?? '')
  }, [characterOptions, selectedCharacterKey])

  function setMode(mode: TriggerEditorAudioMode) {
    onChange?.({
      ...state,
      mode,
    })
  }

  function updateSpeech(update: Partial<JenaSpeechAction>) {
    onChange?.({
      ...state,
      speech: {
        ...state.speech,
        ...update,
      },
    })
  }

  function handleTestSpeech() {
    const selectedCharacter = characterOptions.find(
      (option) => option.key === selectedCharacterKey,
    )?.character

    if (selectedCharacter) {
      onTestSpeech?.(selectedCharacter)
    }
  }

  const isTtsSelected = audioMode === 'tts'
  const canTest = characterOptions.length > 0 && isTtsSelected

  return (
    <Section title="Audio Settings">
      <div className="trigger-editor-audio-grid">
        <Form.Check
          checked={audioMode === 'none'}
          disabled={disabled}
          id="trigger-editor-audio-none"
          label="No Sound"
          name="trigger-editor-audio-mode"
          onChange={() => setMode('none')}
          type="radio"
        />

        <Form.Check
          checked={isTtsSelected}
          disabled={disabled}
          id="trigger-editor-audio-tts"
          label="Use Text To Speech"
          name="trigger-editor-audio-mode"
          onChange={() => setMode('tts')}
          type="radio"
        />

        <div className="trigger-editor-form-row trigger-editor-compact-row">
          <div className="trigger-editor-form-label">Text to Say</div>
          <div className="trigger-editor-form-control">
            <Form.Control
              disabled={disabled || !isTtsSelected}
              onChange={(event) =>
                updateSpeech({ text: event.currentTarget.value })
              }
              size="sm"
              type="text"
              value={state.speech.text}
            />
          </div>
        </div>

        <Form.Check
          checked={state.speech.interrupt}
          disabled={disabled || !isTtsSelected}
          id="trigger-editor-interrupt-speech"
          label="Interrupt Speech"
          onChange={(event) =>
            updateSpeech({ interrupt: event.currentTarget.checked })
          }
          type="checkbox"
        />
      </div>

      <div className="trigger-editor-form-row trigger-editor-compact-row mt-2">
        <div className="trigger-editor-form-label">Test</div>
        <div className="trigger-editor-form-control trigger-editor-test-row">
          <Form.Select
            disabled={characterOptions.length === 0}
            onChange={(event) => setSelectedCharacterKey(event.currentTarget.value)}
            size="sm"
            value={selectedCharacterKey}
          >
            {characterOptions.length > 0 ? (
              characterOptions.map(({ character, key }) => (
                <option
                  key={key}
                  value={key}
                >
                  {character.characterName} ({character.serverName})
                </option>
              ))
            ) : (
              <option>No characters available</option>
            )}
          </Form.Select>
          <Button
            aria-label="Test speech"
            disabled={disabled || !canTest}
            onClick={handleTestSpeech}
            size="sm"
            variant="success"
          >
            {'\u25b6'}
          </Button>
        </div>
      </div>
    </Section>
  )
}

function getCharacterKey(character: CharacterPresence) {
  return `${character.characterName}\0${character.serverName}`
}

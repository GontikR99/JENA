import Form from 'react-bootstrap/Form'
import type { CharacterPresence } from '../../shared/messages'
import { AudioSettingsSection } from './AudioSettingsSection'
import { TextSettingsSection } from './TextSettingsSection'
import {
  createTimerAction,
  type TriggerEditorAudioState,
  type TriggerEditorTextState,
  type TriggerEditorTimerState,
} from './triggerEditorModel'

interface TimerEndedTabProps {
  characters: CharacterPresence[]
  onChange: (timer: TriggerEditorTimerState) => void
  timer: TriggerEditorTimerState
}

export function TimerEndedTab({
  characters,
  onChange,
  timer,
}: TimerEndedTabProps) {
  const endedAction = timer.endedAction ?? createTimerAction()
  const textState: TriggerEditorTextState = {
    clipboard: {
      enabled: false,
      text: '',
    },
    display: endedAction.display,
  }
  const audioState: TriggerEditorAudioState = {
    mode: endedAction.speech.enabled ? 'tts' : 'none',
    speech: endedAction.speech,
  }
  const isEnabled = timer.endedAction !== null

  function updateEndedAction(
    text: TriggerEditorTextState,
    audio: TriggerEditorAudioState,
  ) {
    onChange({
      ...timer,
      endedAction: {
        display: text.display,
        speech: {
          ...audio.speech,
          enabled: audio.mode === 'tts',
        },
      },
    })
  }

  return (
    <div className="trigger-editor-tab-panel">
      <div className="trigger-editor-notify-row">
        <Form.Check
          checked={isEnabled}
          id="trigger-editor-timer-ended-enabled"
          label="Notify when timer ends"
          onChange={(event) =>
            onChange({
              ...timer,
              endedAction: event.currentTarget.checked
                ? createTimerAction()
                : null,
            })
          }
          type="checkbox"
        />
      </div>
      <TextSettingsSection
        clipboardTextEnabled={false}
        disabled={!isEnabled}
        displayTextEnabled={endedAction.display.enabled}
        onChange={(text) => updateEndedAction(text, audioState)}
        state={textState}
      />
      <AudioSettingsSection
        audioMode={audioState.mode}
        characters={characters}
        disabled={!isEnabled}
        onChange={(audio) => updateEndedAction(textState, audio)}
        state={audioState}
      />
    </div>
  )
}

import Form from 'react-bootstrap/Form'
import type { CharacterPresence } from '../../../shared/messages'
import { AudioSettingsSection } from './AudioSettingsSection'
import { DurationInput } from './DurationInput'
import { TextSettingsSection } from './TextSettingsSection'
import {
  createTimerAction,
  partsToSeconds,
  type TriggerEditorAudioState,
  type TriggerEditorTextState,
  type TriggerEditorTimerState,
} from './triggerEditorModel'

interface TimerEndingTabProps {
  characters: CharacterPresence[]
  onChange: (timer: TriggerEditorTimerState) => void
  timer: TriggerEditorTimerState
}

export function TimerEndingTab({
  characters,
  onChange,
  timer,
}: TimerEndingTabProps) {
  const warningAction = timer.warningAction ?? createTimerAction()
  const textState: TriggerEditorTextState = {
    clipboard: {
      enabled: false,
      text: '',
    },
    display: warningAction.display,
  }
  const audioState: TriggerEditorAudioState = {
    mode: warningAction.speech.enabled ? 'tts' : 'none',
    speech: warningAction.speech,
  }
  const isEnabled = timer.warningAction !== null

  function updateWarningAction(
    text: TriggerEditorTextState,
    audio: TriggerEditorAudioState,
  ) {
    onChange({
      ...timer,
      warningAction: {
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
          id="trigger-editor-timer-ending-enabled"
          label="Notify when timer is is down to"
          onChange={(event) =>
            onChange({
              ...timer,
              warningAction: event.currentTarget.checked
                ? createTimerAction()
                : null,
            })
          }
          type="checkbox"
        />
        <DurationInput
          defaultSeconds={1}
          disabled={!isEnabled}
          onChange={(parts) =>
            onChange({ ...timer, warningSeconds: partsToSeconds(parts) })
          }
          showMilliseconds={false}
          valueSeconds={timer.warningSeconds}
        />
      </div>
      <TextSettingsSection
        clipboardTextEnabled={false}
        disabled={!isEnabled}
        displayTextEnabled={warningAction.display.enabled}
        onChange={(text) => updateWarningAction(text, audioState)}
        state={textState}
      />
      <AudioSettingsSection
        audioMode={audioState.mode}
        characters={characters}
        disabled={!isEnabled}
        onChange={(audio) => updateWarningAction(textState, audio)}
        state={audioState}
      />
    </div>
  )
}

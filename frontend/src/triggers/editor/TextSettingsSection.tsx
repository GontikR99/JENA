import Form from 'react-bootstrap/Form'
import type {
  JenaClipboardAction,
  JenaTextAction,
} from '../../shared/triggers'
import { Section } from './Section'

interface TextSettingsSectionProps {
  clipboardTextEnabled: boolean
  disabled?: boolean
  displayTextEnabled: boolean
  onChange?: (state: {
    clipboard: JenaClipboardAction
    display: JenaTextAction
  }) => void
  state: {
    clipboard: JenaClipboardAction
    display: JenaTextAction
  }
}

export function TextSettingsSection({
  clipboardTextEnabled,
  disabled = false,
  displayTextEnabled,
  onChange,
  state,
}: TextSettingsSectionProps) {
  function updateDisplay(update: Partial<JenaTextAction>) {
    onChange?.({
      ...state,
      display: {
        ...state.display,
        ...update,
      },
    })
  }

  function updateClipboard(update: Partial<JenaClipboardAction>) {
    onChange?.({
      ...state,
      clipboard: {
        ...state.clipboard,
        ...update,
      },
    })
  }

  return (
    <Section title="Text Settings">
      <div className="trigger-editor-checkbox-row">
        <Form.Check
          checked={displayTextEnabled}
          disabled={disabled}
          id="trigger-editor-display-text-enabled"
          label="Display Text"
          onChange={(event) =>
            updateDisplay({ enabled: event.currentTarget.checked })
          }
          type="checkbox"
        />
        <Form.Control
          disabled={disabled || !displayTextEnabled}
          onChange={(event) => updateDisplay({ text: event.currentTarget.value })}
          size="sm"
          type="text"
          value={state.display.text}
        />
      </div>

      <div className="trigger-editor-checkbox-row">
        <Form.Check
          checked={clipboardTextEnabled}
          disabled={disabled}
          id="trigger-editor-clipboard-text-enabled"
          label="Clipboard Text"
          onChange={(event) =>
            updateClipboard({ enabled: event.currentTarget.checked })
          }
          type="checkbox"
        />
        <Form.Control
          disabled={disabled || !clipboardTextEnabled}
          onChange={(event) =>
            updateClipboard({ text: event.currentTarget.value })
          }
          size="sm"
          type="text"
          value={state.clipboard.text}
        />
      </div>
    </Section>
  )
}

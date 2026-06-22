import Form from 'react-bootstrap/Form'
import type {
  JenaClipboardAction,
  JenaTextAction,
} from '../../shared/triggers'
import { FourStateCheckbox } from '../../shared/widgets/FourStateCheckbox'
import { BINARY } from '../../shared/widgets/fourStateCheckboxModes'
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
        <FourStateCheckbox
          disabled={disabled}
          id="trigger-editor-display-text-enabled"
          label="Display Text"
          mode={BINARY}
          onChange={(nextState) =>
            updateDisplay({ enabled: nextState === 'enabled' })
          }
          state={displayTextEnabled ? 'enabled' : 'disabled'}
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
        <FourStateCheckbox
          disabled={disabled}
          id="trigger-editor-clipboard-text-enabled"
          label="Clipboard Text"
          mode={BINARY}
          onChange={(nextState) =>
            updateClipboard({ enabled: nextState === 'enabled' })
          }
          state={clipboardTextEnabled ? 'enabled' : 'disabled'}
        />
        <div className="trigger-editor-text-control-stack">
          <Form.Control
            disabled={disabled || !clipboardTextEnabled}
            onChange={(event) =>
              updateClipboard({ text: event.currentTarget.value })
            }
            size="sm"
            type="text"
            value={state.clipboard.text}
          />
          <small className="trigger-editor-companion-note">
            (requires{' '}
            <a href="/downloads/jena-companion-setup.exe">companion app</a>)
          </small>
        </div>
      </div>
    </Section>
  )
}

import Form from 'react-bootstrap/Form'
import { DurationInput } from './DurationInput'

export function CounterTab() {
  return (
    <div className="trigger-editor-tab-panel">
      <div className="trigger-editor-notify-row">
        <Form.Check
          disabled
          id="trigger-editor-counter-reset"
          label="Reset counter if unmatched for"
          type="checkbox"
        />
        <DurationInput
          disabled
          showMilliseconds={false}
          defaultHours={0}
          defaultMinutes={0}
          defaultSeconds={0}
        />
      </div>
    </div>
  )
}

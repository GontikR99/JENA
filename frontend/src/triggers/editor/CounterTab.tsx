import { FourStateCheckbox } from '../../shared/widgets/FourStateCheckbox'
import { BINARY } from '../../shared/widgets/fourStateCheckboxModes'
import { DurationInput } from './DurationInput'

export function CounterTab() {
  return (
    <div className="trigger-editor-tab-panel">
      <div className="trigger-editor-notify-row">
        <FourStateCheckbox
          disabled
          id="trigger-editor-counter-reset"
          label="Reset counter if unmatched for"
          mode={BINARY}
          onChange={() => undefined}
          state="disabled"
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

import Form from 'react-bootstrap/Form'
import InputGroup from 'react-bootstrap/InputGroup'
import {
  durationMsToParts,
  secondsToParts,
  type DurationParts,
} from './triggerEditorModel'

interface DurationInputProps {
  defaultHours?: number
  defaultMilliseconds?: number
  defaultMinutes?: number
  defaultSeconds?: number
  disabled?: boolean
  onChange?: (parts: DurationParts) => void
  showMilliseconds: boolean
  valueMs?: number
  valueSeconds?: number
}

export function DurationInput({
  defaultHours = 0,
  defaultMilliseconds = 0,
  defaultMinutes = 0,
  defaultSeconds = 0,
  disabled = false,
  onChange,
  showMilliseconds,
  valueMs,
  valueSeconds,
}: DurationInputProps) {
  const parts =
    typeof valueMs === 'number'
      ? durationMsToParts(valueMs)
      : typeof valueSeconds === 'number'
        ? secondsToParts(valueSeconds)
        : {
            hours: defaultHours,
            milliseconds: defaultMilliseconds,
            minutes: defaultMinutes,
            seconds: defaultSeconds,
          }

  function updatePart(part: keyof DurationParts, value: string) {
    const nextParts = {
      ...parts,
      [part]: normalizeNumericValue(value),
    }

    onChange?.(nextParts)
  }

  return (
    <div className="trigger-editor-duration">
      <DurationPart
        disabled={disabled}
        label="h"
        onChange={(value) => updatePart('hours', value)}
        value={parts.hours}
      />
      <DurationPart
        disabled={disabled}
        label="m"
        onChange={(value) => updatePart('minutes', value)}
        value={parts.minutes}
      />
      <DurationPart
        disabled={disabled}
        label="s"
        onChange={(value) => updatePart('seconds', value)}
        value={parts.seconds}
      />
      {showMilliseconds ? (
        <DurationPart
          disabled={disabled}
          label="ms"
          onChange={(value) => updatePart('milliseconds', value)}
          value={parts.milliseconds}
        />
      ) : null}
    </div>
  )
}

interface DurationPartProps {
  disabled: boolean
  label: string
  onChange: (value: string) => void
  value: number
}

function DurationPart({ disabled, label, onChange, value }: DurationPartProps) {
  return (
    <InputGroup size="sm" className="trigger-editor-duration-part">
      <Form.Control
        disabled={disabled}
        min={0}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="number"
        value={value}
      />
      <InputGroup.Text>{label}</InputGroup.Text>
    </InputGroup>
  )
}

function normalizeNumericValue(value: string) {
  const parsedValue = Number.parseInt(value, 10)
  return Number.isFinite(parsedValue) ? Math.max(0, parsedValue) : 0
}

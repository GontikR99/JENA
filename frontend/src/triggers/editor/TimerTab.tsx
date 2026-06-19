import Button from 'react-bootstrap/Button'
import Form from 'react-bootstrap/Form'
import Table from 'react-bootstrap/Table'
import { DurationInput } from './DurationInput'
import { FormGridRow } from './Section'
import {
  partsToDurationMs,
  type TriggerEditorTimerState,
} from './triggerEditorModel'
import type { JenaTimerEarlyEnder } from '../../shared/triggers'
import { BINARY, FourStateCheckbox } from '../../shared/widgets/FourStateCheckbox'

interface TimerTabProps {
  onChange: (timer: TriggerEditorTimerState) => void
  timer: TriggerEditorTimerState
}

export function TimerTab({ onChange, timer }: TimerTabProps) {
  function updateEarlyEnder(
    index: number,
    value: Partial<JenaTimerEarlyEnder>,
  ) {
    const earlyEnders = [...timer.earlyEnders]
    earlyEnders[index] = {
      ...earlyEnders[index],
      ...value,
    }
    onChange({ ...timer, earlyEnders })
  }

  function addEarlyEnder() {
    onChange({
      ...timer,
      earlyEnders: [
        ...timer.earlyEnders,
        {
          text: '',
          isRegex: false,
        },
      ],
    })
  }

  return (
    <div className="trigger-editor-tab-panel">
      <FormGridRow label="Timer Type">
        <Form.Select
          onChange={(event) =>
            onChange({
              ...timer,
              type: event.currentTarget.value as TriggerEditorTimerState['type'],
            })
          }
          size="sm"
          value={timer.type}
        >
          <option value="none">No Timer</option>
          <option value="countdown">Countdown Timer</option>
          <option value="repeating">Repeating Timer</option>
          <option value="stopwatch">Stopwatch</option>
        </Form.Select>
      </FormGridRow>

      <FormGridRow label="Timer Name">
        <Form.Control
          disabled={timer.type === 'none'}
          onChange={(event) =>
            onChange({ ...timer, name: event.currentTarget.value })
          }
          size="sm"
          type="text"
          value={timer.name}
        />
      </FormGridRow>

      <FormGridRow label="Timer Duration">
        <DurationInput
          disabled={timer.type === 'none'}
          onChange={(parts) =>
            onChange({ ...timer, durationMs: partsToDurationMs(parts) })
          }
          showMilliseconds
          valueMs={timer.durationMs}
        />
      </FormGridRow>

      <FormGridRow label="If timer is already running when triggered again:">
        <Form.Select
          disabled={timer.type === 'none'}
          onChange={(event) =>
            onChange({
              ...timer,
              startBehavior: event.currentTarget
                .value as TriggerEditorTimerState['startBehavior'],
            })
          }
          size="sm"
          value={timer.startBehavior}
        >
          <option value="startNew">Start a new timer</option>
          <option value="restart">Restart timer</option>
          <option value="restartMatchingTimerName">
            Restart timer matching timer name
          </option>
          <option value="ignoreIfRunning">Ignore if running</option>
        </Form.Select>
      </FormGridRow>

      <div className="trigger-editor-grid-label">
        End early text (for multiple possible values, add a row for each):
      </div>
      <div className="trigger-editor-grid">
        <Table bordered size="sm" className="mb-0">
          <thead>
            <tr>
              <th>Search Text</th>
              <th className="trigger-editor-regex-column">Use Regex</th>
            </tr>
          </thead>
          <tbody>
            {timer.earlyEnders.map((earlyEnder, index) => (
              <tr key={index}>
                <td>
                  <Form.Control
                    disabled={timer.type === 'none'}
                    onChange={(event) =>
                      updateEarlyEnder(index, {
                        text: event.currentTarget.value,
                      })
                    }
                    size="sm"
                    type="text"
                    value={earlyEnder.text}
                  />
                </td>
                <td className="text-center">
                  <FourStateCheckbox
                    ariaLabel={`Use regex for early ender ${index + 1}`}
                    disabled={timer.type === 'none'}
                    mode={BINARY}
                    onChange={(nextState) =>
                      updateEarlyEnder(index, {
                        isRegex: nextState === 'enabled',
                      })
                    }
                    state={earlyEnder.isRegex ? 'enabled' : 'disabled'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <Button
        className="mt-2"
        disabled={timer.type === 'none'}
        onClick={addEarlyEnder}
        size="sm"
        variant="secondary"
      >
        Add row
      </Button>
    </div>
  )
}

import { useCallback, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { CharacterPresence } from '../../shared/messages'
import { useOnTriggerMatch } from '../alerts/useTriggerAlerts'
import type { TriggerLogRecord } from '../model/types'
import { CharacterPane } from './CharacterPane'
import { TriggerLogTable } from './TriggerLogTable'
import { UserTriggersEditor } from './UserTriggersEditor'
import './TriggersView.css'

const maxTriggerLogRecords = 1000

export function TriggersView() {
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterPresence | null>(null)
  const [triggerLogRecords, setTriggerLogRecords] = useState<TriggerLogRecord[]>([])
  const nextLogRecordIdRef = useRef(0)

  useOnTriggerMatch(
    useCallback((event) => {
      nextLogRecordIdRef.current += 1
      const alert = event.alert
      const record: TriggerLogRecord = {
        characterName: alert.characterName,
        id: `${alert.timestamp}-${alert.trigger.id}-${nextLogRecordIdRef.current}`,
        logLine: alert.text,
        serverName: alert.serverName,
        timestamp: alert.timestamp,
        triggerId: alert.trigger.id,
        triggerName: alert.trigger.name,
      }

      setTriggerLogRecords((records) => {
        return [record, ...records].slice(0, maxTriggerLogRecords)
      })
    }, []),
  )

  function handleTriggerClick(triggerId: string) {
    void triggerId
  }

  return (
    <section className="triggers-view">
      <CharacterPane
        selectedCharacter={selectedCharacter}
        setCharacter={setSelectedCharacter}
      />

      <Group className="triggers-workspace" orientation="vertical">
        <Panel
          defaultSize={75}
          groupResizeBehavior="preserve-relative-size"
          minSize={20}
        >
          <Group className="triggers-top-pane" orientation="horizontal">
            <Panel
              defaultSize={50}
              groupResizeBehavior="preserve-relative-size"
              minSize={25}
            >
              <UserTriggersEditor selectedCharacter={selectedCharacter} />
            </Panel>

            <Separator className="triggers-horizontal-resize-handle" />

            <Panel
              defaultSize={50}
              groupResizeBehavior="preserve-relative-size"
              minSize={25}
            >
              <div className="trigger-details-placeholder">
                Trigger details placeholder
              </div>
            </Panel>
          </Group>
        </Panel>

        <Separator className="triggers-resize-handle" />

        <Panel
          defaultSize={25}
          groupResizeBehavior="preserve-relative-size"
          minSize={20}
        >
          <TriggerLogTable
            onTriggerClick={handleTriggerClick}
            records={triggerLogRecords}
          />
        </Panel>
      </Group>
    </section>
  )
}

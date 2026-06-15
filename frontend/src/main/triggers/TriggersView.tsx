import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { CharacterPresence } from '../../shared/messages'
import { CharacterPane } from './CharacterPane'
import { TriggerLogTable } from './TriggerLogTable'
import { UserTriggersEditor } from './UserTriggersEditor'
import type { TriggerLogRecord } from './types'
import './TriggersView.css'

export function TriggersView() {
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterPresence | null>(null)
  const [triggerLogRecords] = useState<TriggerLogRecord[]>([])

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

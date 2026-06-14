import { useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { EverQuestCharacter } from '../../shared/messages'
import { CharacterPane } from './CharacterPane'
import { TriggerLogTable } from './TriggerLogTable'
import type { TriggerLogRecord } from './types'
import './TriggersView.css'

export function TriggersView() {
  const [selectedCharacter, setSelectedCharacter] =
    useState<EverQuestCharacter | null>(null)
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
          <div className="triggers-top-pane">Trigger details placeholder</div>
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

import { useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useLocalCharacters } from '../../characters/LocalCharactersProvider'
import type { CharacterPresence } from '../../shared/messages'
import type { TriggerLogRecord, TriggerRevealRequest } from '../model/types'
import { useTriggerLog } from '../model/TriggerLog'
import { CharacterPane } from './CharacterPane'
import { SubscribedTriggersView } from './SubscribedTriggersView'
import { TriggerLogTable } from './TriggerLogTable'
import { UserTriggersEditor } from './UserTriggersEditor'
import './TriggersView.css'

export function TriggersView() {
  const characters = useLocalCharacters()
  const { records: triggerLogRecords } = useTriggerLog()
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterPresence | null>(null)
  const [triggerRevealRequest, setTriggerRevealRequest] =
    useState<TriggerRevealRequest | null>(null)
  const nextRevealRequestIdRef = useRef(0)

  function handleTriggerClick(record: TriggerLogRecord) {
    const matchingCharacter = characters.find((character) =>
      isSameCharacterRecord(character, record),
    )

    if (matchingCharacter) {
      setSelectedCharacter(matchingCharacter)
    }

    nextRevealRequestIdRef.current += 1
    setTriggerRevealRequest(
      record.subscriptionId
        ? {
            id: nextRevealRequestIdRef.current,
            subscriptionId: record.subscriptionId,
            target: 'subscription',
            triggerId: record.triggerId,
          }
        : {
            id: nextRevealRequestIdRef.current,
            target: 'user',
            triggerId: record.triggerId,
          },
    )
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
              <UserTriggersEditor
                revealRequest={triggerRevealRequest}
                selectedCharacter={selectedCharacter}
              />
            </Panel>

            <Separator className="triggers-horizontal-resize-handle" />

            <Panel
              defaultSize={50}
              groupResizeBehavior="preserve-relative-size"
              minSize={25}
            >
              <SubscribedTriggersView
                revealRequest={triggerRevealRequest}
                selectedCharacter={selectedCharacter}
              />
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

function isSameCharacterRecord(
  character: CharacterPresence,
  record: TriggerLogRecord,
) {
  return (
    character.characterName === record.characterName &&
    character.serverName === record.serverName
  )
}

import { useCallback, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { useLocalCharacters } from '../../characters/LocalCharactersProvider'
import type { CharacterPresence } from '../../shared/messages'
import {
  useOnTriggerMatch,
  type TriggerMatchEvent,
} from '../alerts/useTriggerAlerts'
import type { TriggerLogRecord, TriggerRevealRequest } from '../model/types'
import { CharacterPane } from './CharacterPane'
import { SubscribedTriggersView } from './SubscribedTriggersView'
import { TriggerLogTable } from './TriggerLogTable'
import { UserTriggersEditor } from './UserTriggersEditor'
import './TriggersView.css'

const maxTriggerLogRecords = 1000

export function TriggersView() {
  const characters = useLocalCharacters()
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterPresence | null>(null)
  const [triggerLogRecords, setTriggerLogRecords] = useState<TriggerLogRecord[]>([])
  const [triggerRevealRequest, setTriggerRevealRequest] =
    useState<TriggerRevealRequest | null>(null)
  const nextLogRecordIdRef = useRef(0)
  const nextRevealRequestIdRef = useRef(0)

  useOnTriggerMatch(
    useCallback((event) => {
      nextLogRecordIdRef.current += 1
      const alert = event.alert
      const record: TriggerLogRecord = {
        characterName: alert.characterName,
        id: `${alert.timestamp}-${alert.trigger.id}-${nextLogRecordIdRef.current}`,
        logLine: alert.text,
        serverName: alert.serverName,
        subscriptionId: getLogSubscriptionId(event),
        timestamp: alert.timestamp,
        triggerId: alert.trigger.id,
        triggerName: alert.trigger.name,
      }

      setTriggerLogRecords((records) => {
        return [record, ...records].slice(0, maxTriggerLogRecords)
      })
    }, []),
  )

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

function getLogSubscriptionId(event: TriggerMatchEvent) {
  if (event.subscriptionId) {
    return event.subscriptionId
  }

  if (
    event.registrations.some(
      (registration) => registration.source === 'user' && registration.enabled,
    )
  ) {
    return undefined
  }

  return event.registrations.find(isSubscriptionRegistration)?.subscriptionId
}

function isSubscriptionRegistration(
  registration: TriggerMatchEvent['registrations'][number],
): registration is Extract<
  TriggerMatchEvent['registrations'][number],
  { source: 'subscription' }
> {
  return registration.source === 'subscription'
}

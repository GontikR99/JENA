import { useEffect, useMemo, useState } from 'react'
import { RE2JS } from 're2js'
import Alert from 'react-bootstrap/Alert'
import Button from 'react-bootstrap/Button'
import Modal from 'react-bootstrap/Modal'
import Tab from 'react-bootstrap/Tab'
import Tabs from 'react-bootstrap/Tabs'
import {
  matcherToRegexSource,
  withCanonicalTriggerId,
  type JenaTrigger,
} from '../../shared/triggers'
import type {
  CharacterPresence,
  CharacterPresenceCharactersMessage,
} from '../../shared/messages'
import { useListen, useRpc } from '../../shared/messageBrokerHooks'
import { AudioSettingsSection } from './editor/AudioSettingsSection'
import { CounterTab } from './editor/CounterTab'
import { GeneralSettingsSection } from './editor/GeneralSettingsSection'
import { TextSettingsSection } from './editor/TextSettingsSection'
import { TimerEndedTab } from './editor/TimerEndedTab'
import { TimerEndingTab } from './editor/TimerEndingTab'
import { TimerTab } from './editor/TimerTab'
import {
  createDraftFromTrigger,
  createTriggerFromDraft,
  validateTriggerDraft,
  type TriggerEditorDraft,
} from './editor/triggerEditorModel'
import './TriggerEditorDialog.css'

export interface TriggerEditorDialogProps {
  setShown: (shown: boolean) => void
  setTrigger: (trigger: JenaTrigger) => void
  shown: boolean
  trigger: JenaTrigger
}

export function TriggerEditorDialog({
  setShown,
  setTrigger,
  shown,
  trigger,
}: TriggerEditorDialogProps) {
  const callWorker = useRpc('trigger-editor')
  const initialDraft = useMemo(() => createDraftFromTrigger(trigger), [trigger])
  const [characters, setCharacters] = useState<CharacterPresence[]>([])
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [draftState, setDraftState] = useState<{
    draft: TriggerEditorDraft
    trigger: JenaTrigger
  }>(() => ({
    draft: initialDraft,
    trigger,
  }))
  const draft =
    draftState.trigger === trigger ? draftState.draft : initialDraft

  const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft)

  useListen('character-presence.characters', (message) => {
    setCharacters(
      (message.payload as CharacterPresenceCharactersMessage).characters,
    )
  })

  useEffect(() => {
    if (!shown) {
      return
    }

    let isCurrent = true

    void callWorker('worker.character-presence', 'getCharacters', {})
      .then(({ characters: nextCharacters }) => {
        if (isCurrent) {
          setCharacters(nextCharacters)
        }
      })
      .catch((error: unknown) => {
        console.warn('[TriggerEditorDialog] unable to load characters', error)
      })

    return () => {
      isCurrent = false
    }
  }, [callWorker, shown])

  function setDraft(nextDraft: TriggerEditorDraft) {
    setValidationErrors([])
    setDraftState({
      draft: nextDraft,
      trigger,
    })
  }

  function handleCancel() {
    setShown(false)
  }

  function handleSave() {
    const nextValidationErrors = [
      ...validateTriggerDraft(draft),
      ...validateRegularExpressions(draft),
    ]

    if (nextValidationErrors.length > 0) {
      setValidationErrors(nextValidationErrors)
      return
    }

    setTrigger(withCanonicalTriggerId(createTriggerFromDraft(draft)))
    setShown(false)
  }

  return (
    <Modal
      centered
      dialogClassName="trigger-editor-dialog"
      onHide={handleCancel}
      show={shown}
    >
      <Modal.Header closeButton>
        <Modal.Title>Trigger Editor</Modal.Title>
      </Modal.Header>
      <Modal.Body className="trigger-editor-body">
        <GeneralSettingsSection draft={draft} onChange={setDraft} />
        {validationErrors.length > 0 ? (
          <Alert className="mb-0 py-2" variant="danger">
            {validationErrors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </Alert>
        ) : null}

        <Tabs defaultActiveKey="basic" id="trigger-editor-tabs" mountOnEnter>
          <Tab eventKey="basic" title="Basic">
            <div className="trigger-editor-tab-panel">
              <TextSettingsSection
                clipboardTextEnabled={draft.actions.text.clipboard.enabled}
                displayTextEnabled={draft.actions.text.display.enabled}
                onChange={(text) =>
                  setDraft({
                    ...draft,
                    actions: {
                      ...draft.actions,
                      text,
                    },
                  })
                }
                state={draft.actions.text}
              />
              <AudioSettingsSection
                audioMode={draft.actions.audio.mode}
                characters={characters}
                onChange={(audio) =>
                  setDraft({
                    ...draft,
                    actions: {
                      ...draft.actions,
                      audio,
                    },
                  })
                }
                state={draft.actions.audio}
              />
            </div>
          </Tab>
          <Tab eventKey="timer" title="Timer">
            <TimerTab
              onChange={(timer) => setDraft({ ...draft, timer })}
              timer={draft.timer}
            />
          </Tab>
          <Tab eventKey="timer-ending" title="Timer Ending">
            <TimerEndingTab
              characters={characters}
              onChange={(timer) => setDraft({ ...draft, timer })}
              timer={draft.timer}
            />
          </Tab>
          <Tab eventKey="timer-ended" title="Timer Ended">
            <TimerEndedTab
              characters={characters}
              onChange={(timer) => setDraft({ ...draft, timer })}
              timer={draft.timer}
            />
          </Tab>
          <Tab eventKey="counter" title="Counter">
            <CounterTab />
          </Tab>
        </Tabs>
      </Modal.Body>
      <Modal.Footer>
        <Button onClick={handleCancel} size="sm" variant="secondary">
          Cancel
        </Button>
        <Button disabled={!isDirty} onClick={handleSave} size="sm">
          Save
        </Button>
      </Modal.Footer>
    </Modal>
  )
}

function validateRegularExpressions(draft: TriggerEditorDraft) {
  const errors: string[] = []

  if (draft.match.isRegex) {
    try {
      RE2JS.compile(RE2JS.translateRegExp(draft.match.text))
    } catch (error) {
      errors.push(`Search text must be a valid regular expression: ${getErrorMessage(error)}`)
    }
  } else {
    RE2JS.compile(RE2JS.translateRegExp(matcherToRegexSource(draft.match)))
  }

  draft.timer.earlyEnders.forEach((earlyEnder, index) => {
    if (earlyEnder.text.trim().length === 0) {
      return
    }

    if (earlyEnder.isRegex) {
      try {
        RE2JS.compile(RE2JS.translateRegExp(earlyEnder.text))
      } catch (error) {
        errors.push(
          `Timer early-end text row ${index + 1} must be a valid regular expression: ${getErrorMessage(error)}`,
        )
      }
    } else {
      RE2JS.compile(RE2JS.translateRegExp(matcherToRegexSource(earlyEnder)))
    }
  })

  return errors
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

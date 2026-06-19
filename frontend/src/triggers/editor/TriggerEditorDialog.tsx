import { useEffect, useMemo, useState } from 'react'
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
import { useListen, useRpc, useSender } from '../../shared/messageBrokerHooks'
import { validateRegexPattern } from '../../shared/regexValidation'
import { AudioSettingsSection } from './AudioSettingsSection'
import { CounterTab } from './CounterTab'
import { GeneralSettingsSection } from './GeneralSettingsSection'
import { TextSettingsSection } from './TextSettingsSection'
import { TimerEndedTab } from './TimerEndedTab'
import { TimerEndingTab } from './TimerEndingTab'
import { TimerTab } from './TimerTab'
import {
  createDraftFromTrigger,
  createTriggerFromDraft,
  validateTriggerDraft,
  type TriggerEditorDraft,
} from './triggerEditorModel'
import {
  createPreviewAlertMatchContext,
  substituteAlertTemplate,
} from '../alerts/alertPatternCompiler'
import './TriggerEditorDialog.css'

export interface TriggerEditorDialogProps {
  readOnly?: boolean
  setShown: (shown: boolean) => void
  setTrigger: (trigger: JenaTrigger) => void
  shown: boolean
  trigger: JenaTrigger
}

export function TriggerEditorDialog({
  readOnly = false,
  setShown,
  setTrigger,
  shown,
  trigger,
}: TriggerEditorDialogProps) {
  const callWorker = useRpc('trigger-editor')
  const send = useSender('trigger-editor')
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

  function handleTestSpeech(character: CharacterPresence) {
    const speechText = draft.actions.audio.speech.text.trim()
    if (speechText.length === 0) {
      return
    }

    const context = createPreviewAlertMatchContext({
      characterName: character.characterName,
      matcher: draft.match,
    })
    const substitutedText =
      substituteAlertTemplate(speechText, context) ?? speechText

    send('speech.preview-requested', {
      interrupt: true,
      text: substitutedText,
    })
  }

  return (
    <Modal
      centered
      dialogClassName="trigger-editor-dialog"
      onHide={handleCancel}
      show={shown}
    >
      <Modal.Header closeButton>
        <Modal.Title>{readOnly ? 'View Trigger' : 'Trigger Editor'}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="trigger-editor-body">
        <fieldset className="trigger-editor-readonly-fieldset" disabled={readOnly}>
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
                  onTestSpeech={handleTestSpeech}
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
        </fieldset>
      </Modal.Body>
      <Modal.Footer>
        {readOnly ? (
          <Button onClick={handleCancel} size="sm">
            Close
          </Button>
        ) : (
          <>
            <Button onClick={handleCancel} size="sm" variant="secondary">
              Cancel
            </Button>
            <Button disabled={!isDirty} onClick={handleSave} size="sm">
              Save
            </Button>
          </>
        )}
      </Modal.Footer>
    </Modal>
  )
}

function validateRegularExpressions(draft: TriggerEditorDraft) {
  const errors: string[] = []

  const searchTextError = getRegexValidationError(
    draft.match.isRegex ? draft.match.text : matcherToRegexSource(draft.match),
  )

  if (searchTextError) {
    errors.push(`Search text must be a valid regular expression: ${searchTextError}`)
  }

  draft.timer.earlyEnders.forEach((earlyEnder, index) => {
    if (earlyEnder.text.trim().length === 0) {
      return
    }

    const earlyEnderError = getRegexValidationError(
      earlyEnder.isRegex ? earlyEnder.text : matcherToRegexSource(earlyEnder),
    )

    if (earlyEnderError) {
      errors.push(
        `Timer early-end text row ${index + 1} must be a valid regular expression: ${earlyEnderError}`,
      )
    }
  })

  return errors
}

function getRegexValidationError(pattern: string) {
  const validation = validateRegexPattern(pattern)

  return validation.ok ? null : validation.error
}

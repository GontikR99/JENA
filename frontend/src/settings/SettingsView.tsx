import { useEffect } from 'react'
import Form from 'react-bootstrap/Form'
import { Volume2 } from 'lucide-react'
import { useSender } from '../shared/messageBrokerHooks'
import { useSettings } from './settingsContext'
import { useSpeechVoices } from './speechVoiceContext'
import { isValidUserSettings } from './settingsTypes'
import './SettingsView.css'

export function SettingsView() {
  const send = useSender('settings-view')
  const {
    flushSettings,
    isSavingUserSettings,
    isUserSettingsAvailable,
    isUserSettingsValid,
    machineSettings,
    updateMachineSettings,
    updateUserSettings,
    userSettings,
  } = useSettings()
  const { isLoading, isSupported, voices } = useSpeechVoices()

  useEffect(() => {
    return () => {
      void flushSettings()
    }
  }, [flushSettings])

  const displayName = userSettings?.displayName ?? ''
  const isDisplayNameInvalid =
    isUserSettingsAvailable && !isValidUserSettings(userSettings)

  return (
    <div className="settings-view">
      <div className="settings-content">
        <section className="settings-section">
          <h1>Settings</h1>
        </section>

        <section className="settings-section">
          <h2>Machine settings</h2>

          <div className="settings-subsection">
            <h3>Trigger match alerts</h3>
            <Form.Group
              className="settings-field"
              controlId="include-character-name"
            >
              <Form.Label>Include character name for trigger matches.</Form.Label>
              <Form.Select
                value={machineSettings.includeCharacterNameForTriggerMatches}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  if (
                    value !== 'never' &&
                    value !== 'if-not-present' &&
                    value !== 'always'
                  ) {
                    return
                  }

                  updateMachineSettings((settings) => ({
                    ...settings,
                    includeCharacterNameForTriggerMatches: value,
                  }))
                }}
              >
                <option value="never">Never</option>
                <option value="if-not-present">If not present</option>
                <option value="always">Always</option>
              </Form.Select>
            </Form.Group>
          </div>

          <div className="settings-subsection">
            <div className="settings-subsection-header">
              <h3>TTS voice characteristics</h3>
              <button
                className="settings-icon-button"
                onClick={() => {
                  send('speech.preview-requested', {
                    interrupt: true,
                    text: 'JENA speech preview',
                  })
                }}
                type="button"
              >
                <Volume2 aria-hidden="true" size={16} />
                <span>Preview</span>
              </button>
            </div>

            <Form.Group className="settings-field" controlId="tts-voice">
              <Form.Label>Voice</Form.Label>
              <Form.Select
                disabled={!isSupported || isLoading}
                value={machineSettings.tts.voiceURI ?? ''}
                onChange={(event) => {
                  const voiceURI = event.currentTarget.value || null
                  updateMachineSettings((settings) => ({
                    ...settings,
                    tts: {
                      ...settings.tts,
                      voiceURI,
                    },
                  }))
                }}
              >
                <option value="">
                  {isLoading ? 'Loading voices' : 'Browser default'}
                </option>
                {machineSettings.tts.voiceURI &&
                !voices.some(
                  (voice) => voice.voiceURI === machineSettings.tts.voiceURI,
                ) ? (
                  <option value={machineSettings.tts.voiceURI}>
                    Missing voice: {machineSettings.tts.voiceURI}
                  </option>
                ) : null}
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
              </Form.Select>
            </Form.Group>

            <TtsRange
              label="Rate"
              max={10}
              min={0.1}
              onChange={(rate) => {
                updateMachineSettings((settings) => ({
                  ...settings,
                  tts: {
                    ...settings.tts,
                    rate,
                  },
                }))
              }}
              step={0.1}
              value={machineSettings.tts.rate}
            />
            <TtsRange
              label="Pitch"
              max={2}
              min={0}
              onChange={(pitch) => {
                updateMachineSettings((settings) => ({
                  ...settings,
                  tts: {
                    ...settings.tts,
                    pitch,
                  },
                }))
              }}
              step={0.1}
              value={machineSettings.tts.pitch}
            />
            <TtsRange
              label="Volume"
              max={1}
              min={0}
              onChange={(volume) => {
                updateMachineSettings((settings) => ({
                  ...settings,
                  tts: {
                    ...settings.tts,
                    volume,
                  },
                }))
              }}
              step={0.05}
              value={machineSettings.tts.volume}
            />
          </div>
        </section>

        <section
          className={
            isUserSettingsAvailable
              ? 'settings-section'
              : 'settings-section settings-section-disabled'
          }
        >
          <fieldset disabled={!isUserSettingsAvailable}>
            <div className="settings-section-header">
              <h2>User settings</h2>
              {isSavingUserSettings ? (
                <span className="settings-save-status" role="status">
                  Saving
                </span>
              ) : null}
            </div>

            <Form.Group className="settings-field" controlId="sharing-name">
              <Form.Label>Sharing name</Form.Label>
              <Form.Control
                isInvalid={isDisplayNameInvalid}
                minLength={2}
                onChange={(event) => {
                  updateUserSettings({
                    displayName: event.currentTarget.value,
                  })
                }}
                placeholder={
                  isUserSettingsAvailable ? undefined : 'Log in with Discord'
                }
                type="text"
                value={displayName}
              />
              <Form.Text muted>
                Shown to other users when you share triggers.
              </Form.Text>
              <Form.Control.Feedback type="invalid">
                Sharing name must be at least 2 characters.
              </Form.Control.Feedback>
            </Form.Group>
          </fieldset>
          {!isUserSettingsAvailable ? (
            <div className="settings-disabled-note">
              Log in to edit user settings.
            </div>
          ) : null}
          {isUserSettingsAvailable && !isUserSettingsValid ? (
            <div className="settings-validation-note" role="status">
              Sharing name must be at least 2 characters.
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

function TtsRange({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step: number
  value: number
}) {
  return (
    <Form.Group className="settings-field settings-range-field">
      <Form.Label>{label}</Form.Label>
      <Form.Range
        max={max}
        min={min}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value))
        }}
        step={step}
        value={value}
      />
      <output>{value.toFixed(step < 0.1 ? 2 : 1)}</output>
    </Form.Group>
  )
}

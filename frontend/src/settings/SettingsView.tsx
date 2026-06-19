import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import Form from 'react-bootstrap/Form'
import { Volume2 } from 'lucide-react'
import { useSender } from '../shared/messageBrokerHooks'
import { BINARY, FourStateCheckbox } from '../shared/widgets/FourStateCheckbox'
import { useSettings } from './settingsContext'
import { useSpeechVoices } from './speechVoiceContext'
import {
  isValidUserSettings,
  type MachineSettings,
  type PipTextStyleSettings,
  type PipTimerStyleSettings,
} from './settingsTypes'
import './SettingsView.css'

const databaseName = 'jena'

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

          <PipAppearanceSettings
            machineSettings={machineSettings}
            updateMachineSettings={updateMachineSettings}
          />

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
            <div className="settings-field">
              <FourStateCheckbox
                id="use-broadcaster-speech-profile"
                label="Use broadcaster speech settings when available"
                mode={BINARY}
                onChange={(nextState) => {
                  updateMachineSettings((settings) => ({
                    ...settings,
                    tts: {
                      ...settings.tts,
                      useBroadcasterSpeechProfile: nextState === 'enabled',
                    },
                  }))
                }}
                state={
                  machineSettings.tts.useBroadcasterSpeechProfile
                    ? 'enabled'
                    : 'disabled'
                }
              />
              <div className="settings-field-note">
                Broadcast alerts can carry the sender's rate, pitch, volume, and
                best-effort voice choice.
              </div>
            </div>
          </div>

          <div className="settings-subsection">
            <h3>Cached information</h3>
            <div className="settings-danger-zone">
              <button
                className="settings-danger-button"
                onClick={() => {
                  void wipeCachedInformation()
                }}
                type="button"
              >
                Wipe out cached information
              </button>
              <div className="settings-danger-note">
                Removes local JENA browser storage on this machine.
              </div>
            </div>
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

function PipAppearanceSettings({
  machineSettings,
  updateMachineSettings,
}: {
  machineSettings: MachineSettings
  updateMachineSettings: (
    updater: (settings: MachineSettings) => MachineSettings,
  ) => void
}) {
  const timerSettings = machineSettings.pip.timers
  const alertSettings = machineSettings.pip.alerts

  function updateTimerSettings(update: Partial<PipTimerStyleSettings>) {
    updateMachineSettings((settings) => ({
      ...settings,
      pip: {
        ...settings.pip,
        timers: {
          ...settings.pip.timers,
          ...update,
        },
      },
    }))
  }

  function updateAlertSettings(update: Partial<PipTextStyleSettings>) {
    updateMachineSettings((settings) => ({
      ...settings,
      pip: {
        ...settings.pip,
        alerts: {
          ...settings.pip.alerts,
          ...update,
        },
      },
    }))
  }

  return (
    <div className="settings-subsection">
      <h3>PiP window</h3>
      <div className="settings-pip-layout">
        <div className="settings-pip-card">
          <h4>Timers</h4>
          <div className="settings-pip-fields">
            <PipColorField
              controlId="pip-timer-foreground"
              label="Foreground"
              onChange={(foregroundColor) => updateTimerSettings({ foregroundColor })}
              value={timerSettings.foregroundColor}
            />
            <PipColorField
              controlId="pip-timer-background"
              label="Background"
              onChange={(backgroundColor) => updateTimerSettings({ backgroundColor })}
              value={timerSettings.backgroundColor}
            />
            <PipColorField
              controlId="pip-timer-fill"
              label="Fill"
              onChange={(fillColor) => updateTimerSettings({ fillColor })}
              value={timerSettings.fillColor}
            />
            <PipFontSizeField
              controlId="pip-timer-font-size"
              max={80}
              min={8}
              onChange={(fontSizePx) => updateTimerSettings({ fontSizePx })}
              value={timerSettings.fontSizePx}
            />
          </div>
          <PipTimerPreview settings={timerSettings} />
        </div>

        <div className="settings-pip-card">
          <h4>Text alerts</h4>
          <div className="settings-pip-fields">
            <PipColorField
              controlId="pip-alert-foreground"
              label="Foreground"
              onChange={(foregroundColor) => updateAlertSettings({ foregroundColor })}
              value={alertSettings.foregroundColor}
            />
            <PipColorField
              controlId="pip-alert-background"
              label="Background"
              onChange={(backgroundColor) => updateAlertSettings({ backgroundColor })}
              value={alertSettings.backgroundColor}
            />
            <PipFontSizeField
              controlId="pip-alert-font-size"
              max={96}
              min={8}
              onChange={(fontSizePx) => updateAlertSettings({ fontSizePx })}
              value={alertSettings.fontSizePx}
            />
          </div>
          <PipAlertPreview settings={alertSettings} />
        </div>
      </div>
    </div>
  )
}

function PipColorField({
  controlId,
  label,
  onChange,
  value,
}: {
  controlId: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <Form.Group className="settings-pip-field" controlId={controlId}>
      <Form.Label>{label}</Form.Label>
      <Form.Control
        onChange={(event) => onChange(event.currentTarget.value)}
        type="color"
        value={value}
      />
    </Form.Group>
  )
}

function PipFontSizeField({
  controlId,
  max,
  min,
  onChange,
  value,
}: {
  controlId: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}) {
  return (
    <Form.Group className="settings-pip-field" controlId={controlId}>
      <Form.Label>Text size</Form.Label>
      <Form.Control
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        type="number"
        value={value}
      />
    </Form.Group>
  )
}

function PipTimerPreview({ settings }: { settings: PipTimerStyleSettings }) {
  const heightPx = getPipLineHeight(settings.fontSizePx)
  const containerStyle: CSSProperties = {
    backgroundColor: settings.backgroundColor,
    color: settings.foregroundColor,
    fontSize: `${settings.fontSizePx}px`,
    height: `${heightPx}px`,
    lineHeight: `${heightPx}px`,
  }
  const fillStyle: CSSProperties = {
    backgroundColor: settings.fillColor,
    width: '33.333%',
  }

  return (
    <div className="settings-pip-preview-wrap">
      <div className="settings-pip-timer-preview" style={containerStyle}>
        <div className="settings-pip-timer-preview-fill" style={fillStyle} />
        <span className="settings-pip-timer-preview-name">Example timer</span>
        <span className="settings-pip-timer-preview-duration">12s</span>
      </div>
    </div>
  )
}

function PipAlertPreview({ settings }: { settings: PipTextStyleSettings }) {
  const heightPx = getPipLineHeight(settings.fontSizePx)
  const style: CSSProperties = {
    backgroundColor: settings.backgroundColor,
    color: settings.foregroundColor,
    fontSize: `${settings.fontSizePx}px`,
    height: `${heightPx}px`,
    lineHeight: `${heightPx}px`,
  }

  return (
    <div className="settings-pip-preview-wrap">
      <div className="settings-pip-alert-preview" style={style}>
        Example text alert
      </div>
    </div>
  )
}

async function wipeCachedInformation() {
  const confirmed = confirm(
    'Wipe out all cached JENA information stored in this browser on this machine? The page will reload.',
  )

  if (!confirmed) {
    return
  }

  try {
    await deleteIndexedDB(databaseName)
  } finally {
    window.location.reload()
  }
}

function deleteIndexedDB(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed.'))
    request.onblocked = () => resolve()
  })
}

function getPipLineHeight(fontSizePx: number) {
  return fontSizePx + 2
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

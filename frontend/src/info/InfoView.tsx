import type { ReactNode } from 'react'
import { Globe, GlobeOff, Radio, RadioOff, X } from 'lucide-react'
import './InfoView.css'

export function InfoView() {
  return (
    <section className="info-view" aria-labelledby="info-title">
      <div className="info-hero">
        <div className="info-hero-copy">
          <p className="info-kicker">Jephine's Event Notification Apparatus</p>
          <h1 id="info-title">EverQuest triggers in your browser</h1>
          <p>
            To get started, click <strong>Open EverQuest Directory</strong> or{' '}
            <strong>Choose EverQuest Directory</strong>. JENA will ask for your
            EverQuest folder so it can read your local log files.
          </p>
          <p>
            After the directory is open, click <strong>Start Triggers</strong>.
            That opens a small window you can move over the EverQuest window to
            show timers and text alerts while you play.
          </p>
        </div>

        <div className="info-runtime-preview" aria-label="Example runtime window">
          <div className="info-runtime-titlebar">JENA runtime</div>
          <div className="info-runtime-alert">[Jephine] Click mask now</div>
          <div className="info-runtime-timer">
            <span>Mask gaze</span>
            <strong>00:08</strong>
          </div>
          <div className="info-runtime-alert info-runtime-alert-secondary">
            Adds incoming west
          </div>
        </div>
      </div>

      <div className="info-section">
        <h2>What JENA Adds</h2>
        <div className="info-feature-grid">
          <FeatureBlock
            title="Web-only"
            text="JENA runs in the browser. There is nothing to install on each machine beyond opening the app and choosing your EverQuest folder."
          />
          <FeatureBlock
            title="Publish triggers"
            text="Logged-in users can publish selected triggers so other players can subscribe to them without importing a new package every time the triggers change."
          />
          <FeatureBlock
            title="Subscribe to triggers"
            text="Anyone can use a subscription code. Subscribed triggers stay separate from your own triggers, update whenever the publisher changes their published set, and can be enabled per character or adopted into your personal set later."
          />
          <FeatureBlock
            title="Broadcast alerts"
            text="Broadcasting lets one matching log line help more than one client. This is useful when your focused screen, speaker, or whole group needs to know about an event."
          />
          <FeatureBlock
            title="Companion app"
            text={
              <>
                Clipboard trigger actions need the optional JENA Companion app.
                Install it once and leave it running in the Windows system tray.{' '}
                <a href="/downloads/jena-companion-setup.exe">
                  Download JENA Companion
                </a>
                .
              </>
            }
          />
        </div>
      </div>

      <div className="info-section">
        <h2>Example Trigger Controls</h2>
        <div className="info-two-column">
          <div className="info-mock-panel">
            <div className="info-mock-panel-header">
              <h3>My Triggers</h3>
            </div>
            <div className="info-mock-toolbar">
              <span className="info-mock-title">Tools</span>
              <span className="info-mock-button">Share published</span>
            </div>
            <div className="info-trigger-tree">
              <MockGroup name="Omens of War" />
              <MockTrigger
                broadcast="subscribers"
                enabled
                name="Mask gaze warning"
                published
              />
              <MockTrigger
                broadcast="boxes"
                enabled
                name="Raid emote callout"
                published={false}
              />
              <MockTrigger
                broadcast="private"
                enabled={false}
                name="Personal reminder"
                published={false}
              />
            </div>
          </div>

          <div className="info-control-notes">
            <ControlNote
              label="Character checkbox"
              text="Turns this trigger or group on for the selected character."
            />
            <ControlNote
              label={
                <InfoIconLabel
                  icon={<Globe aria-hidden="true" size={15} strokeWidth={2} />}
                  text="Publish"
                />
              }
              text="Logged-in users can publish triggers so people who subscribe to their published set receive updates."
            />
            <ControlNote
              label={
                <InfoIconLabel
                  icon={<RadioOff aria-hidden="true" size={15} strokeWidth={2} />}
                  text="Broadcast: Private"
                />
              }
              text="Only the client that saw the log line handles the alert."
            />
            <ControlNote
              label={
                <InfoIconLabel
                  icon={<MockBroadcastIcon state="boxes" />}
                  text="Broadcast: My boxes"
                />
              }
              text="Sends the alert to your own logged-in clients, useful when one PC has your speakers or main focus."
            />
            <ControlNote
              label={
                <InfoIconLabel
                  icon={<Radio aria-hidden="true" size={15} strokeWidth={2} />}
                  text="Broadcast: My subscribers"
                />
              }
              text="Sends the alert to your clients and to subscribers, useful for raid events where one player gets the tell but everyone should know."
            />
          </div>
        </div>
      </div>

      <div className="info-section">
        <h2>Example Subscription</h2>
        <div className="info-two-column">
          <div className="info-mock-panel">
            <div className="info-mock-panel-header">
              <h3>Subscriptions</h3>
            </div>
            <div className="info-subscription-card">
              <div className="info-subscription-header">
                <span className="info-checkbox info-checkbox-checked" />
                <strong>Jephine</strong>
                <span className="info-unsubscribe">
                  <X aria-hidden="true" size={15} />
                </span>
              </div>
              <div className="info-trigger-tree">
                <MockSubscribedGroup name="Tacvi" />
                <MockSubscribedTrigger
                  broadcast
                  state="default"
                  name="Overlord Mata Muram gaze"
                />
                <MockSubscribedTrigger
                  broadcast={false}
                  state="enabled"
                  name="Mask reuse timer"
                />
                <MockSubscribedTrigger
                  broadcast={false}
                  state="disabled"
                  name="Optional audio cue"
                />
              </div>
            </div>
          </div>

          <div className="info-control-notes">
            <ControlNote
              label="Enable by default"
              text="Controls what new triggers from this publisher do unless you override them."
            />
            <ControlNote
              label="Per-trigger state"
              text={
                <>
                  Each subscribed trigger can{' '}
                  <InlineState state="enabled" text="always enable" />,{' '}
                  <InlineState state="disabled" text="always disable" />, or{' '}
                  <InlineState
                    state="inherit"
                    text="follow the subscription default"
                  />
                  .
                </>
              }
            />
            <ControlNote
              label="Broadcast indicator"
              text="Shows whether a subscribed trigger can rebroadcast alerts to subscribers. It is informational only."
            />
            <ControlNote
              label="Unsubscribe"
              text="Removes the subscription and stops future updates from that publisher."
            />
            <ControlNote
              label="Adopt"
              text="Right-click a trigger or group to copy it into your own trigger tree."
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function FeatureBlock({
  title,
  text,
}: {
  title: string
  text: ReactNode
}) {
  return (
    <article className="info-feature-block">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  )
}

function ControlNote({
  label,
  text,
}: {
  label: ReactNode
  text: ReactNode
}) {
  return (
    <div className="info-control-note">
      <strong>{label}</strong>
      <span>{text}</span>
    </div>
  )
}

function InfoIconLabel({
  icon,
  text,
}: {
  icon: ReactNode
  text: string
}) {
  return (
    <span className="info-icon-label">
      <span className="info-icon-label-icon">{icon}</span>
      <span>{text}</span>
    </span>
  )
}

function InlineState({
  state,
  text,
}: {
  state: 'disabled' | 'enabled' | 'inherit'
  text: string
}) {
  return (
    <span className="info-inline-state">
      <span
        aria-hidden="true"
        className={getInlineStateCheckboxClassName(state)}
      />
      <span>{text}</span>
    </span>
  )
}

function MockGroup({ name }: { name: string }) {
  return (
    <div className="info-tree-row info-tree-group">
      <span className="info-tree-row-main">
        <span className="info-tree-indent" />
        <span className="info-tree-caret">v</span>
        <span className="info-checkbox info-checkbox-mixed" />
        <span className="info-tree-name">{name}</span>
      </span>
      <span className="info-tree-row-side">
        <MockPublishIcon state="mixed" />
        <MockBroadcastIcon state="mixed" />
      </span>
    </div>
  )
}

function MockSubscribedGroup({ name }: { name: string }) {
  return (
    <div className="info-tree-row info-tree-group">
      <span className="info-tree-row-main">
        <span className="info-tree-indent" />
        <span className="info-tree-caret">v</span>
        <span className="info-checkbox info-checkbox-mixed" />
        <span className="info-tree-name">{name}</span>
      </span>
    </div>
  )
}

function MockTrigger({
  broadcast,
  enabled,
  name,
  published,
}: {
  broadcast: 'private' | 'boxes' | 'subscribers'
  enabled: boolean
  name: string
  published: boolean
}) {
  return (
    <div className="info-tree-row info-tree-trigger">
      <span className="info-tree-row-main">
        <span className="info-tree-indent info-tree-indent-child" />
        <span
          className={
            enabled
              ? 'info-checkbox info-checkbox-checked'
              : 'info-checkbox info-checkbox-empty'
          }
        />
        <span className="info-tree-name info-tree-trigger-name">{name}</span>
      </span>
      <span className="info-tree-row-side">
        <MockPublishIcon state={published ? 'checked' : 'unchecked'} />
        <MockBroadcastIcon state={broadcast} />
      </span>
    </div>
  )
}

function MockSubscribedTrigger({
  broadcast,
  name,
  state,
}: {
  broadcast: boolean
  name: string
  state: 'default' | 'enabled' | 'disabled'
}) {
  return (
    <div className="info-tree-row info-tree-trigger">
      <span className="info-tree-row-main">
        <span className="info-tree-indent info-tree-indent-child" />
        <span className="info-tree-caret-placeholder" />
        <span
          className={getSubscriptionCheckboxClassName(state)}
          title={getSubscriptionStateLabel(state)}
        />
        <span className="info-tree-name info-tree-trigger-name">{name}</span>
      </span>
      <span className="info-tree-row-side">
        <MockBroadcastIndicator active={broadcast} />
      </span>
    </div>
  )
}

function MockPublishIcon({
  state,
}: {
  state: 'checked' | 'mixed' | 'unchecked'
}) {
  const Icon = state === 'unchecked' ? GlobeOff : Globe

  return (
    <span className="info-icon-toggle" data-state={state}>
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
    </span>
  )
}

function MockBroadcastIcon({
  state,
}: {
  state: 'private' | 'boxes' | 'mixed' | 'subscribers'
}) {
  const Icon = state === 'private' ? RadioOff : Radio

  return (
    <span className="info-icon-toggle info-broadcast-toggle" data-state={state}>
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {state === 'boxes' ? (
        <span className="info-icon-toggle-badge">
          <span className="info-broadcast-half-circle" />
        </span>
      ) : null}
      {state === 'mixed' ? (
        <span className="info-icon-toggle-badge">
          <span className="info-broadcast-mixed-mark" />
        </span>
      ) : null}
    </span>
  )
}

function MockBroadcastIndicator({ active }: { active: boolean }) {
  const Icon = active ? Radio : RadioOff

  return (
    <span
      className="info-broadcast-indicator"
      data-state={active ? 'subscribers' : 'private'}
    >
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
    </span>
  )
}

function getSubscriptionCheckboxClassName(
  state: 'default' | 'enabled' | 'disabled',
) {
  if (state === 'enabled') {
    return 'info-checkbox info-checkbox-checked'
  }

  if (state === 'disabled') {
    return 'info-checkbox info-checkbox-empty'
  }

  return 'info-checkbox info-checkbox-default'
}

function getInlineStateCheckboxClassName(
  state: 'disabled' | 'enabled' | 'inherit',
) {
  if (state === 'enabled') {
    return 'info-checkbox info-checkbox-checked'
  }

  if (state === 'disabled') {
    return 'info-checkbox info-checkbox-empty'
  }

  return 'info-checkbox info-checkbox-default'
}

function getSubscriptionStateLabel(state: 'default' | 'enabled' | 'disabled') {
  if (state === 'enabled') {
    return 'Always on'
  }

  if (state === 'disabled') {
    return 'Always off'
  }

  return 'Use default'
}

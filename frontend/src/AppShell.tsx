import { useState } from 'react'
import Button from 'react-bootstrap/Button'
import jenaBrandLockupUrl from './assets/jena-brand-lockup.png'
import { useAuth } from './auth/authContext'
import { StartupButton } from './runtime/StartupButton'
import { TriggersView } from './triggers/views/TriggersView'
import './AppShell.css'

type AppSection = 'triggers' | 'rolls' | 'search'

export function AppShell() {
  const [activeSection, setActiveSection] = useState<AppSection>('triggers')
  const { logOut, user } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div
          className="app-logo-slot"
          title="Jephine's Event Notification Apparatus"
        >
          <img
            alt="Jephine's Event Notification Apparatus"
            className="app-logo"
            height="64"
            src={jenaBrandLockupUrl}
            width="184"
          />
        </div>

        <nav className="app-nav" aria-label="Primary navigation">
          <button
            aria-current={activeSection === 'triggers' ? 'page' : undefined}
            className="app-nav-link app-nav-link-active"
            onClick={() => setActiveSection('triggers')}
            type="button"
          >
            Triggers
          </button>
          <button className="app-nav-link" disabled type="button">
            Rolls
          </button>
          <button className="app-nav-link" disabled type="button">
            Search
          </button>
        </nav>

        <div className="app-startup-slot">
          <StartupButton />
        </div>

        <div className="app-account-slot">
          <Button
            className="app-account-button"
            onClick={() => {
              void logOut()
            }}
            size="sm"
            variant="outline-light"
          >
            <span className="app-account-username">
              {user?.username ?? 'Discord'}
            </span>
            <span>log out</span>
          </Button>
        </div>
      </header>

      <main className="app-main">
        {activeSection === 'triggers' ? <TriggersView /> : null}
      </main>
    </div>
  )
}

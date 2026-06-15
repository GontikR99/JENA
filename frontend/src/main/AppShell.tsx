import { useState } from 'react'
import Button from 'react-bootstrap/Button'
import jenaBrandLockupUrl from '../assets/jena-brand-lockup.png'
import { useAuth } from './AuthContext'
import { StartupButton } from './StartupButton'
import { TriggersView } from './triggers/TriggersView'
import './AppShell.css'

type AppSection = 'triggers' | 'rolls' | 'search'

export function AppShell() {
  const [activeSection, setActiveSection] = useState<AppSection>('triggers')
  const { authToken, logIn, logOut } = useAuth()
  const loggedIn = authToken !== null

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
          <StartupButton onPipChange={() => undefined} />
        </div>

        <div className="app-account-slot">
          <Button
            className="app-login-button"
            onClick={loggedIn ? logOut : logIn}
            size="sm"
            variant={loggedIn ? 'outline-light' : 'success'}
          >
            {loggedIn ? 'log out' : 'log in'}
          </Button>
        </div>
      </header>

      <main className="app-main">
        {activeSection === 'triggers' ? <TriggersView /> : null}
      </main>
    </div>
  )
}

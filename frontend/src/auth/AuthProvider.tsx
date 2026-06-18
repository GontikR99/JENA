import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRpc } from '../shared/messageBrokerHooks'
import type { AuthenticatedUser, UserSettings } from '../shared/messages'
import { AuthContext, type AuthStatus } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const call = useRpc('auth-provider')
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<AuthenticatedUser | null>(null)
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)

  const refreshSession = useCallback(async () => {
    const session = await call('server.auth', 'getSession', {})

    if (session.status === 'authenticated') {
      setStatus('authenticated')
      setUser(session.user)
      setUserSettings(session.userSettings)
      return
    }

    setStatus('anonymous')
    setUser(null)
    setUserSettings(null)
  }, [call])

  useEffect(() => {
    let cancelled = false

    void call('server.auth', 'getSession', {})
      .then((session) => {
        if (cancelled) {
          return
        }

        if (session.status === 'authenticated') {
          setStatus('authenticated')
          setUser(session.user)
          setUserSettings(session.userSettings)
          return
        }

        setStatus('anonymous')
        setUser(null)
        setUserSettings(null)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        console.warn('[AuthProvider] session lookup failed', error)
        setStatus('anonymous')
        setUser(null)
        setUserSettings(null)
      })

    return () => {
      cancelled = true
    }
  }, [call])

  const logIn = useCallback(() => {
    window.location.assign('/_jena/auth/discord/login')
  }, [])

  const logOut = useCallback(async () => {
    try {
      await fetch('/_jena/auth/logout', {
        credentials: 'same-origin',
        method: 'POST',
      })
    } finally {
      window.location.assign('/')
    }
  }, [])

  const value = useMemo(
    () => ({
      isAuthenticated: status === 'authenticated',
      logIn,
      logOut,
      refreshSession,
      status,
      user,
      userSettings,
    }),
    [logIn, logOut, refreshSession, status, user, userSettings],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

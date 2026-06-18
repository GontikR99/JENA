import { createContext, useContext } from 'react'
import type { AuthenticatedUser, UserSettings } from '../shared/messages'

export type AuthStatus = 'anonymous' | 'authenticated' | 'checking'

export interface AuthContextValue {
  isAuthenticated: boolean
  logIn: () => void
  logOut: () => Promise<void>
  refreshSession: () => Promise<void>
  status: AuthStatus
  user: AuthenticatedUser | null
  userSettings: UserSettings | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return auth
}

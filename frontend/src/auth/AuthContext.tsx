import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

const dummyAuthToken = 'dummy-auth-token'

interface AuthContextValue {
  authToken: string | null
  logIn: () => void
  logOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authToken, setAuthToken] = useState<string | null>(null)

  const logIn = useCallback(() => {
    setAuthToken(dummyAuthToken)
  }, [])

  const logOut = useCallback(() => {
    setAuthToken(null)
  }, [])

  const value = useMemo(
    () => ({
      authToken,
      logIn,
      logOut,
    }),
    [authToken, logIn, logOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return auth
}

export function useAuthToken() {
  return useAuth().authToken
}

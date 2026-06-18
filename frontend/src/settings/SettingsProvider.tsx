import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/authContext'
import { useRpc } from '../shared/messageBrokerHooks'
import type { UserSettings } from '../shared/messages'
import { readMachineSettings, writeMachineSettings } from './machineSettingsStore'
import { SettingsContext } from './settingsContext'
import {
  defaultMachineSettings,
  isValidUserSettings,
  normalizeMachineSettings,
  type MachineSettings,
} from './settingsTypes'

const settingsDebounceMs = 5_000

export function SettingsProvider({ children }: { children: ReactNode }) {
  const call = useRpc('settings-provider')
  const { isAuthenticated, user, userSettings: sessionUserSettings } = useAuth()
  const [machineSettings, setMachineSettings] = useState(defaultMachineSettings)
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null)
  const [effectiveUserSettings, setEffectiveUserSettings] =
    useState<UserSettings | null>(null)
  const [isSavingUserSettings, setIsSavingUserSettings] = useState(false)
  const debounceTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null,
  )
  const machineDirtyRef = useRef(false)
  const machineHydratedRef = useRef(false)
  const machineSettingsRef = useRef(defaultMachineSettings)
  const userDirtyRef = useRef(false)
  const userSettingsRef = useRef<UserSettings | null>(null)

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current === null) {
      return
    }

    globalThis.clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = null
  }, [])

  const flushSettings = useCallback(async () => {
    clearDebounce()

    const pendingWrites: Array<Promise<void>> = []

    if (machineDirtyRef.current && machineHydratedRef.current) {
      const settingsToSave = machineSettingsRef.current
      pendingWrites.push(
        writeMachineSettings(settingsToSave)
          .then(() => {
            if (machineSettingsRef.current === settingsToSave) {
              machineDirtyRef.current = false
            }
          })
          .catch((error: unknown) => {
            console.warn('[SettingsProvider] unable to write machine settings', error)
          }),
      )
    }

    if (
      userDirtyRef.current &&
      isAuthenticated &&
      isValidUserSettings(userSettingsRef.current)
    ) {
      const settingsToSave = {
        displayName: userSettingsRef.current?.displayName.trim() ?? '',
      }

      setIsSavingUserSettings(true)
      pendingWrites.push(
        call('server.user-settings', 'updateSettings', {
          settings: settingsToSave,
        })
          .then((savedSettings) => {
            setEffectiveUserSettings(savedSettings)

            if (
              userSettingsRef.current?.displayName.trim() ===
              settingsToSave.displayName
            ) {
              userDirtyRef.current = false
              userSettingsRef.current = savedSettings
              setUserSettings(savedSettings)
            }
          })
          .catch((error: unknown) => {
            console.warn('[SettingsProvider] unable to write user settings', error)
          })
          .finally(() => {
            setIsSavingUserSettings(false)
          }),
      )
    }

    await Promise.all(pendingWrites)
  }, [call, clearDebounce, isAuthenticated])

  const scheduleFlush = useCallback(() => {
    clearDebounce()
    debounceTimerRef.current = globalThis.setTimeout(() => {
      void flushSettings()
    }, settingsDebounceMs)
  }, [clearDebounce, flushSettings])

  useEffect(() => {
    let cancelled = false

    void readMachineSettings()
      .then((savedSettings) => {
        if (cancelled) {
          return
        }
        if (machineDirtyRef.current) {
          return
        }

        const normalizedSettings = normalizeMachineSettings(savedSettings)
        machineSettingsRef.current = normalizedSettings
        setMachineSettings(normalizedSettings)
      })
      .catch((error: unknown) => {
        console.warn('[SettingsProvider] unable to read machine settings', error)
      })
      .finally(() => {
        if (!cancelled) {
          machineHydratedRef.current = true
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !sessionUserSettings) {
      userDirtyRef.current = false
      userSettingsRef.current = null
      queueMicrotask(() => {
        setUserSettings(null)
        setEffectiveUserSettings(null)
      })
      return
    }

    userDirtyRef.current = false
    userSettingsRef.current = sessionUserSettings
    queueMicrotask(() => {
      setUserSettings(sessionUserSettings)
      setEffectiveUserSettings(sessionUserSettings)
    })
  }, [isAuthenticated, sessionUserSettings])

  useEffect(() => {
    return () => {
      void flushSettings()
    }
  }, [flushSettings])

  const updateMachineSettings = useCallback(
    (updater: (settings: MachineSettings) => MachineSettings) => {
      setMachineSettings((currentSettings) => {
        const nextSettings = normalizeMachineSettings(updater(currentSettings))
        machineSettingsRef.current = nextSettings
        machineDirtyRef.current = true
        scheduleFlush()

        return nextSettings
      })
    },
    [scheduleFlush],
  )

  const updateUserSettings = useCallback(
    (settings: UserSettings) => {
      userSettingsRef.current = settings
      setUserSettings(settings)
      userDirtyRef.current = true
      scheduleFlush()
    },
    [scheduleFlush],
  )

  const displayName =
    effectiveUserSettings?.displayName ||
    user?.globalName ||
    user?.username ||
    user?.id ||
    'Discord'

  const value = useMemo(
    () => ({
      displayName,
      effectiveUserSettings,
      flushSettings,
      isSavingUserSettings,
      isUserSettingsAvailable: isAuthenticated,
      isUserSettingsValid: isValidUserSettings(userSettings),
      machineSettings,
      updateMachineSettings,
      updateUserSettings,
      userSettings,
    }),
    [
      displayName,
      effectiveUserSettings,
      flushSettings,
      isAuthenticated,
      isSavingUserSettings,
      machineSettings,
      updateMachineSettings,
      updateUserSettings,
      userSettings,
    ],
  )

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

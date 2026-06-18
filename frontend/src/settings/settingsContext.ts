import { createContext, useContext } from 'react'
import type { UserSettings } from '../shared/messages'
import type { MachineSettings } from './settingsTypes'

export interface SettingsContextValue {
  displayName: string
  effectiveUserSettings: UserSettings | null
  flushSettings: () => Promise<void>
  isSavingUserSettings: boolean
  isUserSettingsAvailable: boolean
  isUserSettingsValid: boolean
  machineSettings: MachineSettings
  updateMachineSettings: (
    updater: (settings: MachineSettings) => MachineSettings,
  ) => void
  updateUserSettings: (settings: UserSettings) => void
  userSettings: UserSettings | null
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings() {
  const settings = useContext(SettingsContext)
  if (!settings) {
    throw new Error('useSettings must be used within SettingsProvider')
  }

  return settings
}

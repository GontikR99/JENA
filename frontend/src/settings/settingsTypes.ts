import type { UserSettings } from '../shared/messages'

export type IncludeCharacterNameForTriggerMatches =
  | 'never'
  | 'if-not-present'
  | 'always'

export interface TtsSettings {
  pitch: number
  rate: number
  voiceURI: string | null
  volume: number
}

export interface MachineSettings {
  includeCharacterNameForTriggerMatches: IncludeCharacterNameForTriggerMatches
  tts: TtsSettings
}

export const defaultMachineSettings: MachineSettings = {
  includeCharacterNameForTriggerMatches: 'never',
  tts: {
    pitch: 1,
    rate: 1,
    voiceURI: null,
    volume: 1,
  },
}

export function normalizeMachineSettings(
  value: Partial<MachineSettings> | undefined,
): MachineSettings {
  return {
    ...defaultMachineSettings,
    ...value,
    tts: {
      ...defaultMachineSettings.tts,
      ...value?.tts,
    },
  }
}

export function isValidUserSettings(settings: UserSettings | null) {
  return (settings?.displayName.trim().length ?? 0) >= 2
}

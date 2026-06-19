import type { UserSettings } from '../shared/messages'

export type IncludeCharacterNameForTriggerMatches =
  | 'never'
  | 'if-not-present'
  | 'always'

export interface TtsSettings {
  pitch: number
  rate: number
  useBroadcasterSpeechProfile: boolean
  voiceURI: string | null
  volume: number
}

export interface PipTextStyleSettings {
  backgroundColor: string
  foregroundColor: string
  fontSizePx: number
}

export interface PipTimerStyleSettings extends PipTextStyleSettings {
  fillColor: string
}

export interface PipSettings {
  alerts: PipTextStyleSettings
  timers: PipTimerStyleSettings
}

export interface MachineSettings {
  headlessMode: boolean
  includeCharacterNameForTriggerMatches: IncludeCharacterNameForTriggerMatches
  pip: PipSettings
  tts: TtsSettings
}

export const defaultMachineSettings: MachineSettings = {
  headlessMode: false,
  includeCharacterNameForTriggerMatches: 'never',
  pip: {
    alerts: {
      backgroundColor: '#000000',
      fontSizePx: 20,
      foregroundColor: '#ffff00',
    },
    timers: {
      backgroundColor: '#570f00',
      fillColor: '#ff0000',
      fontSizePx: 16,
      foregroundColor: '#ffff00',
    },
  },
  tts: {
    pitch: 1,
    rate: 1,
    useBroadcasterSpeechProfile: true,
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
    headlessMode:
      typeof value?.headlessMode === 'boolean'
        ? value.headlessMode
        : defaultMachineSettings.headlessMode,
    pip: {
      ...defaultMachineSettings.pip,
      ...value?.pip,
      alerts: {
        ...defaultMachineSettings.pip.alerts,
        ...value?.pip?.alerts,
        backgroundColor: normalizeHexColor(
          value?.pip?.alerts?.backgroundColor,
          defaultMachineSettings.pip.alerts.backgroundColor,
        ),
        fontSizePx: normalizeFontSize(
          value?.pip?.alerts?.fontSizePx,
          defaultMachineSettings.pip.alerts.fontSizePx,
          8,
          96,
        ),
        foregroundColor: normalizeHexColor(
          value?.pip?.alerts?.foregroundColor,
          defaultMachineSettings.pip.alerts.foregroundColor,
        ),
      },
      timers: {
        ...defaultMachineSettings.pip.timers,
        ...value?.pip?.timers,
        backgroundColor: normalizeHexColor(
          value?.pip?.timers?.backgroundColor,
          defaultMachineSettings.pip.timers.backgroundColor,
        ),
        fillColor: normalizeHexColor(
          value?.pip?.timers?.fillColor,
          defaultMachineSettings.pip.timers.fillColor,
        ),
        fontSizePx: normalizeFontSize(
          value?.pip?.timers?.fontSizePx,
          defaultMachineSettings.pip.timers.fontSizePx,
          8,
          80,
        ),
        foregroundColor: normalizeHexColor(
          value?.pip?.timers?.foregroundColor,
          defaultMachineSettings.pip.timers.foregroundColor,
        ),
      },
    },
    tts: {
      ...defaultMachineSettings.tts,
      ...value?.tts,
    },
  }
}

export function isValidUserSettings(settings: UserSettings | null) {
  return (settings?.displayName.trim().length ?? 0) >= 2
}

function normalizeHexColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback
  }

  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback
}

function normalizeFontSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.round(value)))
}

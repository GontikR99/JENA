import { createContext, useContext } from 'react'

export interface SpeechVoiceOption {
  default: boolean
  lang: string
  localService: boolean
  name: string
  voiceURI: string
}

export interface SpeechVoiceContextValue {
  isLoading: boolean
  isSupported: boolean
  refreshVoices: () => void
  voiceByURI: Map<string, SpeechSynthesisVoice>
  voices: SpeechVoiceOption[]
}

export const SpeechVoiceContext =
  createContext<SpeechVoiceContextValue | null>(null)

export function useSpeechVoices() {
  const voices = useContext(SpeechVoiceContext)
  if (!voices) {
    throw new Error('useSpeechVoices must be used within SpeechVoiceProvider')
  }

  return voices
}

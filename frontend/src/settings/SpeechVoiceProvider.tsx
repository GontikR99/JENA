import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSpeechSynthesis } from '../shared/speechSynthesis'
import {
  SpeechVoiceContext,
  type SpeechVoiceOption,
} from './speechVoiceContext'

const voiceLoadGraceMs = 1_000

export function SpeechVoiceProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(() => !!getSpeechSynthesis())
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const synthesis = getSpeechSynthesis()
  const isSupported = !!synthesis

  const refreshVoices = useCallback(() => {
    const nextVoices = getSpeechSynthesis()?.getVoices() ?? []

    setVoices(nextVoices)
    if (nextVoices.length > 0) {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!synthesis) {
      return
    }

    queueMicrotask(refreshVoices)

    const timeoutId = globalThis.setTimeout(() => {
      setIsLoading(false)
    }, voiceLoadGraceMs)

    synthesis.addEventListener('voiceschanged', refreshVoices)

    return () => {
      globalThis.clearTimeout(timeoutId)
      synthesis.removeEventListener('voiceschanged', refreshVoices)
    }
  }, [refreshVoices, synthesis])

  const value = useMemo(() => {
    const voiceByURI = new Map<string, SpeechSynthesisVoice>()
    voices.forEach((voice) => {
      if (voice.voiceURI) {
        voiceByURI.set(voice.voiceURI, voice)
      }
    })

    return {
      isLoading,
      isSupported,
      refreshVoices,
      voiceByURI,
      voices: voices.map(
        (voice): SpeechVoiceOption => ({
          default: voice.default,
          lang: voice.lang,
          localService: voice.localService,
          name: voice.name,
          voiceURI: voice.voiceURI,
        }),
      ),
    }
  }, [isLoading, isSupported, refreshVoices, voices])

  return (
    <SpeechVoiceContext.Provider value={value}>
      {children}
    </SpeechVoiceContext.Provider>
  )
}

import { useCallback, useEffect, useRef } from 'react'
import type {
  TriggerSpeechPreviewRequestedMessage,
  TriggerSpeechProfile,
} from '../../shared/messages'
import { useListen } from '../../shared/messageBrokerHooks'
import {
  createSpeechUtterance,
  getSpeechSynthesis,
} from '../../shared/speechSynthesis'
import { useTriggerRuntime } from '../../runtime/TriggerRuntime'
import { useSettings } from '../../settings/settingsContext'
import { useSpeechVoices } from '../../settings/speechVoiceContext'
import {
  useOnTimerAction,
  useOnTriggerMatch,
  useOnTriggerStop,
} from './useTriggerAlerts'

interface SpeechJob {
  interrupt: boolean
  requireRunning: boolean
  speechProfile?: TriggerSpeechProfile
  text: string
}

export function TriggerSpeechService() {
  const { areTriggersRunning } = useTriggerRuntime()
  const { machineSettings } = useSettings()
  const { voiceByURI } = useSpeechVoices()
  const areTriggerActionsActive =
    areTriggersRunning || machineSettings.headlessMode
  const areTriggerActionsActiveRef = useRef(areTriggerActionsActive)
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const generationRef = useRef(0)
  const queueRef = useRef<SpeechJob[]>([])
  const warnedUnsupportedRef = useRef(false)

  const warnUnsupported = useCallback(() => {
    if (warnedUnsupportedRef.current) {
      return
    }

    warnedUnsupportedRef.current = true
    console.warn('[TriggerSpeechService] browser speech synthesis is unavailable')
  }, [])

  const cancelSpeech = useCallback(() => {
    generationRef.current += 1
    queueRef.current = []
    currentUtteranceRef.current = null
    getSpeechSynthesis()?.cancel()
  }, [])

  const speakNext = useCallback(function speakNext() {
    if (currentUtteranceRef.current) {
      return
    }

    const nextJob = queueRef.current.shift()
    if (!nextJob) {
      return
    }

    if (nextJob.requireRunning && !areTriggerActionsActiveRef.current) {
      return
    }

    const synthesis = getSpeechSynthesis()
    const utterance = createSpeechUtterance(nextJob.text)
    if (!synthesis || !utterance) {
      warnUnsupported()
      queueRef.current = []
      return
    }

    const speechSettings = getEffectiveSpeechSettings(
      nextJob.speechProfile,
      machineSettings.tts,
      voiceByURI,
    )

    utterance.pitch = speechSettings.pitch
    utterance.rate = speechSettings.rate
    utterance.volume = speechSettings.volume
    utterance.voice = speechSettings.voice

    const generation = generationRef.current

    utterance.onend = () => {
      if (generation !== generationRef.current) {
        return
      }

      currentUtteranceRef.current = null
      speakNext()
    }
    utterance.onerror = () => {
      if (generation !== generationRef.current) {
        return
      }

      currentUtteranceRef.current = null
      speakNext()
    }

    currentUtteranceRef.current = utterance
    synthesis.speak(utterance)
  }, [
    machineSettings.tts.pitch,
    machineSettings.tts.rate,
    machineSettings.tts.useBroadcasterSpeechProfile,
    machineSettings.tts.voiceURI,
    machineSettings.tts.volume,
    voiceByURI,
    warnUnsupported,
  ])

  const enqueueSpeech = useCallback(
    (
      job: Omit<SpeechJob, 'requireRunning'>,
      options: {
        requireRunning: boolean
      },
    ) => {
      if (options.requireRunning && !areTriggerActionsActiveRef.current) {
        return
      }

      if (job.interrupt) {
        cancelSpeech()
      }

      queueRef.current = [
        ...queueRef.current,
        {
          ...job,
          requireRunning: options.requireRunning,
        },
      ]
      speakNext()
    },
    [cancelSpeech, speakNext],
  )

  useEffect(() => {
    areTriggerActionsActiveRef.current = areTriggerActionsActive

    if (!areTriggerActionsActive) {
      cancelSpeech()
    }
  }, [areTriggerActionsActive, cancelSpeech])

  useEffect(() => {
    return () => {
      cancelSpeech()
    }
  }, [cancelSpeech])

  useOnTriggerMatch((event) => {
    const speechText = event.alert.speechText?.trim()
    if (!speechText) {
      return
    }

    enqueueSpeech(
      {
        interrupt: event.trigger.actions.speech.interrupt,
        speechProfile: event.alert.speechProfile,
        text: speechText,
      },
      {
        requireRunning: true,
      },
    )
  })

  useOnTimerAction((event) => {
    const speechText = event.alert.speechText?.trim()
    if (!speechText) {
      return
    }

    enqueueSpeech(
      {
        interrupt: event.alert.speechInterrupt ?? false,
        speechProfile: event.alert.speechProfile,
        text: speechText,
      },
      {
        requireRunning: true,
      },
    )
  })

  useOnTriggerStop(() => {
    cancelSpeech()
  })

  useListen('speech.preview-requested', (message) => {
    const payload = message.payload as TriggerSpeechPreviewRequestedMessage
    const speechText = payload.text.trim()

    if (!speechText) {
      return
    }

    enqueueSpeech(
      {
        interrupt: payload.interrupt ?? true,
        text: speechText,
      },
      {
        requireRunning: false,
      },
    )
  })

  return null
}

function getEffectiveSpeechSettings(
  speechProfile: TriggerSpeechProfile | undefined,
  localSettings: {
    pitch: number
    rate: number
    useBroadcasterSpeechProfile: boolean
    voiceURI: string | null
    volume: number
  },
  voiceByURI: Map<string, SpeechSynthesisVoice>,
) {
  if (!localSettings.useBroadcasterSpeechProfile || !speechProfile) {
    return {
      pitch: localSettings.pitch,
      rate: localSettings.rate,
      voice: localSettings.voiceURI
        ? voiceByURI.get(localSettings.voiceURI) ?? null
        : null,
      volume: localSettings.volume,
    }
  }

  return {
    pitch: speechProfile.pitch,
    rate: speechProfile.rate,
    voice: resolveProfileVoice(speechProfile, localSettings.voiceURI, voiceByURI),
    volume: speechProfile.volume,
  }
}

function resolveProfileVoice(
  speechProfile: TriggerSpeechProfile,
  localVoiceURI: string | null,
  voiceByURI: Map<string, SpeechSynthesisVoice>,
) {
  if (speechProfile.voiceURI) {
    const uriMatch = voiceByURI.get(speechProfile.voiceURI)
    if (uriMatch) {
      return uriMatch
    }
  }

  const voices = [...voiceByURI.values()]

  if (speechProfile.voiceName && speechProfile.voiceLang) {
    const nameAndLangMatch = voices.find((voice) => {
      return (
        voice.name === speechProfile.voiceName &&
        voice.lang === speechProfile.voiceLang
      )
    })
    if (nameAndLangMatch) {
      return nameAndLangMatch
    }
  }

  if (speechProfile.voiceName) {
    const nameMatch = voices.find((voice) => voice.name === speechProfile.voiceName)
    if (nameMatch) {
      return nameMatch
    }

    const normalizedVoiceName = speechProfile.voiceName.toLocaleLowerCase()
    const caseInsensitiveNameMatch = voices.find((voice) => {
      return voice.name.toLocaleLowerCase() === normalizedVoiceName
    })
    if (caseInsensitiveNameMatch) {
      return caseInsensitiveNameMatch
    }
  }

  if (speechProfile.voiceLang) {
    const langMatch = voices.find((voice) => voice.lang === speechProfile.voiceLang)
    if (langMatch) {
      return langMatch
    }
  }

  return localVoiceURI ? voiceByURI.get(localVoiceURI) ?? null : null
}

import { useCallback, useEffect, useRef } from 'react'
import type { TriggerSpeechPreviewRequestedMessage } from '../../shared/messages'
import { useListen } from '../../shared/messageBrokerHooks'
import {
  createSpeechUtterance,
  getSpeechSynthesis,
} from '../../shared/speechSynthesis'
import { useTriggerRuntime } from '../../runtime/TriggerRuntime'
import { useOnTriggerMatch } from './useTriggerAlerts'

interface SpeechJob {
  interrupt: boolean
  requireRunning: boolean
  text: string
}

export function TriggerSpeechService() {
  const { areTriggersRunning } = useTriggerRuntime()
  const areTriggersRunningRef = useRef(areTriggersRunning)
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

  const speakNext = useCallback(() => {
    if (currentUtteranceRef.current) {
      return
    }

    const nextJob = queueRef.current.shift()
    if (!nextJob) {
      return
    }

    if (nextJob.requireRunning && !areTriggersRunningRef.current) {
      return
    }

    const synthesis = getSpeechSynthesis()
    const utterance = createSpeechUtterance(nextJob.text)
    if (!synthesis || !utterance) {
      warnUnsupported()
      queueRef.current = []
      return
    }

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
  }, [warnUnsupported])

  const enqueueSpeech = useCallback(
    (
      job: Omit<SpeechJob, 'requireRunning'>,
      options: {
        requireRunning: boolean
      },
    ) => {
      if (options.requireRunning && !areTriggersRunningRef.current) {
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
    areTriggersRunningRef.current = areTriggersRunning

    if (!areTriggersRunning) {
      cancelSpeech()
    }
  }, [areTriggersRunning, cancelSpeech])

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
        text: speechText,
      },
      {
        requireRunning: true,
      },
    )
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

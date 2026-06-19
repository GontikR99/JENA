import { useCallback, useEffect, useRef } from 'react'
import type {
  RegexMatchFoundMessage,
  TriggerAlertMatchedMessage,
  TriggerTimerActionPayload,
  TriggerEarlyEnderMatchedMessage,
  TriggerStoreTriggersSeenMessage,
} from '../../shared/messages'
import { useListen, useRpc, useSender } from '../../shared/messageBrokerHooks'
import type { JenaTimerAction, JenaTrigger } from '../../shared/triggers'
import {
  compileAlertMatcher,
  createAlertMatchContext,
  createAlertPatternSessionId,
  substituteAlertTemplate,
  type AlertCompiledPattern,
  type AlertMatchContext,
} from './alertPatternCompiler'

interface AlertPatternBinding {
  compiledPattern: AlertCompiledPattern
  earlyEnderIndex?: number
  kind: 'trigger' | 'earlyEnder'
  trigger: JenaTrigger
}

export function AlertCoordinationService() {
  const call = useRpc('alert-coordination-service')
  const send = useSender('alert-coordination-service')
  const sessionIdRef = useRef(createAlertPatternSessionId())
  const indexedTriggerIdsRef = useRef(new Set<string>())
  const patternIndexRef = useRef(new Map<string, AlertPatternBinding[]>())
  const pendingPatternsRef = useRef(new Set<string>())
  const patternFlushTimerRef =
    useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const registeredPatternsRef = useRef(new Set<string>())
  const triggerCountersRef = useRef(new Map<string, number>())

  const flushPendingPatterns = useCallback(() => {
    patternFlushTimerRef.current = null
    const patterns = [...pendingPatternsRef.current]
    pendingPatternsRef.current.clear()

    if (patterns.length === 0) {
      return
    }

    void call('worker.matcher-service', 'add-patterns', {
      patterns: patterns.map((pattern) => ({ pattern })),
    }).catch((error: unknown) => {
      console.warn('[AlertCoordinationService] pattern registration failed', {
        error,
        patternCount: patterns.length,
      })
    })
  }, [call])

  const schedulePatternFlush = useCallback(() => {
    if (patternFlushTimerRef.current !== null) {
      return
    }

    patternFlushTimerRef.current = globalThis.setTimeout(
      flushPendingPatterns,
      0,
    )
  }, [flushPendingPatterns])

  const registerTrigger = useCallback(
    (trigger: JenaTrigger) => {
      if (indexedTriggerIdsRef.current.has(trigger.id)) {
        return
      }

      indexedTriggerIdsRef.current.add(trigger.id)
      const bindings = getTriggerPatternBindings(trigger, sessionIdRef.current)
      let hasNovelPattern = false

      bindings.forEach((binding) => {
        const pattern = binding.compiledPattern.pattern
        const existingBindings = patternIndexRef.current.get(pattern) ?? []

        patternIndexRef.current.set(pattern, [...existingBindings, binding])

        if (registeredPatternsRef.current.has(pattern)) {
          return
        }

        registeredPatternsRef.current.add(pattern)
        pendingPatternsRef.current.add(pattern)
        hasNovelPattern = true
      })

      if (hasNovelPattern) {
        schedulePatternFlush()
      }
    },
    [schedulePatternFlush],
  )

  const handleMatchFound = useCallback(
    (match: RegexMatchFoundMessage) => {
      const bindings = patternIndexRef.current.get(match.pattern)

      if (!bindings) {
        return
      }

      bindings.forEach((binding) => {
        const counter = getPotentialCounter(triggerCountersRef.current, binding)
        const context = createAlertMatchContext(binding.compiledPattern, match, {
          counter,
          repeated: counter,
          timerWarnTimeValue: binding.trigger.timer?.warningSeconds,
        })

        if (!context) {
          return
        }

        if (binding.kind === 'trigger') {
          triggerCountersRef.current.set(binding.trigger.id, counter)
          const payload = createTriggerAlertPayload(
            binding.trigger,
            match,
            context,
          )

          console.log('[AlertCoordinationService] trigger matched', payload)
          send('alert.trigger-matched', payload)
          return
        }

        const payload = createTimerEarlyEnderPayload(
          binding.trigger,
          match,
          context,
        )

        console.log('[AlertCoordinationService] timer early ender matched', payload)
        send('alert.timer-early-ended', payload)
      })
    },
    [send],
  )

  useListen('trigger-store.triggers-seen', (message) => {
    const payload = message.payload as TriggerStoreTriggersSeenMessage

    payload.triggers.forEach(registerTrigger)
  })
  useListen('matcher.match-found', (message) => {
    handleMatchFound(message.payload as RegexMatchFoundMessage)
  })

  useEffect(() => {
    return () => {
      if (patternFlushTimerRef.current !== null) {
        globalThis.clearTimeout(patternFlushTimerRef.current)
        patternFlushTimerRef.current = null
      }
    }
  }, [])

  return null
}

function getTriggerPatternBindings(
  trigger: JenaTrigger,
  sessionId: string,
): AlertPatternBinding[] {
  const bindings: AlertPatternBinding[] = [
    {
      compiledPattern: compileAlertMatcher(trigger.match, sessionId),
      kind: 'trigger',
      trigger,
    },
  ]

  trigger.timer?.earlyEnders.forEach((earlyEnder, earlyEnderIndex) => {
    if (earlyEnder.text.length === 0) {
      return
    }

    bindings.push({
      compiledPattern: compileAlertMatcher(earlyEnder, sessionId),
      earlyEnderIndex,
      kind: 'earlyEnder',
      trigger,
    })
  })

  return bindings
}

function createTriggerAlertPayload(
  trigger: JenaTrigger,
  match: RegexMatchFoundMessage,
  context: AlertMatchContext,
): TriggerAlertMatchedMessage {
  return withoutUndefinedValues({
    characterName: match.characterName,
    clipboardText: trigger.actions.clipboard.enabled
      ? substituteAlertTemplate(trigger.actions.clipboard.text, context)
      : undefined,
    displayText: trigger.actions.display.enabled
      ? substituteAlertTemplate(trigger.actions.display.text, context)
      : undefined,
    serverName: match.serverName,
    speechText: trigger.actions.speech.enabled
      ? substituteAlertTemplate(trigger.actions.speech.text, context)
      : undefined,
    text: match.text,
    timerEndedAction: trigger.timer?.endedAction
      ? createTimerActionPayload(trigger.timer.endedAction, context)
      : undefined,
    timerName: trigger.timer
      ? substituteAlertTemplate(trigger.timer.name, context)
      : undefined,
    timerWarningAction: trigger.timer?.warningAction
      ? createTimerActionPayload(trigger.timer.warningAction, context)
      : undefined,
    timestamp: match.timestamp,
    trigger,
  })
}

function createTimerActionPayload(
  action: JenaTimerAction,
  context: AlertMatchContext,
): TriggerTimerActionPayload {
  return withoutUndefinedValues({
    displayText: action.display.enabled
      ? substituteAlertTemplate(action.display.text, context)
      : undefined,
    speechInterrupt: action.speech.enabled ? action.speech.interrupt : undefined,
    speechText: action.speech.enabled
      ? substituteAlertTemplate(action.speech.text, context)
      : undefined,
  })
}

function createTimerEarlyEnderPayload(
  trigger: JenaTrigger,
  match: RegexMatchFoundMessage,
  context: AlertMatchContext,
): TriggerEarlyEnderMatchedMessage {
  return withoutUndefinedValues({
    characterName: match.characterName,
    serverName: match.serverName,
    text: match.text,
    timerName: trigger.timer
      ? substituteAlertTemplate(trigger.timer.name, context)
      : undefined,
    timestamp: match.timestamp,
    trigger,
  })
}

function getPotentialCounter(
  counters: Map<string, number>,
  binding: AlertPatternBinding,
) {
  if (binding.kind !== 'trigger') {
    return counters.get(binding.trigger.id) ?? 0
  }

  return (counters.get(binding.trigger.id) ?? 0) + 1
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

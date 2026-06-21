import { useCallback, useEffect, useMemo, useRef } from 'react'
import type {
  CharacterPresence,
  CharacterPresenceCharactersMessage,
  RegexMatchFoundMessage,
  TriggerSpeechProfile,
  TriggerAlertMatchedMessage,
  TriggerTimerActionPayload,
  TriggerEarlyEnderMatchedMessage,
} from '../../shared/messages'
import { useListen, useRpc, useSender } from '../../shared/messageBrokerHooks'
import { useSettings } from '../../settings/settingsContext'
import { useSpeechVoices } from '../../settings/speechVoiceContext'
import type {
  JenaCharacterServer,
  JenaTimerAction,
  JenaTrigger,
} from '../../shared/triggers'
import { useLocalCharacters } from '../../characters/LocalCharactersProvider'
import { useSubscribedTriggerManager } from '../model/SubscribedTriggerManager'
import { useTriggerManager } from '../model/UserTriggerManager'
import {
  compileAlertMatcher,
  createAlertMatchContext,
  createAlertPatternSessionId,
  substituteAlertTemplate,
  unknownZoneName,
  type AlertCompiledPattern,
  type AlertMatchContext,
} from './alertPatternCompiler'

const alertPatternNamespace = 'alerts'
const alertPatternReplacementDelayMs = 100

interface AlertPatternBinding {
  compiledPattern: AlertCompiledPattern
  earlyEnderIndex?: number
  kind: 'trigger' | 'earlyEnder'
  trigger: JenaTrigger
}

export function AlertCoordinationService() {
  const call = useRpc('alert-coordination-service')
  const send = useSender('alert-coordination-service')
  const localCharacters = useLocalCharacters()
  const { machineSettings } = useSettings()
  const { voiceByURI } = useSpeechVoices()
  const {
    getTriggerAlertRegistration: getUserTriggerAlertRegistration,
    triggers: userTriggers,
  } = useTriggerManager()
  const {
    getTriggerAlertRegistrations: getSubscribedTriggerAlertRegistrations,
    snapshots: subscriptionSnapshots,
  } = useSubscribedTriggerManager()
  const sessionIdRef = useRef(createAlertPatternSessionId())
  const patternIndexRef = useRef(new Map<string, AlertPatternBinding[]>())
  const patternFlushTimerRef =
    useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const lastAlertBindingSignatureRef = useRef('')
  const localCharactersRef = useRef<CharacterPresence[]>([])
  const triggerCountersRef = useRef(new Map<string, number>())
  const activeLocalCharacters = useMemo(
    () =>
      localCharacters
        .filter((character) => character.active)
        .map(characterPresenceToTriggerCharacter),
    [localCharacters],
  )
  const loadedTriggers = useMemo(() => {
    return dedupeTriggers([
      ...userTriggers.map((resolvedTrigger) => resolvedTrigger.trigger),
      ...subscriptionSnapshots.flatMap((snapshot) =>
        snapshot.triggers.map((resolvedTrigger) => resolvedTrigger.trigger),
      ),
    ])
  }, [subscriptionSnapshots, userTriggers])

  const replaceAlertPatterns = useCallback(() => {
    patternFlushTimerRef.current = null
    const bindings = getAlertPatternBindings({
      activeLocalCharacters,
      getSubscribedTriggerAlertRegistrations,
      getUserTriggerAlertRegistration,
      sessionId: sessionIdRef.current,
      triggers: loadedTriggers,
    })
    const signature = getAlertBindingSignature(bindings)

    if (signature === lastAlertBindingSignatureRef.current) {
      return
    }

    lastAlertBindingSignatureRef.current = signature
    patternIndexRef.current = getPatternIndex(bindings)

    void call('worker.matcher-service', 'replace-patterns', {
      namespace: alertPatternNamespace,
      patterns: getUniqueBindingPatterns(bindings).map((pattern) => ({ pattern })),
    }).catch((error: unknown) => {
      console.warn('[AlertCoordinationService] pattern registration failed', {
        error,
        patternCount: bindings.length,
      })
    })
  }, [
    activeLocalCharacters,
    call,
    getSubscribedTriggerAlertRegistrations,
    getUserTriggerAlertRegistration,
    loadedTriggers,
  ])

  const schedulePatternFlush = useCallback(() => {
    if (patternFlushTimerRef.current !== null) {
      return
    }

    patternFlushTimerRef.current = globalThis.setTimeout(
      replaceAlertPatterns,
      alertPatternReplacementDelayMs,
    )
  }, [replaceAlertPatterns])

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
          zoneName: getCharacterZoneName(localCharactersRef.current, match),
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
            createSpeechProfile(machineSettings.tts, voiceByURI),
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
    [machineSettings.tts, send, voiceByURI],
  )

  useListen('character-presence.characters', (message) => {
    const payload = message.payload as CharacterPresenceCharactersMessage
    localCharactersRef.current = payload.characters
  })
  useListen('matcher.match-found', (message) => {
    handleMatchFound(message.payload as RegexMatchFoundMessage)
  })

  useEffect(() => {
    schedulePatternFlush()
  }, [schedulePatternFlush])

  useEffect(() => {
    let cancelled = false

    void call('worker.character-presence', 'getCharacters', {})
      .then(({ characters }) => {
        if (!cancelled) {
          localCharactersRef.current = characters
        }
      })
      .catch((error: unknown) => {
        console.warn(
          '[AlertCoordinationService] character presence load failed',
          error,
        )
      })

    return () => {
      cancelled = true
    }
  }, [call])

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

function getAlertPatternBindings({
  activeLocalCharacters,
  getSubscribedTriggerAlertRegistrations,
  getUserTriggerAlertRegistration,
  sessionId,
  triggers,
}: {
  activeLocalCharacters: JenaCharacterServer[]
  getSubscribedTriggerAlertRegistrations: (
    triggerId: string,
    character: JenaCharacterServer,
  ) => Array<{ enabled: boolean }>
  getUserTriggerAlertRegistration: (
    triggerId: string,
    character: JenaCharacterServer,
  ) => { enabled: boolean } | null
  sessionId: string
  triggers: JenaTrigger[]
}) {
  const bindings: AlertPatternBinding[] = []

  triggers.forEach((trigger) => {
    if (
      activeLocalCharacters.some((character) =>
        isTriggerEnabledForCharacter({
          character,
          getSubscribedTriggerAlertRegistrations,
          getUserTriggerAlertRegistration,
          trigger,
        }),
      )
    ) {
      bindings.push({
        compiledPattern: compileAlertMatcher(trigger.match, sessionId),
        kind: 'trigger',
        trigger,
      })
    }

    bindings.push(...getTimerEarlyEnderPatternBindings(trigger, sessionId))
  })

  return bindings
}

function isTriggerEnabledForCharacter({
  character,
  getSubscribedTriggerAlertRegistrations,
  getUserTriggerAlertRegistration,
  trigger,
}: {
  character: JenaCharacterServer
  getSubscribedTriggerAlertRegistrations: (
    triggerId: string,
    character: JenaCharacterServer,
  ) => Array<{ enabled: boolean }>
  getUserTriggerAlertRegistration: (
    triggerId: string,
    character: JenaCharacterServer,
  ) => { enabled: boolean } | null
  trigger: JenaTrigger
}) {
  if (getUserTriggerAlertRegistration(trigger.id, character)?.enabled) {
    return true
  }

  return getSubscribedTriggerAlertRegistrations(trigger.id, character).some(
    (registration) => registration.enabled,
  )
}

function getTimerEarlyEnderPatternBindings(
  trigger: JenaTrigger,
  sessionId: string,
) {
  return (
    trigger.timer?.earlyEnders.flatMap((earlyEnder, earlyEnderIndex) => {
      if (earlyEnder.text.length === 0) {
        return []
      }

      return [
        {
          compiledPattern: compileAlertMatcher(earlyEnder, sessionId),
          earlyEnderIndex,
          kind: 'earlyEnder' as const,
          trigger,
        },
      ]
    }) ?? []
  )
}

function getPatternIndex(bindings: AlertPatternBinding[]) {
  const index = new Map<string, AlertPatternBinding[]>()

  bindings.forEach((binding) => {
    const pattern = binding.compiledPattern.pattern
    const existingBindings = index.get(pattern) ?? []

    index.set(pattern, [...existingBindings, binding])
  })

  return index
}

function getUniqueBindingPatterns(bindings: AlertPatternBinding[]) {
  return [...new Set(bindings.map((binding) => binding.compiledPattern.pattern))]
}

function getAlertBindingSignature(bindings: AlertPatternBinding[]) {
  return bindings
    .map((binding) =>
      [
        binding.kind,
        binding.trigger.id,
        binding.earlyEnderIndex ?? '',
        binding.compiledPattern.pattern,
      ].join('\0'),
    )
    .sort()
    .join('\x01')
}

function dedupeTriggers(triggers: JenaTrigger[]) {
  return [...new Map(triggers.map((trigger) => [trigger.id, trigger])).values()]
}

function characterPresenceToTriggerCharacter(
  character: CharacterPresence,
): JenaCharacterServer {
  return {
    characterName: character.characterName,
    serverName: character.serverName,
  }
}

function createTriggerAlertPayload(
  trigger: JenaTrigger,
  match: RegexMatchFoundMessage,
  context: AlertMatchContext,
  speechProfile: TriggerSpeechProfile,
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
    speechProfile,
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

function createSpeechProfile(
  tts: {
    pitch: number
    rate: number
    voiceURI: string | null
    volume: number
  },
  voiceByURI: Map<string, SpeechSynthesisVoice>,
): TriggerSpeechProfile {
  const voice = tts.voiceURI ? voiceByURI.get(tts.voiceURI) : null

  return withoutUndefinedValues({
    pitch: tts.pitch,
    rate: tts.rate,
    voiceLang: voice?.lang,
    voiceName: voice?.name,
    voiceURI: tts.voiceURI,
    volume: tts.volume,
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

function getCharacterZoneName(
  characters: CharacterPresence[],
  match: RegexMatchFoundMessage,
) {
  return (
    characters.find((character) => {
      return (
        character.characterName.localeCompare(match.characterName, undefined, {
          sensitivity: 'base',
        }) === 0 &&
        character.serverName.localeCompare(match.serverName, undefined, {
          sensitivity: 'base',
        }) === 0
      )
    })?.zone || unknownZoneName
  )
}

function withoutUndefinedValues<TValue extends Record<string, unknown>>(
  value: TValue,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TValue
}

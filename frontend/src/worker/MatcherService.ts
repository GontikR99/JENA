import { RE2Set, type RE2JS } from 're2js'
import type {
  RegexCaptures,
  RegexPatternRegistration,
} from '../shared/messages'
import { validateRegexPattern } from '../shared/regexValidation'
import { getDependency, type Deps } from './di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
} from './FileWatcher'
import { MessageBroker } from './MessageBroker'

const matcherCompileDelayMs = 25
const defaultPatternNamespace = 'default'

interface Re2PatternRegistration {
  compiledPattern: RE2JS
  engine: 're2'
  originalPattern: string
  setIndex: number
  translatedPattern: string
}

interface JavaScriptPatternRegistration {
  compiledPattern: RegExp
  engine: 'javascript'
  originalPattern: string
}

type ValidatedPatternRegistration =
  | JavaScriptPatternRegistration
  | Re2PatternRegistration

interface PatternSetState {
  patternsBySetIndex: Re2PatternRegistration[]
  set: RE2Set | null
}

export class MatcherService {
  private readonly broker: MessageBroker
  private fallbackRegistrations: JavaScriptPatternRegistration[] = []
  private needsCompile = false
  private readonly patternNamespaces = new Map<
    string,
    Map<string, ValidatedPatternRegistration>
  >()
  private readonly unregister: Array<() => void>
  private compilePromise: Promise<void> | null = null
  private compileTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private patternSetState: PatternSetState = {
    patternsBySetIndex: [],
    set: null,
  }

  constructor(deps: Deps) {
    this.broker = getDependency(deps, MessageBroker)

    const fileWatcher = getDependency(deps, FileWatcher)

    this.unregister = [
      this.broker.register('matcher-service', {
        'add-patterns': this.addPatterns,
        'replace-patterns': this.replacePatterns,
        flush: this.flush,
      }),
      fileWatcher.observe({
        onLogLine: this.handleLogLine,
      }),
    ]
  }

  dispose() {
    if (this.compileTimer) {
      globalThis.clearTimeout(this.compileTimer)
      this.compileTimer = null
    }

    this.unregister.forEach((unregister) => {
      unregister()
    })
  }

  private readonly addPatterns = (params: unknown) => {
    if (!isAddPatternsRequest(params)) {
      throw new Error('Invalid add-patterns request.')
    }

    const namespace = normalizePatternNamespace(params.namespace)
    const namespacePatterns = this.getNamespacePatterns(namespace)
    const novelRegistrations = getNovelRegistrations(
      namespacePatterns,
      params.patterns,
    )

    if (novelRegistrations.length === 0) {
      return {}
    }

    const validatedRegistrations = novelRegistrations.map((registration) =>
      validatePatternRegistration(registration),
    )

    validatedRegistrations.forEach((registration) => {
      namespacePatterns.set(registration.originalPattern, registration)
    })
    this.scheduleCompile()

    return {}
  }

  private readonly replacePatterns = (params: unknown) => {
    if (!isReplacePatternsRequest(params)) {
      throw new Error('Invalid replace-patterns request.')
    }

    const namespace = normalizePatternNamespace(params.namespace)
    const validatedRegistrations = getUniqueRegistrations(params.patterns).map(
      (registration) => validatePatternRegistration(registration),
    )
    const namespacePatterns = new Map(
      validatedRegistrations.map((registration) => [
        registration.originalPattern,
        registration,
      ]),
    )

    this.patternNamespaces.set(namespace, namespacePatterns)
    this.scheduleCompile()

    return {}
  }

  private readonly flush = async () => {
    await this.flushPendingPatterns()
    return {}
  }

  private readonly handleLogLine = (record: EverQuestLogLineRecord) => {
    this.matchRe2Patterns(record)
    this.matchJavaScriptPatterns(record)
  }

  private matchRe2Patterns(record: EverQuestLogLineRecord) {
    const { set, patternsBySetIndex } = this.patternSetState

    if (!set) {
      return
    }

    set.match(record.text).forEach((setIndex) => {
      const registration = patternsBySetIndex[setIndex]

      if (!registration) {
        return
      }

      const match = registration.compiledPattern.matchAll(record.text).next()
      if (!match.done) {
        this.sendMatch(record, registration.originalPattern, match.value)
      }
    })
  }

  private matchJavaScriptPatterns(record: EverQuestLogLineRecord) {
    this.fallbackRegistrations.forEach((registration) => {
      const regex = registration.compiledPattern

      regex.lastIndex = 0
      const match = regex.exec(record.text)

      if (match) {
        this.sendMatch(record, registration.originalPattern, match)
      }
    })
  }

  private sendMatch(
    record: EverQuestLogLineRecord,
    pattern: string,
    match: unknown[],
  ) {
    this.broker.send(
      'matcher-service',
      'client.matcher.match-found',
      {
        captures: getCaptures(match),
        characterName: record.characterName,
        pattern,
        serverName: record.serverName,
        text: record.text,
        timestamp: record.timestamp,
      },
    )
  }

  private scheduleCompile() {
    this.needsCompile = true

    if (this.compileTimer) {
      return
    }

    this.compileTimer = globalThis.setTimeout(() => {
      this.compileTimer = null
      void this.flushPendingPatterns().catch((error: unknown) => {
        console.warn('[MatcherService] unable to compile patterns', error)
      })
    }, matcherCompileDelayMs)
  }

  private async flushPendingPatterns(): Promise<void> {
    if (this.compileTimer) {
      globalThis.clearTimeout(this.compileTimer)
      this.compileTimer = null
    }

    if (this.compilePromise) {
      await this.compilePromise
      if (this.needsCompile) {
        await this.flushPendingPatterns()
      }
      return
    }

    if (!this.needsCompile) {
      return
    }

    this.needsCompile = false
    const nextRegistrations = this.getMergedRegistrations()
    const nextRe2Registrations = nextRegistrations.filter(isRe2PatternRegistration)
    const nextFallbackRegistrations = nextRegistrations.filter(
      isJavaScriptPatternRegistration,
    )
    const compileStartedAtMs = performance.now()

    this.compilePromise = Promise.resolve()
      .then(() => compilePatternSet(nextRe2Registrations))
      .then((nextPatternSetState) => {
        this.fallbackRegistrations = nextFallbackRegistrations
        this.patternSetState = nextPatternSetState
        const durationMs = Math.round(performance.now() - compileStartedAtMs)
        console.info(
          `[MatcherService] full RE2Set compile completed: namespaces=${this.patternNamespaces.size} totalPatterns=${nextRegistrations.length} re2Patterns=${nextRe2Registrations.length} fallbackPatterns=${nextFallbackRegistrations.length} durationMs=${durationMs}`,
        )
      })
      .finally(() => {
        this.compilePromise = null
      })

    await this.compilePromise

    if (this.needsCompile) {
      this.scheduleCompile()
    }
  }

  private getNamespacePatterns(namespace: string) {
    const existingPatterns = this.patternNamespaces.get(namespace)
    if (existingPatterns) {
      return existingPatterns
    }

    const patterns = new Map<string, ValidatedPatternRegistration>()
    this.patternNamespaces.set(namespace, patterns)
    return patterns
  }

  private getMergedRegistrations() {
    const registrations = new Map<string, ValidatedPatternRegistration>()

    this.patternNamespaces.forEach((namespacePatterns) => {
      namespacePatterns.forEach((registration) => {
        registrations.set(registration.originalPattern, registration)
      })
    })

    return [...registrations.values()]
  }
}

function compilePatternSet(
  registrations: Re2PatternRegistration[],
): PatternSetState {
  if (registrations.length === 0) {
    return {
      patternsBySetIndex: [],
      set: null,
    }
  }

  const set = new RE2Set()
  const patternsBySetIndex: Re2PatternRegistration[] = []

  registrations.forEach((registration) => {
    const setIndex = set.add(registration.translatedPattern)

    patternsBySetIndex[setIndex] = {
      ...registration,
      setIndex,
    }
  })

  set.compile()

  return {
    patternsBySetIndex,
    set,
  }
}

function getCaptures(match: unknown[]): RegexCaptures {
  return {
    named: getNamedCaptures(match),
    positional: match.slice(1).map(getCaptureValue),
  }
}

function getNamedCaptures(match: unknown[]) {
  const groups = getMatchGroups(match)

  if (!groups) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(groups).map(([name, value]) => [
      name,
      getCaptureValue(value),
    ]),
  )
}

function getMatchGroups(match: unknown[]) {
  const candidate = match as unknown[] & {
    groups?: unknown
  }

  if (!candidate.groups || typeof candidate.groups !== 'object') {
    return null
  }

  return candidate.groups as Record<string, unknown>
}

function getCaptureValue(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  return String(value)
}

function getNovelRegistrations(
  namespacePatterns: Map<string, ValidatedPatternRegistration>,
  registrations: RegexPatternRegistration[],
) {
  const seenInRequest = new Set<string>()
  const novelRegistrations: RegexPatternRegistration[] = []

  registrations.forEach((registration) => {
    if (
      namespacePatterns.has(registration.pattern) ||
      seenInRequest.has(registration.pattern)
    ) {
      return
    }

    seenInRequest.add(registration.pattern)
    novelRegistrations.push(registration)
  })

  return novelRegistrations
}

function getUniqueRegistrations(registrations: RegexPatternRegistration[]) {
  const uniqueRegistrations = new Map<string, RegexPatternRegistration>()

  registrations.forEach((registration) => {
    uniqueRegistrations.set(registration.pattern, registration)
  })

  return [...uniqueRegistrations.values()]
}

function validatePatternRegistration(
  registration: RegexPatternRegistration,
): ValidatedPatternRegistration {
  const validation = validateRegexPattern(registration.pattern)

  if (!validation.ok) {
    throw new Error(`Invalid regular expression: ${validation.error}`)
  }

  if (validation.engine === 'javascript') {
    return {
      compiledPattern: validation.compiledPattern,
      engine: 'javascript',
      originalPattern: registration.pattern,
    }
  }

  return {
    compiledPattern: validation.compiledPattern,
    engine: 're2',
    originalPattern: registration.pattern,
    setIndex: -1,
    translatedPattern: validation.translatedPattern,
  }
}

function isRe2PatternRegistration(
  registration: ValidatedPatternRegistration,
): registration is Re2PatternRegistration {
  return registration.engine === 're2'
}

function isJavaScriptPatternRegistration(
  registration: ValidatedPatternRegistration,
): registration is JavaScriptPatternRegistration {
  return registration.engine === 'javascript'
}

function isAddPatternsRequest(
  value: unknown,
): value is { namespace?: string; patterns: RegexPatternRegistration[] } {
  if (!value || typeof value !== 'object' || !('patterns' in value)) {
    return false
  }

  const candidate = value as Partial<{
    namespace: unknown
    patterns: unknown
  }>

  return (
    (candidate.namespace === undefined ||
      typeof candidate.namespace === 'string') &&
    Array.isArray(candidate.patterns) &&
    candidate.patterns.every(isRegexPatternRegistration)
  )
}

function isReplacePatternsRequest(
  value: unknown,
): value is { namespace: string; patterns: RegexPatternRegistration[] } {
  if (!value || typeof value !== 'object' || !('patterns' in value)) {
    return false
  }

  const candidate = value as Partial<{
    namespace: unknown
    patterns: unknown
  }>

  return (
    typeof candidate.namespace === 'string' &&
    candidate.namespace.trim().length > 0 &&
    Array.isArray(candidate.patterns) &&
    candidate.patterns.every(isRegexPatternRegistration)
  )
}

function isRegexPatternRegistration(
  value: unknown,
): value is RegexPatternRegistration {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RegexPatternRegistration>

  return (
    typeof candidate.pattern === 'string' &&
    candidate.pattern.length > 0
  )
}

function normalizePatternNamespace(namespace: string | undefined) {
  const normalized = namespace?.trim()
  return normalized && normalized.length > 0
    ? normalized
    : defaultPatternNamespace
}

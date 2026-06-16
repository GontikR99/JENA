import { RE2JS, RE2Set } from 're2js'
import type {
  RegexCaptures,
  RegexPatternRegistration,
} from '../shared/messages'
import { getDependency, type Deps } from './di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
} from './FileWatcher'
import { MessageBroker } from './MessageBroker'

const matcherCompileDelayMs = 25

interface ValidatedPatternRegistration {
  compiledPattern: RE2JS
  originalPattern: string
  setIndex: number
  translatedPattern: string
}

interface PatternSetState {
  patternsBySetIndex: ValidatedPatternRegistration[]
  set: RE2Set | null
}

export class MatcherService {
  private readonly broker: MessageBroker
  private registrations: ValidatedPatternRegistration[] = []
  private readonly compilingPatterns = new Set<string>()
  private readonly pendingPatterns = new Map<string, ValidatedPatternRegistration>()
  private readonly registeredPatterns = new Set<string>()
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

    const novelRegistrations = getNovelRegistrations(
      this.registeredPatterns,
      this.pendingPatterns,
      this.compilingPatterns,
      params.patterns,
    )

    if (novelRegistrations.length === 0) {
      return {}
    }

    const validatedRegistrations = novelRegistrations.map((registration) =>
      validatePatternRegistration(registration),
    )

    validatedRegistrations.forEach((registration) => {
      this.pendingPatterns.set(registration.originalPattern, registration)
    })
    this.scheduleCompile()

    return {}
  }

  private readonly flush = async () => {
    await this.flushPendingPatterns()
    return {}
  }

  private readonly handleLogLine = (record: EverQuestLogLineRecord) => {
    const { set, patternsBySetIndex } = this.patternSetState

    if (!set) {
      return
    }

    set.match(record.text).forEach((setIndex) => {
      const registration = patternsBySetIndex[setIndex]

      if (!registration) {
        return
      }

      for (const match of registration.compiledPattern.matchAll(record.text)) {
        this.broker.send(
          'matcher-service',
          'client.matcher.match-found',
          {
            captures: getCaptures(match),
            characterName: record.characterName,
            pattern: registration.originalPattern,
            serverName: record.serverName,
            text: record.text,
            timestamp: record.timestamp,
          },
        )
      }
    })
  }

  private scheduleCompile() {
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
      if (this.pendingPatterns.size > 0) {
        await this.flushPendingPatterns()
      }
      return
    }

    if (this.pendingPatterns.size === 0) {
      return
    }

    const pendingRegistrations = [...this.pendingPatterns.values()]
    this.pendingPatterns.clear()
    pendingRegistrations.forEach((registration) => {
      this.compilingPatterns.add(registration.originalPattern)
    })
    const nextRegistrations = [...this.registrations, ...pendingRegistrations]

    this.compilePromise = Promise.resolve()
      .then(() => compilePatternSet(nextRegistrations))
      .then((nextPatternSetState) => {
        this.registrations = nextRegistrations
        pendingRegistrations.forEach((registration) => {
          this.registeredPatterns.add(registration.originalPattern)
          this.compilingPatterns.delete(registration.originalPattern)
        })
        this.patternSetState = nextPatternSetState
      })
      .catch((error: unknown) => {
        pendingRegistrations.forEach((registration) => {
          this.compilingPatterns.delete(registration.originalPattern)
          this.pendingPatterns.set(registration.originalPattern, registration)
        })
        throw error
      })
      .finally(() => {
        this.compilePromise = null
      })

    await this.compilePromise

    if (this.pendingPatterns.size > 0) {
      this.scheduleCompile()
    }
  }
}

function compilePatternSet(
  registrations: ValidatedPatternRegistration[],
): PatternSetState {
  if (registrations.length === 0) {
    return {
      patternsBySetIndex: [],
      set: null,
    }
  }

  const set = new RE2Set()
  const patternsBySetIndex: ValidatedPatternRegistration[] = []

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
  registeredPatterns: Set<string>,
  pendingPatterns: Map<string, ValidatedPatternRegistration>,
  compilingPatterns: Set<string>,
  registrations: RegexPatternRegistration[],
) {
  const seenInRequest = new Set<string>()
  const novelRegistrations: RegexPatternRegistration[] = []

  registrations.forEach((registration) => {
    if (
      registeredPatterns.has(registration.pattern) ||
      pendingPatterns.has(registration.pattern) ||
      compilingPatterns.has(registration.pattern) ||
      seenInRequest.has(registration.pattern)
    ) {
      return
    }

    seenInRequest.add(registration.pattern)
    novelRegistrations.push(registration)
  })

  return novelRegistrations
}

function validatePatternRegistration(
  registration: RegexPatternRegistration,
): ValidatedPatternRegistration {
  const translatedPattern = RE2JS.translateRegExp(registration.pattern)

  return {
    compiledPattern: RE2JS.compile(translatedPattern),
    originalPattern: registration.pattern,
    setIndex: -1,
    translatedPattern,
  }
}

function isAddPatternsRequest(
  value: unknown,
): value is { patterns: RegexPatternRegistration[] } {
  if (!value || typeof value !== 'object' || !('patterns' in value)) {
    return false
  }

  const candidate = value as Partial<{
    patterns: unknown
  }>

  return (
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

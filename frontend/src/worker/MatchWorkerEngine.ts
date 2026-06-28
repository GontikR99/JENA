import { RE2Set, type RE2JS } from 're2js'
import type {
  RegexCaptures,
  RegexPatternRegistration,
} from '../shared/messages'
import { validateRegexPattern } from '../shared/regexValidation'
import type { EverQuestLogLineRecord } from './FileWatcher'

export interface MatchWorkerMatch {
  captures: RegexCaptures
  lineIndex: number
  pattern: string
}

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

export class MatchWorkerEngine {
  private fallbackRegistrations: JavaScriptPatternRegistration[] = []
  private readonly label: string
  private needsCompile = false
  private readonly patternNamespaces = new Map<
    string,
    Map<string, ValidatedPatternRegistration>
  >()
  private compilePromise: Promise<void> | null = null
  private patternSetState: PatternSetState = {
    patternsBySetIndex: [],
    set: null,
  }

  constructor(label: string) {
    this.label = label
  }

  addPatterns(namespace: string, patterns: RegexPatternRegistration[]) {
    const namespacePatterns = this.getNamespacePatterns(namespace)
    const novelRegistrations = getNovelRegistrations(
      namespacePatterns,
      patterns,
    )

    if (novelRegistrations.length === 0) {
      return
    }

    novelRegistrations
      .map((registration) => validatePatternRegistration(registration))
      .forEach((registration) => {
        namespacePatterns.set(registration.originalPattern, registration)
      })
    this.needsCompile = true
  }

  replacePatterns(namespace: string, patterns: RegexPatternRegistration[]) {
    const validatedRegistrations = getUniqueRegistrations(patterns).map(
      (registration) => validatePatternRegistration(registration),
    )
    const namespacePatterns = new Map(
      validatedRegistrations.map((registration) => [
        registration.originalPattern,
        registration,
      ]),
    )

    this.patternNamespaces.set(namespace, namespacePatterns)
    this.needsCompile = true
  }

  async flush(): Promise<void> {
    if (this.compilePromise) {
      await this.compilePromise
      if (this.needsCompile) {
        await this.flush()
      }
      return
    }

    if (!this.needsCompile) {
      return
    }

    this.needsCompile = false
    const nextRegistrations = this.getMergedRegistrations()
    const nextRe2Registrations = nextRegistrations.filter(
      isRe2PatternRegistration,
    )
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
          `[MatchWorkerEngine ${this.label}] full RE2Set compile completed: namespaces=${this.patternNamespaces.size} totalPatterns=${nextRegistrations.length} re2Patterns=${nextRe2Registrations.length} fallbackPatterns=${nextFallbackRegistrations.length} durationMs=${durationMs}`,
        )
      })
      .finally(() => {
        this.compilePromise = null
      })

    await this.compilePromise

    if (this.needsCompile) {
      await this.flush()
    }
  }

  async matchLines(
    records: EverQuestLogLineRecord[],
  ): Promise<MatchWorkerMatch[]> {
    await this.flush()

    return records.flatMap((record, lineIndex) => [
      ...this.matchRe2Patterns(record, lineIndex),
      ...this.matchJavaScriptPatterns(record, lineIndex),
    ])
  }

  private matchRe2Patterns(
    record: EverQuestLogLineRecord,
    lineIndex: number,
  ) {
    const { set, patternsBySetIndex } = this.patternSetState
    const matches: MatchWorkerMatch[] = []

    if (!set) {
      return matches
    }

    set.match(record.text).forEach((setIndex) => {
      const registration = patternsBySetIndex[setIndex]

      if (!registration) {
        return
      }

      const match = registration.compiledPattern.matchAll(record.text).next()
      if (!match.done) {
        matches.push({
          captures: getCaptures(match.value),
          lineIndex,
          pattern: registration.originalPattern,
        })
      }
    })

    return matches
  }

  private matchJavaScriptPatterns(
    record: EverQuestLogLineRecord,
    lineIndex: number,
  ) {
    const matches: MatchWorkerMatch[] = []

    this.fallbackRegistrations.forEach((registration) => {
      const regex = registration.compiledPattern

      regex.lastIndex = 0
      const match = regex.exec(record.text)

      if (match) {
        matches.push({
          captures: getCaptures(match),
          lineIndex,
          pattern: registration.originalPattern,
        })
      }
    })

    return matches
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

export function assertValidPatternRegistration(
  registration: RegexPatternRegistration,
) {
  const validation = validateRegexPattern(registration.pattern)

  if (!validation.ok) {
    throw new Error(`Invalid regular expression: ${validation.error}`)
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

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

interface CompiledPatternRegistration {
  id: string
  pattern: RE2JS
  regularExpression: string
  setIndex: number
}

interface PatternSetState {
  patternsBySetIndex: CompiledPatternRegistration[]
  set: RE2Set | null
}

export class MatcherService {
  private readonly broker: MessageBroker
  private readonly registrations: RegexPatternRegistration[] = []
  private readonly unregister: Array<() => void>
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
      }),
      fileWatcher.observe({
        onLogLine: this.handleLogLine,
      }),
    ]
  }

  dispose() {
    this.unregister.forEach((unregister) => {
      unregister()
    })
  }

  private readonly addPatterns = (params: unknown) => {
    if (!isAddPatternsRequest(params)) {
      throw new Error('Invalid add-patterns request.')
    }

    assertUniquePatternIds(this.registrations, params.patterns)

    const nextRegistrations = [...this.registrations, ...params.patterns]
    const nextPatternSetState = compilePatternSet(nextRegistrations)

    this.registrations.push(...params.patterns)
    this.patternSetState = nextPatternSetState

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

      for (const match of registration.pattern.matchAll(record.text)) {
        this.broker.send(
          'matcher-service',
          'client.matcher.match-found',
          {
            captures: getCaptures(match),
            characterName: record.characterName,
            patternId: registration.id,
            serverName: record.serverName,
            text: record.text,
            timestamp: record.timestamp,
          },
        )
      }
    })
  }
}

function compilePatternSet(
  registrations: RegexPatternRegistration[],
): PatternSetState {
  if (registrations.length === 0) {
    return {
      patternsBySetIndex: [],
      set: null,
    }
  }

  const set = new RE2Set()
  const patternsBySetIndex: CompiledPatternRegistration[] = []

  registrations.forEach((registration) => {
    const regularExpression = RE2JS.translateRegExp(
      registration.regularExpression,
    )
    const setIndex = set.add(regularExpression)

    patternsBySetIndex[setIndex] = {
      id: registration.id,
      pattern: RE2JS.compile(regularExpression),
      regularExpression,
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

function assertUniquePatternIds(
  existingPatterns: RegexPatternRegistration[],
  newPatterns: RegexPatternRegistration[],
) {
  const ids = new Set(existingPatterns.map((pattern) => pattern.id))

  newPatterns.forEach((pattern) => {
    if (ids.has(pattern.id)) {
      throw new Error(`Pattern ID ${pattern.id} is already registered.`)
    }

    ids.add(pattern.id)
  })
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
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.regularExpression === 'string'
  )
}

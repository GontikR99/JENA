import type { RegexPatternRegistration } from '../shared/messages'
import { getDependency, type Deps } from './di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
} from './FileWatcher'
import {
  assertValidPatternRegistration,
  type MatchWorkerMatch,
} from './MatchWorkerEngine'
import {
  MatchWorkerClientFactory,
  type MatchWorkerClientLike,
} from './MatchWorkerClient'
import { MessageBroker } from './MessageBroker'

const matcherUpdateDebounceMs = 25
const defaultPatternNamespace = 'default'

export class MatcherService {
  private readonly broker: MessageBroker
  private readonly dirtyNamespaces = new Set<string>()
  private isDisposed = false
  private readonly patternNamespaces = new Map<
    string,
    Map<string, RegexPatternRegistration>
  >()
  private readonly unregister: Array<() => void>
  private operationTail: Promise<void> = Promise.resolve()
  private updateTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  private readonly workers: MatchWorkerClientLike[]

  constructor(deps: Deps) {
    this.broker = getDependency(deps, MessageBroker)
    this.workers = getDependency(deps, MatchWorkerClientFactory).createClients()

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
    this.isDisposed = true

    if (this.updateTimer) {
      globalThis.clearTimeout(this.updateTimer)
      this.updateTimer = null
    }

    this.unregister.forEach((unregister) => {
      unregister()
    })
    this.workers.forEach((worker) => {
      worker.dispose()
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

    novelRegistrations.forEach(assertValidPatternRegistration)
    novelRegistrations.forEach((registration) => {
      namespacePatterns.set(registration.pattern, registration)
    })
    this.markNamespaceDirty(namespace)

    return {}
  }

  private readonly replacePatterns = (params: unknown) => {
    if (!isReplacePatternsRequest(params)) {
      throw new Error('Invalid replace-patterns request.')
    }

    const namespace = normalizePatternNamespace(params.namespace)
    const uniqueRegistrations = getUniqueRegistrations(params.patterns)

    uniqueRegistrations.forEach(assertValidPatternRegistration)
    this.patternNamespaces.set(
      namespace,
      new Map(
        uniqueRegistrations.map((registration) => [
          registration.pattern,
          registration,
        ]),
      ),
    )
    this.markNamespaceDirty(namespace)

    return {}
  }

  private readonly flush = async () => {
    await this.flushPendingPatternUpdates()
    return {}
  }

  private readonly handleLogLine = (
    characterName: string,
    serverName: string,
    records: EverQuestLogLineRecord[],
  ) => {
    void this.enqueueOperation(async () => {
      const matchesByWorker = await Promise.all(
        this.workers.map((worker) => worker.matchLines(records)),
      )
      const sortedMatches = matchesByWorker
        .flat()
        .sort((left, right) => left.lineIndex - right.lineIndex)

      sortedMatches.forEach((match) => {
        const record = records[match.lineIndex]

        if (!record) {
          return
        }

        this.sendMatch(characterName, serverName, record, match)
      })
    }).catch((error: unknown) => {
      console.error('[MatcherService] unable to match log lines', error)
    })
  }

  private sendMatch(
    characterName: string,
    serverName: string,
    record: EverQuestLogLineRecord,
    match: MatchWorkerMatch,
  ) {
    const timing =
      record.observedAtMs === undefined
        ? {}
        : {
            observedAtMs: record.observedAtMs,
            timestampMs: record.timestampMs,
          }

    this.broker.send(
      'matcher-service',
      'client.matcher.match-found',
      {
        captures: match.captures,
        characterName,
        pattern: match.pattern,
        serverName,
        text: record.text,
        timestamp: record.timestamp,
        ...timing,
      },
    )
  }

  private getNamespacePatterns(namespace: string) {
    const existingPatterns = this.patternNamespaces.get(namespace)
    if (existingPatterns) {
      return existingPatterns
    }

    const patterns = new Map<string, RegexPatternRegistration>()
    this.patternNamespaces.set(namespace, patterns)
    return patterns
  }

  private markNamespaceDirty(namespace: string) {
    this.dirtyNamespaces.add(namespace)

    if (this.updateTimer) {
      return
    }

    this.updateTimer = globalThis.setTimeout(() => {
      this.updateTimer = null
      void this.enqueueDistributionForDirtyNamespaces().catch(
        (error: unknown) => {
          console.error(
            '[MatcherService] unable to distribute pattern updates',
            error,
          )
        },
      )
    }, matcherUpdateDebounceMs)
  }

  private async flushPendingPatternUpdates() {
    if (this.updateTimer) {
      globalThis.clearTimeout(this.updateTimer)
      this.updateTimer = null
    }

    await this.enqueueDistributionForDirtyNamespaces()
  }

  private enqueueDistributionForDirtyNamespaces() {
    const dirtyNamespaces = [...this.dirtyNamespaces]
    this.dirtyNamespaces.clear()

    if (dirtyNamespaces.length === 0) {
      return this.operationTail
    }

    return this.enqueueOperation(async () => {
      await this.distributeNamespaces(dirtyNamespaces)
    })
  }

  private async distributeNamespaces(namespaces: string[]) {
    await Promise.all(
      namespaces.flatMap((namespace) => {
        const patternsByShard = this.getPatternsByShard(namespace)

        return this.workers.map((worker, shardIndex) => {
          return worker.replacePatterns(
            namespace,
            patternsByShard.get(shardIndex) ?? [],
          )
        })
      }),
    )

    await Promise.all(this.workers.map((worker) => worker.flush()))
  }

  private getPatternsByShard(namespace: string) {
    const patternsByShard = new Map<number, RegexPatternRegistration[]>()
    const namespacePatterns = this.patternNamespaces.get(namespace)

    namespacePatterns?.forEach((registration) => {
      const shardIndex = getPatternShardIndex(
        registration.pattern,
        this.workers.length,
      )
      const shardPatterns = patternsByShard.get(shardIndex) ?? []

      shardPatterns.push(registration)
      patternsByShard.set(shardIndex, shardPatterns)
    })

    return patternsByShard
  }

  private enqueueOperation(operation: () => Promise<void>) {
    if (this.isDisposed) {
      return Promise.reject(new Error('MatcherService has been disposed.'))
    }

    const run = this.operationTail.then(operation, operation)

    this.operationTail = run.then(
      () => undefined,
      () => undefined,
    )

    return run
  }
}

function getPatternShardIndex(pattern: string, shardCount: number) {
  if (shardCount <= 0) {
    throw new Error('MatcherService has no match workers.')
  }

  return getStableStringHash(pattern) % shardCount
}

function getStableStringHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function getNovelRegistrations(
  namespacePatterns: Map<string, RegexPatternRegistration>,
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

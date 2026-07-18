import { describe, expect, it } from 'vitest'
import { MessageBroker, MessageBus } from '../../shared/messageBroker'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import { install, installInstance, type Deps } from '../di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
  type FileWatcherObserver,
} from '../FileWatcher'
import { MatchWorkerEngine, type MatchWorkerMatch } from '../MatchWorkerEngine'
import {
  MatchWorkerClientFactory,
  type MatchWorkerClientLike,
} from '../MatchWorkerClient'
import { MatcherService } from '../MatcherService'
import { MessageBroker as WorkerMessageBroker } from '../MessageBroker'

describe('MatcherService', () => {
  it('sends match messages with positional and named captures', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: "(.+) says, '(.*)'",
        },
        {
          pattern: "(?<speaker>.+) says, '(?<quote>.*)'",
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Relax for a moment.'",
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {},
          positional: ['Arias', 'Relax for a moment.'],
        },
        characterName: 'Testcharacter',
        pattern: "(.+) says, '(.*)'",
        serverName: 'Testserver',
        text: "Arias says, 'Relax for a moment.'",
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
      {
        captures: {
          named: {
            quote: 'Relax for a moment.',
            speaker: 'Arias',
          },
          positional: ['Arias', 'Relax for a moment.'],
        },
        characterName: 'Testcharacter',
        pattern: "(?<speaker>.+) says, '(?<quote>.*)'",
        serverName: 'Testserver',
        text: "Arias says, 'Relax for a moment.'",
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('does not emit a match message for non-matching log lines', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'healed you for (\\d+) points',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Relax for a moment.'",
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([])
  })

  it('preserves worker-local observation and EverQuest timestamps', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [{ pattern: 'Arias' }],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      observedAtMs: 12_345.67,
      serverName: 'Testserver',
      text: 'Arias rolls.',
      timestamp: 'Fri Oct 24 13:33:11 2025',
      timestampMs: 1_761_329_591_000,
    })
    await flushAsyncWork()

    expect(receivedMatches).toHaveLength(1)
    expect(receivedMatches[0]).toMatchObject({
      observedAtMs: 12_345.67,
      timestampMs: 1_761_329_591_000,
    })
  })

  it('emits one match per pattern per log line', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'say|tell',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: 'This line has say and tell in it.',
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {},
          positional: [],
        },
        characterName: 'Testcharacter',
        pattern: 'say|tell',
        serverName: 'Testserver',
        text: 'This line has say and tell in it.',
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('emits matches from a chunk in log line order across worker shards', async () => {
    const { broker, fileWatcher } = createHarness({
      workerCount: 2,
    })
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'Arias',
        },
        {
          pattern: 'Brell',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emitChunk('Testcharacter', 'Testserver', [
      {
        text: 'Arias says hello.',
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
      {
        text: 'Brell says hello.',
        timestamp: 'Fri Oct 24 13:33:12 2025',
      },
    ])
    await flushAsyncWork()

    expect(receivedMatches.map((match) => match.text)).toEqual([
      'Arias says hello.',
      'Brell says hello.',
    ])
  })

  it('falls back to JavaScript regexes for patterns RE2JS cannot compile', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: "^(?:(?! say, '| says, ').)*(?<phrase>Touched tenderly\\.)",
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: 'Touched tenderly.',
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Touched tenderly.'",
      timestamp: 'Fri Oct 24 13:33:12 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {
            phrase: 'Touched tenderly.',
          },
          positional: ['Touched tenderly.'],
        },
        characterName: 'Testcharacter',
        pattern: "^(?:(?! say, '| says, ').)*(?<phrase>Touched tenderly\\.)",
        serverName: 'Testserver',
        text: 'Touched tenderly.',
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('falls back to JavaScript regexes for replaced namespace patterns RE2JS cannot compile', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
      namespace: 'alerts',
      patterns: [
        {
          pattern: "^(?:(?! say, '| says, ').)*(?<phrase>Touched tenderly\\.)",
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: 'Touched tenderly.',
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Touched tenderly.'",
      timestamp: 'Fri Oct 24 13:33:12 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {
            phrase: 'Touched tenderly.',
          },
          positional: ['Touched tenderly.'],
        },
        characterName: 'Testcharacter',
        pattern: "^(?:(?! say, '| says, ').)*(?<phrase>Touched tenderly\\.)",
        serverName: 'Testserver',
        text: 'Touched tenderly.',
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('rejects bad regular expressions without replacing existing patterns', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'Arias',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    await expect(
      broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
        patterns: [
          {
            pattern: '(',
          },
        ],
      }),
    ).rejects.toThrow()

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Relax for a moment.'",
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {},
          positional: [],
        },
        characterName: 'Testcharacter',
        pattern: 'Arias',
        serverName: 'Testserver',
        text: "Arias says, 'Relax for a moment.'",
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('ignores duplicate pattern registrations', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedMatches: RegexMatchFoundMessage[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedMatches.push(message.payload as RegexMatchFoundMessage)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'Arias',
        },
        {
          pattern: 'Arias',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})
    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      patterns: [
        {
          pattern: 'Arias',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: "Arias says, 'Relax for a moment.'",
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedMatches).toEqual([
      {
        captures: {
          named: {},
          positional: [],
        },
        characterName: 'Testcharacter',
        pattern: 'Arias',
        serverName: 'Testserver',
        text: "Arias says, 'Relax for a moment.'",
        timestamp: 'Fri Oct 24 13:33:11 2025',
      },
    ])
  })

  it('replaces only the requested pattern namespace', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedPatterns: string[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedPatterns.push((message.payload as RegexMatchFoundMessage).pattern)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'add-patterns', {
      namespace: 'stable',
      patterns: [
        {
          pattern: 'stable',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
      namespace: 'alerts',
      patterns: [
        {
          pattern: 'old alert',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})
    await broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
      namespace: 'alerts',
      patterns: [
        {
          pattern: 'new alert',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: 'stable old alert new alert',
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedPatterns).toEqual(['stable', 'new alert'])
  })

  it('keeps the previous namespace when replacement contains an invalid regex', async () => {
    const { broker, fileWatcher } = createHarness()
    const receivedPatterns: string[] = []

    broker.listen('client.matcher.match-found', (message) => {
      receivedPatterns.push((message.payload as RegexMatchFoundMessage).pattern)
    })

    await broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
      namespace: 'alerts',
      patterns: [
        {
          pattern: 'old alert',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    await expect(
      broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
        namespace: 'alerts',
        patterns: [
          {
            pattern: '(',
          },
        ],
      }),
    ).rejects.toThrow()

    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})
    fileWatcher.emit({
      characterName: 'Testcharacter',
      serverName: 'Testserver',
      text: 'old alert',
      timestamp: 'Fri Oct 24 13:33:11 2025',
    })
    await flushAsyncWork()

    expect(receivedPatterns).toEqual(['old alert'])
  })

  it('distributes namespace replacements to every match worker shard', async () => {
    const { broker, matchWorkerClientFactory } = createHarness({
      workerCount: 4,
    })

    await broker.call('test.matcher-service', 'matcher-service', 'replace-patterns', {
      namespace: 'alerts',
      patterns: [
        {
          pattern: 'alpha',
        },
        {
          pattern: 'beta',
        },
      ],
    })
    await broker.call('test.matcher-service', 'matcher-service', 'flush', {})

    expect(
      matchWorkerClientFactory.clients.map((client) => {
        return client.replacedNamespaces
      }),
    ).toEqual([['alerts'], ['alerts'], ['alerts'], ['alerts']])
  })
})

function createHarness(options: { workerCount?: number } = {}) {
  const deps: Deps = new Map()
  const bus = new MessageBus()
  const broker = new MessageBroker(bus)
  const fileWatcher = new FakeFileWatcher()
  const matchWorkerClientFactory = new FakeMatchWorkerClientFactory(
    options.workerCount ?? 1,
  )

  installInstance(
    deps,
    WorkerMessageBroker,
    broker as unknown as WorkerMessageBroker,
  )
  installInstance(deps, FileWatcher, fileWatcher as unknown as FileWatcher)
  installInstance(
    deps,
    MatchWorkerClientFactory,
    matchWorkerClientFactory as unknown as MatchWorkerClientFactory,
  )
  install(deps, MatcherService)

  return {
    broker,
    fileWatcher,
    matchWorkerClientFactory,
  }
}

function flushAsyncWork() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

class FakeFileWatcher {
  private observer: FileWatcherObserver | null = null

  observe(observer: FileWatcherObserver) {
    this.observer = observer

    return () => {
      this.observer = null
    }
  }

  emit(record: TestLogLineRecord & {
    characterName: string
    serverName: string
  }) {
    this.observer?.onLogLine(
      record.characterName,
      record.serverName,
      [createTestLogLineRecord(record)],
    )
  }

  emitChunk(
    characterName: string,
    serverName: string,
    records: TestLogLineRecord[],
  ) {
    this.observer?.onLogLine(
      characterName,
      serverName,
      records.map(createTestLogLineRecord),
    )
  }
}

type TestLogLineRecord = Pick<EverQuestLogLineRecord, 'text' | 'timestamp'> &
  Partial<
    Pick<EverQuestLogLineRecord, 'observedAtMs' | 'timestampMs'>
  >

function createTestLogLineRecord(
  record: TestLogLineRecord,
): EverQuestLogLineRecord {
  return {
    observedAtMs: record.observedAtMs as number,
    text: record.text,
    timestamp: record.timestamp,
    timestampMs: record.timestampMs as number | null,
  }
}

class FakeMatchWorkerClientFactory {
  readonly clients: FakeMatchWorkerClient[]

  constructor(workerCount: number) {
    this.clients = Array.from({ length: workerCount }, (_value, index) => {
      return new FakeMatchWorkerClient(index)
    })
  }

  createClients() {
    return this.clients
  }
}

class FakeMatchWorkerClient implements MatchWorkerClientLike {
  private readonly engine: MatchWorkerEngine
  readonly replacedNamespaces: string[] = []

  constructor(index: number) {
    this.engine = new MatchWorkerEngine(`fake-${index}`)
  }

  addPatterns(namespace: string, patterns: { pattern: string }[]) {
    this.engine.addPatterns(namespace, patterns)
    return Promise.resolve()
  }

  dispose() {}

  flush() {
    return this.engine.flush()
  }

  matchLines(records: EverQuestLogLineRecord[]): Promise<MatchWorkerMatch[]> {
    return this.engine.matchLines(records)
  }

  replacePatterns(namespace: string, patterns: { pattern: string }[]) {
    this.replacedNamespaces.push(namespace)
    this.engine.replacePatterns(namespace, patterns)
    return Promise.resolve()
  }
}

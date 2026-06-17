import { describe, expect, it } from 'vitest'
import { MessageBroker, MessageBus } from '../../shared/messageBroker'
import type { RegexMatchFoundMessage } from '../../shared/messages'
import { install, installInstance, type Deps } from '../di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
  type FileWatcherObserver,
} from '../FileWatcher'
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
})

function createHarness() {
  const deps: Deps = new Map()
  const bus = new MessageBus()
  const broker = new MessageBroker(bus)
  const fileWatcher = new FakeFileWatcher()

  installInstance(
    deps,
    WorkerMessageBroker,
    broker as unknown as WorkerMessageBroker,
  )
  installInstance(deps, FileWatcher, fileWatcher as unknown as FileWatcher)
  install(deps, MatcherService)

  return {
    broker,
    fileWatcher,
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

  emit(record: EverQuestLogLineRecord) {
    this.observer?.onLogLine(record)
  }
}

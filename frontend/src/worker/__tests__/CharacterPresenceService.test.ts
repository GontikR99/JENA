import { afterEach, describe, expect, it, vi } from 'vitest'
import { MessageBroker, MessageBus } from '../../shared/messageBroker'
import type {
  CharacterPresenceCharactersMessage,
  FileWatcherCharactersMessage,
} from '../../shared/messages'
import { install, installInstance, type Deps } from '../di'
import {
  FileWatcher,
  type EverQuestLogLineRecord,
  type FileWatcherObserver,
} from '../FileWatcher'
import { CharacterPresenceService } from '../CharacterPresenceService'
import { MatcherService } from '../MatcherService'
import { MessageBroker as WorkerMessageBroker } from '../MessageBroker'

describe('CharacterPresenceService', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('broadcasts activity from FileWatcher with an empty zone initially', async () => {
    const { broker, characterPresenceService } = createHarness()
    const receivedMessages: CharacterPresenceCharactersMessage[] = []
    const serverMessages: CharacterPresenceCharactersMessage[] = []

    broker.listen('client.character-presence.characters', (message) => {
      receivedMessages.push(
        message.payload as CharacterPresenceCharactersMessage,
      )
    })
    broker.listen('server.character-presence.characters', (message) => {
      serverMessages.push(message.payload as CharacterPresenceCharactersMessage)
    })

    broker.send('file-watcher', 'file-watcher.characters', {
      characters: [
        { active: true, characterName: 'Arias', serverName: 'bertox' },
      ],
    } satisfies FileWatcherCharactersMessage)
    await flushAsyncWork()

    expect(receivedMessages.at(-1)).toEqual({
      characters: [
        {
          active: true,
          characterName: 'Arias',
          serverName: 'bertox',
          zone: '',
        },
      ],
    })
    expect(serverMessages.at(-1)).toEqual(receivedMessages.at(-1))

    characterPresenceService.dispose()
  })

  it('records zone names from the matcher service zone-entered pattern', async () => {
    const { broker, characterPresenceService, fileWatcher } = createHarness()

    broker.send('file-watcher', 'file-watcher.characters', {
      characters: [
        { active: true, characterName: 'Arias', serverName: 'bertox' },
      ],
    } satisfies FileWatcherCharactersMessage)

    await waitFor(async () => {
      fileWatcher.emit({
        characterName: 'Arias',
        serverName: 'bertox',
        text: 'You have entered The Nexus.',
        timestamp: 'Sun Jun 14 10:00:00 2026',
      })

      const result = await broker.call<{
        characters: CharacterPresenceCharactersMessage['characters']
      }>('test.character-presence', 'character-presence', 'getCharacters', {})

      return result.characters.some((character) => {
        return (
          character.characterName === 'Arias' &&
          character.serverName === 'bertox' &&
          character.zone === 'The Nexus'
        )
      })
    })

    characterPresenceService.dispose()
  })

  it('ignores area notification lines when tracking zones', async () => {
    const { broker, characterPresenceService, fileWatcher } = createHarness()

    broker.send('file-watcher', 'file-watcher.characters', {
      characters: [
        { active: true, characterName: 'Arias', serverName: 'bertox' },
      ],
    } satisfies FileWatcherCharactersMessage)

    await waitFor(async () => {
      fileWatcher.emit({
        characterName: 'Arias',
        serverName: 'bertox',
        text: 'You have entered The Nexus.',
        timestamp: 'Sun Jun 14 10:00:00 2026',
      })

      const result = await broker.call<{
        characters: CharacterPresenceCharactersMessage['characters']
      }>('test.character-presence', 'character-presence', 'getCharacters', {})

      return result.characters.some((character) => {
        return (
          character.characterName === 'Arias' &&
          character.serverName === 'bertox' &&
          character.zone === 'The Nexus'
        )
      })
    })

    fileWatcher.emit({
      characterName: 'Arias',
      serverName: 'bertox',
      text: 'You have entered an area where Bind Affinity is allowed.',
      timestamp: 'Sun Jun 14 10:00:01 2026',
    })
    await flushAsyncWork()
    fileWatcher.emit({
      characterName: 'Arias',
      serverName: 'bertox',
      text: 'You have entered an area where levitation effects do not function.',
      timestamp: 'Sun Jun 14 10:00:02 2026',
    })
    await flushAsyncWork()

    const result = await broker.call<{
      characters: CharacterPresenceCharactersMessage['characters']
    }>('test.character-presence', 'character-presence', 'getCharacters', {})

    expect(result.characters).toContainEqual({
      active: true,
      characterName: 'Arias',
      serverName: 'bertox',
      zone: 'The Nexus',
    })

    characterPresenceService.dispose()
  })

  it('records zone names from own /who output using case-insensitive character names', async () => {
    const { broker, characterPresenceService, fileWatcher } = createHarness()

    broker.send('file-watcher', 'file-watcher.characters', {
      characters: [
        { active: true, characterName: 'suuloti', serverName: 'bertox' },
      ],
    } satisfies FileWatcherCharactersMessage)

    await waitFor(async () => {
      fileWatcher.emit({
        characterName: 'suuloti',
        serverName: 'bertox',
        text: '[ANONYMOUS] Jeffy ',
        timestamp: 'Sun Jun 14 10:00:00 2026',
      })
      fileWatcher.emit({
        characterName: 'suuloti',
        serverName: 'bertox',
        text: '[65 Archon (Cleric)] Suuloti (Dark Elf) <Adventure Dogs Il> ZONE: Yxtta, Pulpit of Exiles  (yxtta)  ',
        timestamp: 'Sun Jun 14 10:00:01 2026',
      })

      const result = await broker.call<{
        characters: CharacterPresenceCharactersMessage['characters']
      }>('test.character-presence', 'character-presence', 'getCharacters', {})

      return result.characters.some((character) => {
        return (
          character.characterName === 'suuloti' &&
          character.serverName === 'bertox' &&
          character.zone === 'Yxtta, Pulpit of Exiles'
        )
      })
    })

    characterPresenceService.dispose()
  })

  it('sends presence to the server every 30 seconds even without changes', async () => {
    vi.useFakeTimers()

    const { broker, characterPresenceService } = createHarness()
    const serverMessages: CharacterPresenceCharactersMessage[] = []

    broker.listen('server.character-presence.characters', (message) => {
      serverMessages.push(message.payload as CharacterPresenceCharactersMessage)
    })

    broker.send('file-watcher', 'file-watcher.characters', {
      characters: [
        { active: true, characterName: 'Arias', serverName: 'bertox' },
      ],
    } satisfies FileWatcherCharactersMessage)
    await flushMicrotasks()

    expect(serverMessages).toHaveLength(1)

    vi.advanceTimersByTime(30_000)
    await flushMicrotasks()

    expect(serverMessages).toHaveLength(2)
    expect(serverMessages[1]).toEqual(serverMessages[0])

    characterPresenceService.dispose()
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
  const characterPresenceService = install(deps, CharacterPresenceService)

  return {
    broker,
    characterPresenceService,
    fileWatcher,
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const startedAt = Date.now()

  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for predicate.')
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}

function flushAsyncWork() {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0)
  })
}

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve())
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

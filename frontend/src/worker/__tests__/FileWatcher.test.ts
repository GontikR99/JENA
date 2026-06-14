import { describe, expect, it } from 'vitest'
import type {
  FileSystemDirectoryHandleLike,
  FileSystemFileHandleLike,
  FileSystemHandleLike,
} from '../../shared/fileSystemAccess'
import { MessageBroker, MessageBus } from '../../shared/messageBroker'
import type {
  EverQuestCharacter,
  FileWatcherCharactersMessage,
} from '../../shared/messages'
import { installInstance, type Deps } from '../di'
import { FileWatcher } from '../FileWatcher'
import { MessageBroker as WorkerMessageBroker } from '../MessageBroker'

describe('FileWatcher', () => {
  it('answers getCharacters from the cached log directory scan', async () => {
    const { broker, fileWatcher, logsDirectory, setFileHandle } = createHarness([
      'eqlog_Arias_bertox.txt',
      'eqlog_Brell_seru.txt',
    ])

    await setFileHandle()

    const firstResult = await getCharacters(broker)
    const secondResult = await getCharacters(broker)

    logsDirectory.addFile('eqlog_Cazic_xegony.txt')

    const cachedResult = await getCharacters(broker)

    expect(firstResult.characters).toEqual([
      { characterName: 'Arias', serverName: 'bertox' },
      { characterName: 'Brell', serverName: 'seru' },
    ])
    expect(secondResult).toEqual(firstResult)
    expect(cachedResult).toEqual(firstResult)
    expect(logsDirectory.valuesCallCount).toBe(1)

    fileWatcher.dispose()
  })

  it('announces all characters when a watch scan detects a new character', async () => {
    const { broker, fileWatcher, logsDirectory, setFileHandle } = createHarness([
      'eqlog_Arias_bertox.txt',
    ])
    const receivedMessages: FileWatcherCharactersMessage[] = []

    broker.listen('client.file-watcher.characters', (message) => {
      receivedMessages.push(message.payload as FileWatcherCharactersMessage)
    })

    await setFileHandle()
    await broker.call('test.file-watcher', 'file-watcher', 'startWatch', {})
    await waitFor(() => receivedMessages.length === 1)

    logsDirectory.addFile('eqlog_Brell_seru.txt')
    await waitFor(() => receivedMessages.length === 2)

    fileWatcher.dispose()

    expect(receivedMessages).toEqual([
      {
        characters: [{ characterName: 'Arias', serverName: 'bertox' }],
      },
      {
        characters: [
          { characterName: 'Arias', serverName: 'bertox' },
          { characterName: 'Brell', serverName: 'seru' },
        ],
      },
    ])
  })
})

function createHarness(logFileNames: string[]) {
  const deps: Deps = new Map()
  const bus = new MessageBus()
  const broker = new MessageBroker(bus)
  const logsDirectory = new FakeDirectoryHandle('Logs')
  const everQuestDirectory = new FakeDirectoryHandle('EverQuest')

  logFileNames.forEach((fileName) => {
    logsDirectory.addFile(fileName)
  })
  everQuestDirectory.addDirectory(logsDirectory)

  installInstance(
    deps,
    WorkerMessageBroker,
    broker as unknown as WorkerMessageBroker,
  )

  const fileWatcher = new FileWatcher(deps)

  return {
    broker,
    fileWatcher,
    logsDirectory,
    setFileHandle: () =>
      broker.call('test.file-watcher', 'file-watcher', 'setFileHandle', {
        fileHandle: everQuestDirectory,
      }),
  }
}

async function getCharacters(broker: MessageBroker) {
  const result = await broker.call<{
    characters: EverQuestCharacter[]
  }>('test.file-watcher', 'file-watcher', 'getCharacters', {})

  return result
}

async function waitFor(predicate: () => boolean) {
  const startedAt = Date.now()

  while (!predicate()) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for predicate.')
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }
}

class FakeFileHandle implements FileSystemFileHandleLike {
  readonly kind = 'file'
  readonly name: string
  private readonly file: File

  constructor(name: string, text = '') {
    this.name = name
    this.file = new File([text], name)
  }

  async getFile() {
    return this.file
  }
}

class FakeDirectoryHandle implements FileSystemDirectoryHandleLike {
  readonly kind = 'directory'
  readonly name: string
  private readonly handles = new Map<string, FileSystemHandleLike>()
  valuesCallCount = 0

  constructor(name: string) {
    this.name = name
  }

  addDirectory(handle: FakeDirectoryHandle) {
    this.handles.set(handle.name, handle)
  }

  addFile(name: string, text = '') {
    this.handles.set(name, new FakeFileHandle(name, text))
  }

  async getDirectoryHandle(name: string) {
    const handle = this.handles.get(name)

    if (handle?.kind === 'directory') {
      return handle as FileSystemDirectoryHandleLike
    }

    throw new DOMException('Directory not found.', 'NotFoundError')
  }

  async getFileHandle(name: string) {
    const handle = this.handles.get(name)

    if (handle?.kind === 'file') {
      return handle as FileSystemFileHandleLike
    }

    throw new DOMException('File not found.', 'NotFoundError')
  }

  async *values() {
    this.valuesCallCount += 1

    for (const handle of this.handles.values()) {
      yield handle
    }
  }

  async queryPermission() {
    return 'granted' as PermissionState
  }

  async requestPermission() {
    return 'granted' as PermissionState
  }
}

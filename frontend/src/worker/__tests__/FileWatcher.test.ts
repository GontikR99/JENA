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
import {
  FileWatcher,
  type EverQuestLogLineRecord,
} from '../FileWatcher'
import { MessageBroker as WorkerMessageBroker } from '../MessageBroker'

describe('FileWatcher', () => {
  it('starts directory scanning when a file handle is set and answers getCharacters from cache', async () => {
    const {
      broker,
      fileWatcher,
      logsDirectory,
      setFileHandle,
      setNullFileHandle,
    } = createHarness([
      'eqlog_Arias_bertox.txt',
      'eqlog_Brell_seru.txt',
    ])

    await setFileHandle()
    await waitFor(async () => {
      return (await getCharacters(broker)).characters.length === 2
    })

    const firstResult = await getCharacters(broker)
    const secondResult = await getCharacters(broker)

    logsDirectory.addFile('eqlog_Cazic_xegony.txt')

    const cachedResult = await getCharacters(broker)

    expect(firstResult.characters).toEqual([
      { active: false, characterName: 'Arias', serverName: 'bertox' },
      { active: false, characterName: 'Brell', serverName: 'seru' },
    ])
    expect(secondResult).toEqual(firstResult)
    expect(cachedResult).toEqual(firstResult)
    expect(logsDirectory.valuesCallCount).toBeGreaterThanOrEqual(1)

    await setNullFileHandle()
    fileWatcher.dispose()
  })

  it('announces all characters when directory scanning detects a new character', async () => {
    const { broker, fileWatcher, logsDirectory, setFileHandle } = createHarness([
      'eqlog_Arias_bertox.txt',
    ])
    const receivedMessages: FileWatcherCharactersMessage[] = []

    broker.listen('file-watcher.characters', (message) => {
      receivedMessages.push(message.payload as FileWatcherCharactersMessage)
    })

    await setFileHandle()
    await waitFor(() => receivedMessages.length === 1)

    logsDirectory.addFile('eqlog_Brell_seru.txt')
    await waitFor(() => receivedMessages.length === 2)

    fileWatcher.dispose()

    expect(receivedMessages).toEqual([
      {
        characters: [
          { active: false, characterName: 'Arias', serverName: 'bertox' },
        ],
      },
      {
        characters: [
          { active: false, characterName: 'Arias', serverName: 'bertox' },
          { active: false, characterName: 'Brell', serverName: 'seru' },
        ],
      },
    ])
  })

  it('tails log files as soon as a file handle is set', async () => {
    const { broker, fileWatcher, logsDirectory, setFileHandle } = createHarness([
      'eqlog_Arias_bertox.txt',
    ])
    const receivedLines: EverQuestLogLineRecord[] = []
    const receivedMessages: FileWatcherCharactersMessage[] = []
    const ariasLog = logsDirectory.getFile('eqlog_Arias_bertox.txt')

    fileWatcher.observe({
      onLogLine: (record) => {
        receivedLines.push(record)
      },
    })
    broker.listen('file-watcher.characters', (message) => {
      receivedMessages.push(message.payload as FileWatcherCharactersMessage)
    })

    await setFileHandle()
    await waitFor(() => receivedMessages.length === 1)
    await wait(20)

    ariasLog.append("[Sun Jun 14 10:00:00 2026] Arias says, 'Ready.'\n")
    await waitFor(() => receivedLines.length === 1)
    await waitFor(() => {
      return receivedMessages.some((message) =>
        message.characters.some((character) => character.active),
      )
    })

    logsDirectory.addFile('eqlog_Brell_seru.txt')
    await waitFor(() => {
      return receivedMessages.some((message) =>
        message.characters.some(
          (character) => character.characterName === 'Brell',
        ),
      )
    })

    fileWatcher.dispose()

    expect(receivedLines).toEqual([
      {
        characterName: 'Arias',
        serverName: 'bertox',
        text: "Arias says, 'Ready.'",
        timestamp: 'Sun Jun 14 10:00:00 2026',
      },
    ])
    expect(receivedMessages.at(-1)).toEqual({
      characters: [
        { active: true, characterName: 'Arias', serverName: 'bertox' },
        { active: false, characterName: 'Brell', serverName: 'seru' },
      ],
    })
  })

  it('stops directory scanning and tailing when the file handle is cleared', async () => {
    const {
      broker,
      fileWatcher,
      logsDirectory,
      setFileHandle,
      setNullFileHandle,
    } = createHarness(['eqlog_Arias_bertox.txt'])
    const receivedLines: EverQuestLogLineRecord[] = []
    const ariasLog = logsDirectory.getFile('eqlog_Arias_bertox.txt')

    fileWatcher.observe({
      onLogLine: (record) => {
        receivedLines.push(record)
      },
    })

    await setFileHandle()
    await waitFor(() => logsDirectory.valuesCallCount >= 1)

    await setNullFileHandle()
    const valuesCallCountAfterClear = logsDirectory.valuesCallCount

    logsDirectory.addFile('eqlog_Brell_seru.txt')
    ariasLog.append("[Sun Jun 14 10:00:00 2026] Arias says, 'Ignored.'\n")
    await wait(150)

    const result = await getCharacters(broker)

    fileWatcher.dispose()

    expect(result.characters).toEqual([])
    expect(receivedLines).toEqual([])
    expect(logsDirectory.valuesCallCount).toBe(valuesCallCountAfterClear)
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
    setNullFileHandle: () =>
      broker.call('test.file-watcher', 'file-watcher', 'setFileHandle', {
        fileHandle: null,
      }),
  }
}

async function getCharacters(broker: MessageBroker) {
  const result = await broker.call<{
    characters: EverQuestCharacter[]
  }>('test.file-watcher', 'file-watcher', 'getCharacters', {})

  return result
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

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

class FakeFileHandle implements FileSystemFileHandleLike {
  readonly kind = 'file'
  readonly name: string
  private text: string

  constructor(name: string, text = '') {
    this.name = name
    this.text = text
  }

  append(text: string) {
    this.text += text
  }

  async getFile() {
    return new File([this.text], this.name)
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
    const handle = new FakeFileHandle(name, text)
    this.handles.set(name, handle)
    return handle
  }

  getFile(name: string) {
    const handle = this.handles.get(name)

    if (handle?.kind === 'file') {
      return handle as FakeFileHandle
    }

    throw new Error(`Fake file ${name} does not exist.`)
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

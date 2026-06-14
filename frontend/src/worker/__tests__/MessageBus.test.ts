import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerMessageBus } from '../MessageBus'
import type { BusMessage } from '../../shared/messages'

describe('WorkerMessageBus', () => {
  const originalSelf = globalThis.self

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: originalSelf,
    })
  })

  it('posts client-prefixed destinations to the main thread with the prefix stripped', () => {
    const postMessage = vi.fn()
    const addEventListener = vi.fn()
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        addEventListener,
        postMessage,
      },
    })

    const bus = new WorkerMessageBus(new Map())
    const message = createMessage('client.file-watcher.characters')

    bus.send(message)

    expect(postMessage).toHaveBeenCalledWith({
      ...message,
      destination: 'file-watcher.characters',
    })
  })

  it('posts server-prefixed destinations to the main thread unchanged', () => {
    const postMessage = vi.fn()
    const addEventListener = vi.fn()
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        addEventListener,
        postMessage,
      },
    })

    const bus = new WorkerMessageBus(new Map())
    const message = createMessage('server.character-presence.characters')

    bus.send(message)

    expect(postMessage).toHaveBeenCalledWith(message)
  })

  it('does not post worker-local destinations to the main thread', () => {
    const postMessage = vi.fn()
    const addEventListener = vi.fn()
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        addEventListener,
        postMessage,
      },
    })

    const bus = new WorkerMessageBus(new Map())

    bus.send(createMessage('matcher-service'))

    expect(postMessage).not.toHaveBeenCalled()
  })

  it('prefixes incoming main-thread sources before worker-local dispatch', () => {
    const postMessage = vi.fn()
    const messageHandlers: Array<(event: MessageEvent<unknown>) => void> = []
    const addEventListener = vi.fn(
      (_type: string, handler: (event: MessageEvent<unknown>) => void) => {
        messageHandlers.push(handler)
      },
    )
    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: {
        addEventListener,
        postMessage,
      },
    })

    const bus = new WorkerMessageBus(new Map())
    const receivedSources: Array<string | null> = []

    bus.listen('file-watcher', (message) => {
      receivedSources.push(message.source)
    })

    expect(messageHandlers).toHaveLength(1)

    messageHandlers[0]?.({
      data: {
        destination: 'file-watcher',
        id: 'message-1',
        payload: {},
        source: 'startup-button',
      },
    } as MessageEvent<unknown>)

    expect(receivedSources).toEqual(['client.startup-button'])
  })
})

function createMessage(destination: string): BusMessage {
  return {
    destination,
    id: 'message-1',
    payload: {},
    source: 'file-watcher',
  }
}

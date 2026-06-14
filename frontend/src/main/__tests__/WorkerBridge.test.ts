import { describe, expect, it } from 'vitest'
import type { BusMessage } from '../../shared/messages'
import {
  prepareMessageForWorker,
  prepareMessageFromWorker,
} from '../WorkerBridgeProtocol'

describe('WorkerBridge protocol helpers', () => {
  it('strips worker destinations before posting to the worker', () => {
    const message = createMessage({
      destination: 'worker.file-watcher',
      source: 'startup-button',
    })

    expect(prepareMessageForWorker(message)).toMatchObject({
      destination: 'file-watcher',
      source: 'startup-button',
    })
  })

  it('prefixes worker sources before dispatching onto the main bus', () => {
    const message = createMessage({
      destination: 'startup-button',
      source: 'file-watcher',
    })

    expect(prepareMessageFromWorker(message)).toMatchObject({
      destination: 'startup-button',
      source: 'worker.file-watcher',
    })
  })
})

function createMessage({
  destination,
  source,
}: {
  destination: string
  source: string | null
}): BusMessage {
  return {
    correlationId: 'rpc-1',
    destination,
    id: 'message-1',
    payload: {},
    source,
  }
}

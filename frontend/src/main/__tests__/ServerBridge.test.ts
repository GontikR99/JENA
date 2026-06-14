import { describe, expect, it } from 'vitest'
import {
  ExpiringMessageDeduper,
  getDefaultServerBridgeUrl,
  prepareInboundServerMessage,
  prepareOutboundServerMessage,
} from '../ServerBridgeProtocol'
import type { BusMessage } from '../../shared/messages'

describe('ServerBridge helpers', () => {
  it('uses the current host for the default websocket URL', () => {
    const url = getDefaultServerBridgeUrl({
      host: 'localhost:5173',
      protocol: 'https:',
    } as Location)

    expect(url).toBe('wss://localhost:5173/_jena/ws')
  })

  it('strips the server prefix from outbound destinations', () => {
    const message = createMessage({
      destination: 'server.trigger-store',
      source: 'triggers',
    })

    expect(prepareOutboundServerMessage(message)).toMatchObject({
      destination: 'trigger-store',
      source: 'triggers',
    })
  })

  it('adds the server prefix to inbound sources', () => {
    const message = createMessage({
      destination: 'triggers',
      source: 'trigger-store',
    })

    expect(prepareInboundServerMessage(message)).toMatchObject({
      destination: 'triggers',
      source: 'server.trigger-store',
    })
  })

  it('expires deduplication IDs after the configured window', () => {
    const deduper = new ExpiringMessageDeduper(10 * 60_000)

    expect(deduper.markSeen('message-1', 0)).toBe(true)
    expect(deduper.markSeen('message-1', 60_000)).toBe(false)
    expect(deduper.markSeen('message-1', 11 * 60_000)).toBe(true)
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
    destination,
    id: 'message-1',
    payload: {},
    source,
  }
}

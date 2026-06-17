import {
  addServerEndpointPrefix,
  isBusMessage,
  stripServerEndpointPrefix,
  type BusMessage,
} from '../../shared/messages'

export type ServerBridgeFrame =
  | {
      ack?: number
      envelope: BusMessage
      seq: number
      type: 'message'
    }
  | {
      ack: number
      type: 'ack'
    }
  | {
      ack?: number
      seq: number
      type: 'ping'
    }
  | {
      ack: number
      type: 'pong'
    }

export function getDefaultServerBridgeUrl(location: Location) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/_jena/ws`
}

export function prepareOutboundServerMessage(message: BusMessage): BusMessage {
  return {
    ...message,
    destination: stripServerEndpointPrefix(message.destination),
  }
}

export function prepareInboundServerMessage(message: BusMessage): BusMessage {
  return {
    ...message,
    source: message.source ? addServerEndpointPrefix(message.source) : null,
  }
}

export class ExpiringMessageDeduper {
  private readonly seenIds = new Map<string, number>()
  private readonly windowMs: number

  constructor(windowMs: number) {
    this.windowMs = windowMs
  }

  markSeen(id: string, now = Date.now()) {
    this.expire(now)

    const expiresAt = this.seenIds.get(id)
    if (expiresAt !== undefined && now < expiresAt) {
      return false
    }

    this.seenIds.set(id, now + this.windowMs)
    return true
  }

  expire(now = Date.now()) {
    this.seenIds.forEach((expiresAt, id) => {
      if (now >= expiresAt) {
        this.seenIds.delete(id)
      }
    })
  }
}

export function parseServerBridgeFrame(data: unknown): ServerBridgeFrame | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(data) as Partial<ServerBridgeFrame>

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    switch (parsed.type) {
      case 'message':
        return typeof parsed.seq === 'number' && isBusMessage(parsed.envelope)
          ? (parsed as ServerBridgeFrame)
          : null
      case 'ack':
        return typeof parsed.ack === 'number'
          ? (parsed as ServerBridgeFrame)
          : null
      case 'ping':
        return typeof parsed.seq === 'number'
          ? (parsed as ServerBridgeFrame)
          : null
      case 'pong':
        return typeof parsed.ack === 'number'
          ? (parsed as ServerBridgeFrame)
          : null
      default:
        return null
    }
  } catch {
    return null
  }
}

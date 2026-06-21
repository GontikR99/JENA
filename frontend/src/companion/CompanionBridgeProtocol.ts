import {
  addCompanionEndpointPrefix,
  isBusMessage,
  stripCompanionEndpointPrefix,
  type BusMessage,
} from '../shared/messages'

export type CompanionBridgeFrame =
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

export function getDefaultCompanionBridgeUrl() {
  return 'ws://127.0.0.1:9724/ws'
}

export function prepareOutboundCompanionMessage(message: BusMessage): BusMessage {
  return {
    ...message,
    destination: stripCompanionEndpointPrefix(message.destination),
  }
}

export function prepareInboundCompanionMessage(message: BusMessage): BusMessage {
  return {
    ...message,
    source: message.source ? addCompanionEndpointPrefix(message.source) : null,
  }
}

export function parseCompanionBridgeFrame(
  data: unknown,
): CompanionBridgeFrame | null {
  if (typeof data !== 'string') {
    return null
  }

  try {
    const parsed = JSON.parse(data) as Partial<CompanionBridgeFrame>

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    switch (parsed.type) {
      case 'message':
        return typeof parsed.seq === 'number' && isBusMessage(parsed.envelope)
          ? (parsed as CompanionBridgeFrame)
          : null
      case 'ack':
        return typeof parsed.ack === 'number'
          ? (parsed as CompanionBridgeFrame)
          : null
      case 'ping':
        return typeof parsed.seq === 'number'
          ? (parsed as CompanionBridgeFrame)
          : null
      case 'pong':
        return typeof parsed.ack === 'number'
          ? (parsed as CompanionBridgeFrame)
          : null
      default:
        return null
    }
  } catch {
    return null
  }
}

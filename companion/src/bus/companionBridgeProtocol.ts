import { isBusMessage, type BusMessage } from './messages'

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

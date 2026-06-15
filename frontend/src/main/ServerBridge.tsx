import { useCallback, useEffect, useRef } from 'react'
import type { MessageBroker } from '../shared/messageBroker'
import { useMessageBroker } from '../shared/messageBrokerHooks'
import { ServerEndpointPrefix, type BusMessage } from '../shared/messages'
import { useAuthToken } from './AuthContext'
import {
  ExpiringMessageDeduper,
  getDefaultServerBridgeUrl,
  parseServerBridgeFrame,
  prepareInboundServerMessage,
  prepareOutboundServerMessage,
  type ServerBridgeFrame,
} from './ServerBridgeProtocol'
import './ServerBridge.css'

export type ServerBridgeStatus = 'closed' | 'connecting' | 'open' | 'stale'

interface ServerBridgeProps {
  onStatusChange: (status: ServerBridgeStatus) => void
}

interface QueuedMessage {
  lastSeq: number
  message: BusMessage
}

const outboundQueueLimit = 1024
const keepaliveIntervalMs = 1_000
const staleConnectionMs = 10_000
const dedupWindowMs = 10 * 60_000
const reconnectDelayMs = 250
const maxReconnectDelayMs = 2_000

export function ServerBridge({ onStatusChange }: ServerBridgeProps) {
  const broker = useMessageBroker()
  const authToken = useAuthToken()
  const authTokenRef = useRef<string | null>(authToken)

  useEffect(() => {
    authTokenRef.current = authToken
  }, [authToken])

  const getAuthToken = useCallback(() => authTokenRef.current, [])

  useEffect(() => {
    const controller = new ServerBridgeController({
      broker,
      getAuthToken,
      onStatusChange,
      url: getDefaultServerBridgeUrl(window.location),
    })

    controller.start()

    return () => {
      controller.dispose()
    }
  }, [broker, getAuthToken, onStatusChange])

  return null
}

export function ServerConnectionGlass({
  status,
}: {
  status: ServerBridgeStatus
}) {
  if (status === 'open') {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="server-bridge-glass"
      role="status"
    >
      <div className="server-bridge-panel">
        <div className="server-bridge-title">Connecting to JENA server</div>
        <div className="server-bridge-status">
          Server bridge status: {status}
        </div>
      </div>
    </div>
  )
}

class ServerBridgeController {
  private readonly broker: MessageBroker
  private readonly deduper = new ExpiringMessageDeduper(dedupWindowMs)
  private readonly getAuthToken: () => string | null
  private readonly onStatusChange: (status: ServerBridgeStatus) => void
  private readonly queuedMessages: BusMessage[] = []
  private readonly unackedMessages = new Map<string, QueuedMessage>()
  private readonly url: string
  private keepaliveIntervalId: ReturnType<typeof globalThis.setInterval> | null =
    null
  private lastFrameReceivedAt = 0
  private nextReconnectDelayMs = reconnectDelayMs
  private nextSeq = 0
  private reconnectTimeoutId: ReturnType<typeof globalThis.setTimeout> | null =
    null
  private socket: WebSocket | null = null
  private staleCheckIntervalId: ReturnType<typeof globalThis.setInterval> | null =
    null
  private unregisterBusListener: (() => void) | null = null
  private disposed = false

  constructor({
    broker,
    getAuthToken,
    onStatusChange,
    url,
  }: {
    broker: MessageBroker
    getAuthToken: () => string | null
    onStatusChange: (status: ServerBridgeStatus) => void
    url: string
  }) {
    this.broker = broker
    this.getAuthToken = getAuthToken
    this.onStatusChange = onStatusChange
    this.url = url
  }

  start() {
    this.unregisterBusListener = this.broker.listen('server.*', (message) => {
      if (message.source?.startsWith(ServerEndpointPrefix)) {
        return
      }

      this.sendToServer(prepareOutboundServerMessage(message))
    })

    this.connect()
  }

  dispose() {
    this.disposed = true
    this.clearTimers()

    if (this.unregisterBusListener) {
      this.unregisterBusListener()
      this.unregisterBusListener = null
    }

    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  }

  private connect() {
    if (this.disposed) {
      return
    }

    this.setStatus('connecting')
    this.clearTimers()
    this.nextSeq = 0

    const socket = new WebSocket(this.url)
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      this.lastFrameReceivedAt = Date.now()
      this.nextReconnectDelayMs = reconnectDelayMs
      this.setStatus('open')
      this.startTimers()
      this.flushOutboundMessages()
    })

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      this.handleSocketMessage(event.data)
    })

    socket.addEventListener('close', () => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      this.socket = null
      this.clearTimers()
      this.setStatus('closed')
      this.scheduleReconnect()
    })

    socket.addEventListener('error', () => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      socket.close()
    })
  }

  private sendToServer(message: BusMessage) {
    const socket = this.socket

    if (this.unackedMessages.has(message.id)) {
      return
    }

    if (socket?.readyState === WebSocket.OPEN) {
      this.writeMessageFrame(message)
      return
    }

    if (this.queuedMessages.length >= outboundQueueLimit) {
      this.broker.replyWithError(
        message,
        new Error('The server bridge outbound queue is full.'),
      )
      return
    }

    this.queuedMessages.push(message)
  }

  private flushOutboundMessages() {
    const unackedMessages = [...this.unackedMessages.values()].map(
      ({ message }) => message,
    )

    unackedMessages.forEach((message) => {
      this.writeMessageFrame(message)
    })

    while (this.queuedMessages.length > 0) {
      const message = this.queuedMessages.shift()
      if (message) {
        this.writeMessageFrame(message)
      }
    }
  }

  private writeMessageFrame(message: BusMessage) {
    const seq = this.nextSequence()
    const authToken = this.getAuthToken() ?? undefined

    this.unackedMessages.set(message.id, {
      lastSeq: seq,
      message,
    })

    this.writeFrame({
      authToken,
      envelope: {
        ...message,
        authToken,
      },
      seq,
      type: 'message',
    })
  }

  private handleSocketMessage(data: unknown) {
    this.lastFrameReceivedAt = Date.now()

    const frame = parseServerBridgeFrame(data)
    if (!frame) {
      return
    }

    if ('ack' in frame && typeof frame.ack === 'number') {
      this.handleAck(frame.ack)
    }

    switch (frame.type) {
      case 'message':
        this.handleMessageFrame(frame)
        return
      case 'ping':
        this.writeFrame({
          ack: frame.seq,
          authToken: this.getAuthToken() ?? undefined,
          type: 'pong',
        })
        return
      case 'ack':
      case 'pong':
        return
    }
  }

  private handleMessageFrame(frame: Extract<ServerBridgeFrame, { type: 'message' }>) {
    this.writeFrame({
      ack: frame.seq,
      authToken: this.getAuthToken() ?? undefined,
      type: 'ack',
    })

    if (!this.deduper.markSeen(frame.envelope.id)) {
      return
    }

    this.broker.sendMessage(prepareInboundServerMessage(frame.envelope))
  }

  private handleAck(ack: number) {
    this.unackedMessages.forEach((queuedMessage, id) => {
      if (queuedMessage.lastSeq <= ack) {
        this.unackedMessages.delete(id)
      }
    })
  }

  private startTimers() {
    this.keepaliveIntervalId = globalThis.setInterval(() => {
      this.writeFrame({
        authToken: this.getAuthToken() ?? undefined,
        seq: this.nextSequence(),
        type: 'ping',
      })
    }, keepaliveIntervalMs)

    this.staleCheckIntervalId = globalThis.setInterval(() => {
      const socket = this.socket
      if (
        socket?.readyState === WebSocket.OPEN &&
        Date.now() - this.lastFrameReceivedAt > staleConnectionMs
      ) {
        this.setStatus('stale')
        socket.close()
      }
    }, keepaliveIntervalMs)
  }

  private scheduleReconnect() {
    if (this.disposed) {
      return
    }

    const delay = this.nextReconnectDelayMs
    this.nextReconnectDelayMs = Math.min(
      this.nextReconnectDelayMs * 2,
      maxReconnectDelayMs,
    )

    this.reconnectTimeoutId = globalThis.setTimeout(() => {
      this.reconnectTimeoutId = null
      this.connect()
    }, delay)
  }

  private writeFrame(frame: ServerBridgeFrame) {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      socket.send(JSON.stringify(frame))
    } catch (error) {
      console.warn('[ServerBridge] websocket send failed', error)
      socket.close()
    }
  }

  private nextSequence() {
    this.nextSeq += 1
    return this.nextSeq
  }

  private setStatus(status: ServerBridgeStatus) {
    this.onStatusChange(status)
  }

  private clearTimers() {
    if (this.keepaliveIntervalId) {
      globalThis.clearInterval(this.keepaliveIntervalId)
      this.keepaliveIntervalId = null
    }

    if (this.reconnectTimeoutId) {
      globalThis.clearTimeout(this.reconnectTimeoutId)
      this.reconnectTimeoutId = null
    }

    if (this.staleCheckIntervalId) {
      globalThis.clearInterval(this.staleCheckIntervalId)
      this.staleCheckIntervalId = null
    }
  }
}

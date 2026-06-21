import http from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  parseCompanionBridgeFrame,
  type CompanionBridgeFrame,
} from '../bus/companionBridgeProtocol'
import type { MessageBroker } from '../bus/messageBroker'
import type { BusMessage } from '../bus/messages'
import type { Disposable } from '../di'

interface QueuedMessage {
  lastSeq: number
  message: BusMessage
}

const allowedOrigins = new Set([
  'https://jena.tools',
  'https://test.jena.tools',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])
const dedupWindowMs = 10 * 60_000
const keepaliveIntervalMs = 1_000
const maxPayloadBytes = 1024 * 1024
const staleConnectionMs = 20_000
const companionOutboundSources = new Set(['clipboard', 'status'])

export class CompanionWebSocketServer implements Disposable {
  private readonly deduper = new ExpiringMessageDeduper(dedupWindowMs)
  private readonly httpServer: http.Server
  private readonly unackedMessages = new Map<string, QueuedMessage>()
  private readonly websocketServer: WebSocketServer
  private keepaliveInterval: NodeJS.Timeout | null = null
  private lastFrameReceivedAt = 0
  private nextSeq = 0
  private socket: WebSocket | null = null
  private staleInterval: NodeJS.Timeout | null = null
  private unregisterBrokerListener: (() => void) | null = null

  constructor(private readonly broker: MessageBroker) {
    this.httpServer = http.createServer((_, response) => {
      response.writeHead(404)
      response.end()
    })
    this.websocketServer = new WebSocketServer({
      maxPayload: maxPayloadBytes,
      noServer: true,
    })
  }

  start() {
    this.unregisterBrokerListener = this.broker.listen('*', (message) => {
      if (!message.source || !companionOutboundSources.has(message.source)) {
        return
      }

      this.sendToClient(message)
    })

    this.httpServer.on('upgrade', (request, socket, head) => {
      console.log(
        `[CompanionWebSocketServer] websocket upgrade requested url=${request.url ?? ''} origin=${request.headers.origin ?? ''}`,
      )
      if (request.url !== '/ws' || !isAllowedOrigin(request.headers.origin)) {
        console.log(
          `[CompanionWebSocketServer] websocket upgrade rejected url=${request.url ?? ''} origin=${request.headers.origin ?? ''}`,
        )
        socket.destroy()
        return
      }

      console.log(
        `[CompanionWebSocketServer] websocket upgrade accepted origin=${request.headers.origin ?? ''}`,
      )
      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.websocketServer.emit('connection', websocket, request)
      })
    })

    this.websocketServer.on('connection', (socket) => {
      this.replaceSocket(socket)
    })

    this.httpServer.listen(9724, '127.0.0.1', () => {
      console.log('[CompanionWebSocketServer] listening on 127.0.0.1:9724')
    })
    this.httpServer.on('error', (error) => {
      console.error('[CompanionWebSocketServer] HTTP server error', error)
    })
  }

  dispose() {
    this.unregisterBrokerListener?.()
    this.unregisterBrokerListener = null
    this.clearTimers()
    this.socket?.close()
    this.socket = null
    this.websocketServer.close()
    this.httpServer.close()
  }

  private replaceSocket(socket: WebSocket) {
    console.log('[CompanionWebSocketServer] websocket connection opened')
    this.socket?.close()
    this.socket = socket
    this.lastFrameReceivedAt = Date.now()
    this.nextSeq = 0
    this.unackedMessages.clear()
    this.clearTimers()
    this.startTimers()

    socket.on('message', (data) => {
      if (this.socket !== socket) {
        return
      }

      this.handleSocketMessage(data.toString())
    })

    socket.on('close', () => {
      if (this.socket !== socket) {
        return
      }

      console.log('[CompanionWebSocketServer] websocket connection closed')
      this.clearTimers()
      this.socket = null
      this.unackedMessages.clear()
    })

    socket.on('error', (error) => {
      console.error('[CompanionWebSocketServer] websocket error', error)
      socket.close()
    })
  }

  private sendToClient(message: BusMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.log(
        `[CompanionWebSocketServer] dropping outbound message while disconnected source=${message.source ?? ''} destination=${message.destination} id=${message.id}`,
      )
      return
    }

    if (this.unackedMessages.has(message.id)) {
      return
    }

    const seq = this.nextSequence()
    this.unackedMessages.set(message.id, {
      lastSeq: seq,
      message,
    })
    this.writeFrame({
      envelope: message,
      seq,
      type: 'message',
    })
  }

  private handleSocketMessage(data: unknown) {
    this.lastFrameReceivedAt = Date.now()

    const frame = parseCompanionBridgeFrame(data)
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
          type: 'pong',
        })
        return
      case 'ack':
      case 'pong':
        return
    }
  }

  private handleMessageFrame(
    frame: Extract<CompanionBridgeFrame, { type: 'message' }>,
  ) {
    console.log(
      `[CompanionWebSocketServer] eventbus message received source=${frame.envelope.source ?? ''} destination=${frame.envelope.destination} id=${frame.envelope.id}`,
    )

    this.writeFrame({
      ack: frame.seq,
      type: 'ack',
    })

    if (!this.deduper.markSeen(frame.envelope.id)) {
      return
    }

    this.broker.sendMessage(frame.envelope)
  }

  private handleAck(ack: number) {
    this.unackedMessages.forEach((queuedMessage, id) => {
      if (queuedMessage.lastSeq <= ack) {
        this.unackedMessages.delete(id)
      }
    })
  }

  private startTimers() {
    this.keepaliveInterval = setInterval(() => {
      this.writeFrame({
        seq: this.nextSequence(),
        type: 'ping',
      })
    }, keepaliveIntervalMs)

    this.staleInterval = setInterval(() => {
      if (Date.now() - this.lastFrameReceivedAt > staleConnectionMs) {
        console.log('[CompanionWebSocketServer] websocket stale; closing')
        this.socket?.close()
      }
    }, keepaliveIntervalMs)
  }

  private clearTimers() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
    if (this.staleInterval) {
      clearInterval(this.staleInterval)
      this.staleInterval = null
    }
  }

  private writeFrame(frame: CompanionBridgeFrame) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      this.socket.send(JSON.stringify(frame))
    } catch (error) {
      console.error('[CompanionWebSocketServer] websocket send failed', error)
      this.socket.close()
    }
  }

  private nextSequence() {
    this.nextSeq += 1
    return this.nextSeq
  }
}

class ExpiringMessageDeduper {
  private readonly seenIds = new Map<string, number>()

  constructor(private readonly windowMs: number) {}

  markSeen(id: string, now = Date.now()) {
    this.expire(now)

    const expiresAt = this.seenIds.get(id)
    if (expiresAt !== undefined && now < expiresAt) {
      return false
    }

    this.seenIds.set(id, now + this.windowMs)
    return true
  }

  private expire(now: number) {
    this.seenIds.forEach((expiresAt, id) => {
      if (now >= expiresAt) {
        this.seenIds.delete(id)
      }
    })
  }
}

function isAllowedOrigin(origin: string | undefined) {
  return typeof origin === 'string' && allowedOrigins.has(origin)
}

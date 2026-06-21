import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MessageBroker } from '../shared/messageBroker'
import { useMessageBroker } from '../shared/messageBrokerHooks'
import {
  CompanionEndpointPrefix,
  type BusMessage,
} from '../shared/messages'
import {
  getDefaultCompanionBridgeUrl,
  parseCompanionBridgeFrame,
  prepareInboundCompanionMessage,
  prepareOutboundCompanionMessage,
  type CompanionBridgeFrame,
} from './CompanionBridgeProtocol'

export type CompanionStatus = 'closed' | 'connecting' | 'open' | 'stale'

interface CompanionInfo {
  appName: string
  capabilities: string[]
  protocolVersion: number
  version: string
}

interface CompanionContextValue {
  appName: string | null
  appVersion: string | null
  capabilities: string[]
  isAvailable: boolean
  protocolVersion: number | null
  refresh: () => void
  status: CompanionStatus
  writeClipboardText: (text: string) => Promise<void>
}

interface QueuedMessage {
  lastSeq: number
  message: BusMessage
}

const CompanionContext = createContext<CompanionContextValue | null>(null)

const companionStatusProbeTimeoutMs = 2_000
const keepaliveIntervalMs = 1_000
const staleConnectionMs = 20_000
const reconnectDelayMs = 1_000
const maxReconnectDelayMs = 10_000
const companionBridgeLogPrefix = '[CompanionBridge]'

export function CompanionProvider({ children }: { children: ReactNode }) {
  const broker = useMessageBroker()
  const [status, setStatus] = useState<CompanionStatus>('closed')
  const [info, setInfo] = useState<CompanionInfo | null>(null)
  const controllerRef = useRef<CompanionBridgeController | null>(null)

  useEffect(() => {
    const controller = new CompanionBridgeController({
      broker,
      onStatusChange: setStatus,
      url: getDefaultCompanionBridgeUrl(),
    })

    controllerRef.current = controller
    controller.start()

    return () => {
      controller.dispose()
      controllerRef.current = null
    }
  }, [broker])

  const refresh = useCallback(() => {
    controllerRef.current?.reconnectNow()
  }, [])

  useEffect(() => {
    if (status !== 'open') {
      setInfo(null)
      return
    }

    let canceled = false
    broker
      .call('companion-provider', 'companion.status', 'getStatus', {}, {
        timeoutMs: companionStatusProbeTimeoutMs,
      })
      .then((response) => {
        if (!canceled) {
          setInfo(response)
        }
      })
      .catch(() => {
        if (!canceled) {
          setInfo(null)
        }
      })

    return () => {
      canceled = true
    }
  }, [broker, status])

  const writeClipboardText = useCallback(
    async (text: string) => {
      await broker.call('companion-provider', 'companion.clipboard', 'writeText', {
        text,
      })
    },
    [broker],
  )

  const value = useMemo(
    () => ({
      appName: info?.appName ?? null,
      appVersion: info?.version ?? null,
      capabilities: info?.capabilities ?? [],
      isAvailable: status === 'open' && info !== null,
      protocolVersion: info?.protocolVersion ?? null,
      refresh,
      status,
      writeClipboardText,
    }),
    [info, refresh, status, writeClipboardText],
  )

  return (
    <CompanionContext.Provider value={value}>
      {children}
    </CompanionContext.Provider>
  )
}

export function useCompanion() {
  const context = useContext(CompanionContext)
  if (!context) {
    throw new Error('useCompanion must be used within CompanionProvider')
  }

  return context
}

class CompanionBridgeController {
  private readonly broker: MessageBroker
  private readonly onStatusChange: (status: CompanionStatus) => void
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
    onStatusChange,
    url,
  }: {
    broker: MessageBroker
    onStatusChange: (status: CompanionStatus) => void
    url: string
  }) {
    this.broker = broker
    this.onStatusChange = onStatusChange
    this.url = url
  }

  start() {
    this.unregisterBusListener = this.broker.listen('companion.*', (message) => {
      if (message.source?.startsWith(CompanionEndpointPrefix)) {
        return
      }

      this.sendToCompanion(prepareOutboundCompanionMessage(message))
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

  reconnectNow() {
    if (this.disposed) {
      return
    }

    console.log(`${companionBridgeLogPrefix} reconnect requested`)
    this.socket?.close()
    this.socket = null
    this.clearTimers()
    this.connect()
  }

  private connect() {
    if (this.disposed) {
      return
    }

    console.log(`${companionBridgeLogPrefix} connecting url=${this.url}`)
    this.setStatus('connecting')
    this.clearTimers()
    this.nextSeq = 0
    this.unackedMessages.clear()

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      console.warn(`${companionBridgeLogPrefix} websocket construction failed`, error)
      this.setStatus('closed')
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      console.log(`${companionBridgeLogPrefix} websocket opened`)
      this.lastFrameReceivedAt = Date.now()
      this.nextReconnectDelayMs = reconnectDelayMs
      this.setStatus('open')
      this.startTimers()
    })

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      this.handleSocketMessage(event.data)
    })

    socket.addEventListener('close', () => {
      this.handleSocketClosed(socket, 'close')
    })

    socket.addEventListener('error', (event) => {
      if (this.socket !== socket || this.disposed) {
        return
      }

      console.warn(`${companionBridgeLogPrefix} websocket error`, event)
      this.handleSocketClosed(socket, 'error')
    })
  }

  private handleSocketClosed(socket: WebSocket, reason: string) {
    if (this.socket !== socket || this.disposed) {
      return
    }

    console.log(`${companionBridgeLogPrefix} websocket closed reason=${reason}`)
    this.socket = null
    this.clearTimers()
    this.unackedMessages.clear()
    this.setStatus('closed')
    try {
      socket.close()
    } catch {
      // Ignore close failures during reconnect cleanup.
    }
    this.scheduleReconnect()
  }

  private sendToCompanion(message: BusMessage) {
    const socket = this.socket

    if (this.unackedMessages.has(message.id)) {
      return
    }

    if (socket?.readyState === WebSocket.OPEN) {
      this.writeMessageFrame(message)
      return
    }

    this.broker.replyWithError(
      message,
      new Error('JENA Companion is not connected.'),
    )
  }

  private writeMessageFrame(message: BusMessage) {
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
    this.writeFrame({
      ack: frame.seq,
      type: 'ack',
    })

    this.broker.sendMessage(prepareInboundCompanionMessage(frame.envelope))
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
        console.log(`${companionBridgeLogPrefix} websocket stale; closing`)
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

    console.log(`${companionBridgeLogPrefix} reconnect scheduled delayMs=${delay}`)
    this.reconnectTimeoutId = globalThis.setTimeout(() => {
      this.reconnectTimeoutId = null
      this.connect()
    }, delay)
  }

  private writeFrame(frame: CompanionBridgeFrame) {
    const socket = this.socket
    if (socket?.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      socket.send(JSON.stringify(frame))
    } catch (error) {
      console.warn('[CompanionBridge] websocket send failed', error)
      socket.close()
    }
  }

  private nextSequence() {
    this.nextSeq += 1
    return this.nextSeq
  }

  private setStatus(status: CompanionStatus) {
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

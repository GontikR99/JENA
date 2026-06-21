export type Endpoint = string

export interface BusMessage<TPayload = unknown> {
  correlationId?: string
  destination: Endpoint
  id: string
  payload: TPayload
  source: Endpoint | null
}

export interface RpcRequestPayload {
  method: string
  params: unknown
}

export type RpcResponsePayload =
  | {
      ok: true
      result: unknown
    }
  | {
      error: SerializedError
      ok: false
    }

export interface SerializedError {
  message: string
  name?: string
  stack?: string
}

export function createBusMessage<TPayload>({
  correlationId,
  destination,
  payload,
  source,
}: {
  correlationId?: string
  destination: Endpoint
  payload: TPayload
  source: Endpoint | null
}): BusMessage<TPayload> {
  return {
    id: createMessageId(),
    ...(correlationId ? { correlationId } : {}),
    destination,
    payload,
    source,
  }
}

export function createMessageId() {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function isBusMessage(value: unknown): value is BusMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<BusMessage>

  return (
    typeof candidate.id === 'string' &&
    (candidate.source === null || typeof candidate.source === 'string') &&
    typeof candidate.destination === 'string' &&
    (candidate.correlationId === undefined ||
      typeof candidate.correlationId === 'string') &&
    'payload' in candidate
  )
}

export function isRpcRequestPayload(value: unknown): value is RpcRequestPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RpcRequestPayload>

  return typeof candidate.method === 'string' && 'params' in candidate
}

export function isRpcRequestMessage(
  message: BusMessage,
): message is BusMessage<RpcRequestPayload> {
  return (
    typeof message.correlationId === 'string' &&
    message.source !== null &&
    isRpcRequestPayload(message.payload)
  )
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }

  return {
    message: String(error),
  }
}

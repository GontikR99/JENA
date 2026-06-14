import type { FileSystemHandleLike } from './fileSystemAccess'

export type Endpoint = string

export interface BusMessage<TPayload = unknown> {
  id: string
  source: Endpoint | null
  destination: Endpoint
  correlationId?: string
  payload: TPayload
}

export type JsonSerializable =
  | null
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }

export type CloneablePayload =
  | JsonSerializable
  | FileSystemHandleLike
  | { [key: string]: CloneablePayload }
  | CloneablePayload[]

export type EndpointMessages = Record<never, never>

export interface EverQuestLogFile {
  characterName: string
  fileName: string
  serverName: string
}

export interface RpcEndpoints {
  'worker.file-watcher': {
    setFileHandle: {
      request: {
        fileHandle: FileSystemHandleLike
      }
      response: Record<string, never>
    }
    enumerateLogs: {
      request: Record<string, never>
      response: {
        logs: EverQuestLogFile[]
      }
    }
    startWatch: {
      request: Record<string, never>
      response: Record<string, never>
    }
    stopWatch: {
      request: Record<string, never>
      response: Record<string, never>
    }
  }
}

export interface RpcRequestPayload<
  TMethod extends string = string,
  TParams = unknown,
> {
  method: TMethod
  params: TParams
}

export type RpcResponsePayload<TResult = unknown> =
  | {
      ok: true
      result: TResult
    }
  | {
      ok: false
      error: SerializedError
    }

export interface SerializedError {
  name?: string
  message: string
  stack?: string
}

export type EndpointPayload<TDestination extends string> =
  TDestination extends keyof EndpointMessages
    ? EndpointMessages[TDestination]
    : unknown

export type RpcMethod<TEndpoint extends keyof RpcEndpoints> =
  keyof RpcEndpoints[TEndpoint] & string

export type RpcRequest<
  TEndpoint extends keyof RpcEndpoints,
  TMethod extends RpcMethod<TEndpoint>,
> = RpcEndpoints[TEndpoint][TMethod] extends { request: infer TRequest }
  ? TRequest
  : never

export type RpcResponse<
  TEndpoint extends keyof RpcEndpoints,
  TMethod extends RpcMethod<TEndpoint>,
> = RpcEndpoints[TEndpoint][TMethod] extends { response: infer TResponse }
  ? TResponse
  : never

export const WorkerEndpointPrefix = 'worker.'

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
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
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

export function isRpcRequestPayload(
  value: unknown,
): value is RpcRequestPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RpcRequestPayload>

  return typeof candidate.method === 'string' && 'params' in candidate
}

export function isRpcResponsePayload(
  value: unknown,
): value is RpcResponsePayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RpcResponsePayload>

  if (candidate.ok === true) {
    return 'result' in candidate
  }

  if (candidate.ok === false) {
    return isSerializedError(candidate.error)
  }

  return false
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

export function stripWorkerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(WorkerEndpointPrefix)
    ? endpoint.slice(WorkerEndpointPrefix.length)
    : endpoint
}

export function addWorkerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(WorkerEndpointPrefix)
    ? endpoint
    : `${WorkerEndpointPrefix}${endpoint}`
}

function isSerializedError(value: unknown): value is SerializedError {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SerializedError>

  return (
    typeof candidate.message === 'string' &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.stack === undefined || typeof candidate.stack === 'string')
  )
}

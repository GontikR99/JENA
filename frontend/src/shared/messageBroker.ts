import {
  createBusMessage,
  createMessageId,
  isRpcRequestMessage,
  isRpcResponsePayload,
  serializeError,
  type BusMessage,
  type Endpoint,
  type EndpointMessages,
  type EndpointPayload,
  type RpcEndpoints,
  type RpcMethod,
  type RpcRequest,
  type RpcRequestPayload,
  type RpcResponse,
  type RpcResponsePayload,
} from './messages'

export type MessageCallback = (
  message: BusMessage,
) => unknown | Promise<unknown>

interface ListenerRegistration {
  callback: MessageCallback
  destinationGlob: string
}

interface PendingRpcCall {
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  timeoutId: ReturnType<typeof globalThis.setTimeout>
}

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>
export type RpcHandlerMap = Record<string, RpcHandler>

export type TypedRpcHandlerMap<TEndpoint extends keyof RpcEndpoints> = {
  [TMethod in RpcMethod<TEndpoint>]: (
    params: RpcRequest<TEndpoint, TMethod>,
  ) => RpcResponse<TEndpoint, TMethod> | Promise<RpcResponse<TEndpoint, TMethod>>
}

const defaultRpcTimeoutMs = 30_000

export class MessageBus {
  private readonly listeners = new Set<ListenerRegistration>()

  listen(destinationGlob: string, callback: MessageCallback) {
    const registration: ListenerRegistration = {
      callback,
      destinationGlob,
    }

    this.listeners.add(registration)

    return () => {
      this.listeners.delete(registration)
    }
  }

  send(message: BusMessage) {
    this.dispatch(message)
  }

  protected dispatch(message: BusMessage) {
    this.listeners.forEach((listener) => {
      if (matchesEndpointGlob(listener.destinationGlob, message.destination)) {
        void listener.callback(message)
      }
    })
  }
}

export class MessageBroker {
  private readonly bus: MessageBus
  private readonly pendingRpcCalls = new Map<string, PendingRpcCall>()
  private readonly registeredRpcEndpoints = new Set<Endpoint>()

  constructor(bus: MessageBus) {
    this.bus = bus
    this.bus.listen('*', this.handleRpcResponse)
  }

  listen(destinationGlob: string, callback: MessageCallback) {
    return this.bus.listen(destinationGlob, (message) => {
      void Promise.resolve()
        .then(() => callback(message))
        .catch((error: unknown) => {
          this.handleListenerError(message, error)
        })
    })
  }

  send<TDestination extends keyof EndpointMessages & string>(
    source: Endpoint | null,
    destination: TDestination,
    payload: EndpointPayload<TDestination>,
  ): void
  send(source: Endpoint | null, destination: Endpoint, payload: unknown): void
  send(source: Endpoint | null, destination: Endpoint, payload: unknown) {
    this.sendMessage(
      createBusMessage({
        destination,
        payload,
        source,
      }),
    )
  }

  sendMessage(message: BusMessage) {
    this.bus.send(message)
  }

  call<
    TEndpoint extends keyof RpcEndpoints & string,
    TMethod extends RpcMethod<TEndpoint>,
  >(
    source: Endpoint,
    destination: TEndpoint,
    method: TMethod,
    params: RpcRequest<TEndpoint, TMethod>,
    options?: { timeoutMs?: number },
  ): Promise<RpcResponse<TEndpoint, TMethod>>
  call<TResult = unknown>(
    source: Endpoint,
    destination: Endpoint,
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<TResult>
  call<TResult = unknown>(
    source: Endpoint,
    destination: Endpoint,
    method: string,
    params: unknown,
    options: { timeoutMs?: number } = {},
  ) {
    const correlationId = createMessageId()
    const payload: RpcRequestPayload = {
      method,
      params,
    }

    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.pendingRpcCalls.delete(correlationId)
        reject(new Error(`RPC call to ${destination}.${method} timed out.`))
      }, options.timeoutMs ?? defaultRpcTimeoutMs)

      this.pendingRpcCalls.set(correlationId, {
        reject,
        resolve: resolve as (value: unknown) => void,
        timeoutId,
      })

      this.sendMessage(
        createBusMessage({
          correlationId,
          destination,
          payload,
          source,
        }),
      )
    })
  }

  register<TEndpoint extends keyof RpcEndpoints & string>(
    endpoint: TEndpoint,
    methods: TypedRpcHandlerMap<TEndpoint>,
  ): () => void
  register(endpoint: Endpoint, methods: RpcHandlerMap): () => void
  register(endpoint: Endpoint, methods: RpcHandlerMap) {
    if (this.registeredRpcEndpoints.has(endpoint)) {
      throw new Error(`RPC endpoint ${endpoint} is already registered.`)
    }

    this.registeredRpcEndpoints.add(endpoint)

    const unregister = this.listen(endpoint, async (message) => {
      if (!isRpcRequestMessage(message)) {
        return
      }

      const handler = methods[message.payload.method]

      if (!handler) {
        this.replyWithError(
          message,
          new Error(
            `RPC method ${message.payload.method} is not registered on ${endpoint}.`,
          ),
        )
        return
      }

      try {
        const result = await Promise.resolve().then(() =>
          handler(message.payload.params),
        )

        this.reply(message, {
          ok: true,
          result,
        })
      } catch (error) {
        this.replyWithError(message, error)
      }
    })

    return () => {
      unregister()
      this.registeredRpcEndpoints.delete(endpoint)
    }
  }

  replyWithError(request: BusMessage, error: unknown) {
    if (!isRpcRequestMessage(request)) {
      return
    }

    this.reply(request, {
      error: serializeError(error),
      ok: false,
    })
  }

  private reply(request: BusMessage<RpcRequestPayload>, payload: RpcResponsePayload) {
    if (!request.source || !request.correlationId) {
      return
    }

    this.sendMessage(
      createBusMessage({
        correlationId: request.correlationId,
        destination: request.source,
        payload,
        source: request.destination,
      }),
    )
  }

  private readonly handleRpcResponse = (message: BusMessage) => {
    if (
      !message.correlationId ||
      !this.pendingRpcCalls.has(message.correlationId) ||
      !isRpcResponsePayload(message.payload)
    ) {
      return
    }

    const pendingCall = this.pendingRpcCalls.get(message.correlationId)

    if (!pendingCall) {
      return
    }

    globalThis.clearTimeout(pendingCall.timeoutId)
    this.pendingRpcCalls.delete(message.correlationId)

    if (message.payload.ok) {
      pendingCall.resolve(message.payload.result)
      return
    }

    pendingCall.reject(createRpcError(message.payload.error))
  }

  private handleListenerError(message: BusMessage, error: unknown) {
    this.replyWithError(message, error)
    console.error(error)
  }
}

export const clientMessageBus = new MessageBus()
export const messageBroker = new MessageBroker(clientMessageBus)

export function matchesEndpointGlob(glob: string, endpoint: string) {
  if (glob === '*') {
    return true
  }

  if (glob.endsWith('*')) {
    return endpoint.startsWith(glob.slice(0, -1))
  }

  return glob === endpoint
}

function createRpcError(error: { name?: string; message: string; stack?: string }) {
  const rpcError = new Error(error.message)

  rpcError.name = error.name ?? 'RpcError'

  if (error.stack) {
    rpcError.stack = error.stack
  }

  return rpcError
}

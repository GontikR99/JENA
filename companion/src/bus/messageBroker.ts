import {
  createBusMessage,
  isRpcRequestMessage,
  serializeError,
  type BusMessage,
  type Endpoint,
} from './messages'

export type MessageCallback = (
  message: BusMessage,
) => unknown | Promise<unknown>

export type RpcHandler = (params: unknown) => unknown | Promise<unknown>
export type RpcHandlerMap = Record<string, RpcHandler>

interface ListenerRegistration {
  callback: MessageCallback
  destinationGlob: string
}

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
    this.listeners.forEach((listener) => {
      if (matchesEndpointGlob(listener.destinationGlob, message.destination)) {
        void listener.callback(message)
      }
    })
  }
}

export class MessageBroker {
  private readonly registeredRpcEndpoints = new Set<Endpoint>()

  constructor(private readonly bus: MessageBus) {}

  listen(destinationGlob: string, callback: MessageCallback) {
    return this.bus.listen(destinationGlob, (message) => {
      void Promise.resolve()
        .then(() => callback(message))
        .catch((error: unknown) => {
          this.replyWithError(message, error)
          console.error(error)
        })
    })
  }

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

  sendMessage(message: BusMessage) {
    this.bus.send(message)
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

  private reply(request: BusMessage, payload: unknown) {
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
}

function matchesEndpointGlob(glob: string, endpoint: string) {
  if (glob === '*') {
    return true
  }

  if (glob.endsWith('*')) {
    return endpoint.startsWith(glob.slice(0, -1))
  }

  return glob === endpoint
}

import { useCallback, useContext, useEffect, useRef } from 'react'
import { MessageBrokerContext } from './messageBrokerContext'
import type {
  MessageCallback,
  MessageBroker,
  RpcHandlerMap,
  TypedRpcHandlerMap,
} from './messageBroker'
import type {
  Endpoint,
  EndpointMessages,
  EndpointPayload,
  RpcEndpoints,
  RpcMethod,
  RpcRequest,
  RpcResponse,
} from './messages'

export function useMessageBroker() {
  const broker = useContext(MessageBrokerContext)

  if (!broker) {
    throw new Error('MessageBrokerProvider is missing.')
  }

  return broker
}

export function useListen(destinationGlob: string, callback: MessageCallback) {
  const broker = useMessageBroker()
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    return broker.listen(destinationGlob, (message) => {
      return callbackRef.current(message)
    })
  }, [broker, destinationGlob])
}

export function useSender(source: Endpoint | null) {
  const broker = useMessageBroker()

  return useCallback(
    <TDestination extends keyof EndpointMessages & string>(
      destination: TDestination,
      payload: EndpointPayload<TDestination>,
    ) => {
      broker.send(source, destination, payload)
    },
    [broker, source],
  ) as Sender
}

export function useRpc(source: Endpoint) {
  const broker = useMessageBroker()

  return useCallback(
    <
      TEndpoint extends keyof RpcEndpoints & string,
      TMethod extends RpcMethod<TEndpoint>,
    >(
      destination: TEndpoint,
      method: TMethod,
      payload: RpcRequest<TEndpoint, TMethod>,
    ) => {
      return broker.call(source, destination, method, payload)
    },
    [broker, source],
  ) as RpcCaller
}

export function useRpcServer<TEndpoint extends keyof RpcEndpoints & string>(
  endpoint: TEndpoint,
  methods: TypedRpcHandlerMap<TEndpoint>,
): void
export function useRpcServer(endpoint: Endpoint, methods: RpcHandlerMap): void
export function useRpcServer(endpoint: Endpoint, methods: RpcHandlerMap) {
  const broker = useMessageBroker()
  const methodsRef = useRef(methods)

  useEffect(() => {
    methodsRef.current = methods
  }, [methods])

  useEffect(() => {
    return broker.register(
      endpoint,
      new Proxy(
        {},
        {
          get: (_target, property) => {
            if (typeof property !== 'string') {
              return undefined
            }

            if (!methodsRef.current[property]) {
              return undefined
            }

            return (params: unknown) => methodsRef.current[property]?.(params)
          },
        },
      ) as RpcHandlerMap,
    )
  }, [broker, endpoint])
}

type Sender = {
  <TDestination extends keyof EndpointMessages & string>(
    destination: TDestination,
    payload: EndpointPayload<TDestination>,
  ): void
  (destination: Endpoint, payload: unknown): void
}

type RpcCaller = {
  <
    TEndpoint extends keyof RpcEndpoints & string,
    TMethod extends RpcMethod<TEndpoint>,
  >(
    destination: TEndpoint,
    method: TMethod,
    payload: RpcRequest<TEndpoint, TMethod>,
  ): Promise<RpcResponse<TEndpoint, TMethod>>
  <TResult = unknown>(
    destination: Endpoint,
    method: string,
    payload: unknown,
  ): Promise<TResult>
}

export type { MessageBroker }

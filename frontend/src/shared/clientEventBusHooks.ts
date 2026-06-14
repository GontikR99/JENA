import { useCallback, useContext, useEffect, useRef } from 'react'
import { ClientEventBusContext } from './clientEventBusContext'
import type { ClientMessages, ClientMessage, MessageType } from './messages'

export function useClientEventBus() {
  const bus = useContext(ClientEventBusContext)

  if (!bus) {
    throw new Error('ClientEventBusProvider is missing.')
  }

  return bus
}

export function useSubscribe<TMessageType extends MessageType>(
  type: TMessageType,
  callback: (message: ClientMessage<TMessageType>) => void,
) {
  const bus = useClientEventBus()
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    return bus.subscribe(type, (message) => {
      callbackRef.current(message)
    })
  }, [bus, type])
}

export function useSender() {
  const bus = useClientEventBus()

  return useCallback(
    <TMessageType extends MessageType>(
      type: TMessageType,
      payload: ClientMessages[TMessageType],
    ) => {
      bus.send(type, payload)
    },
    [bus],
  )
}

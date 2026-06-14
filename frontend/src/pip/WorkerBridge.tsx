import { useEffect } from 'react'
import { useClientEventBus } from '../shared/clientEventBusHooks'
import {
  ClientEventTransportType,
  isClientEventTransportMessage,
  MessageType,
  type ClientEventTransportMessage,
} from '../shared/messages'

export function WorkerBridge() {
  const bus = useClientEventBus()

  useEffect(() => {
    const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), {
      name: 'jena-worker',
      type: 'module',
    })
    const workerMessageIds = new Set<string>()

    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (!isClientEventTransportMessage(event.data)) {
        return
      }

      workerMessageIds.add(event.data.message.id)
      bus.dispatch(event.data.message)
    })

    const unsubscribe = bus.subscribeAll((message) => {
      if (workerMessageIds.delete(message.id)) {
        return
      }

      const transportMessage: ClientEventTransportMessage = {
        message,
        type: ClientEventTransportType.ClientEvent,
      }

      worker.postMessage(transportMessage)
    })

    bus.send(MessageType.PipOpened, {})

    return () => {
      bus.send(MessageType.PipClosed, {})
      unsubscribe()
      worker.terminate()
    }
  }, [bus])

  return null
}

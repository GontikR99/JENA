import { useEffect, useRef } from 'react'
import { useMessageBroker } from '../shared/messageBrokerHooks'
import {
  addWorkerEndpointPrefix,
  isBusMessage,
  stripWorkerEndpointPrefix,
  WorkerEndpointPrefix,
} from '../shared/messages'

export function WorkerBridge() {
  const broker = useMessageBroker()
  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    function handleWorkerMessage(event: MessageEvent<unknown>) {
      if (!isBusMessage(event.data)) {
        return
      }

      if (event.data.source?.startsWith(WorkerEndpointPrefix)) {
        return
      }

      broker.sendMessage({
        ...event.data,
        source: event.data.source
          ? addWorkerEndpointPrefix(event.data.source)
          : null,
      })
    }

    function ensureWorker() {
      if (workerRef.current) {
        return workerRef.current
      }

      try {
        const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), {
          name: 'jena-worker',
          type: 'module',
        })

        worker.addEventListener('message', handleWorkerMessage)
        workerRef.current = worker

        return worker
      } catch (error) {
        console.error(error)

        return null
      }
    }

    const unregister = broker.listen('worker.*', (message) => {
      if (message.source?.startsWith(WorkerEndpointPrefix)) {
        return
      }

      const worker = ensureWorker()

      if (!worker) {
        broker.replyWithError(
          message,
          new Error('The worker is not available.'),
        )
        return
      }

      worker.postMessage({
        ...message,
        destination: stripWorkerEndpointPrefix(message.destination),
      })
    })

    return () => {
      unregister()

      if (workerRef.current) {
        workerRef.current.removeEventListener('message', handleWorkerMessage)
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [broker])

  return null
}

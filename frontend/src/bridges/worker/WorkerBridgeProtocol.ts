import {
  addWorkerEndpointPrefix,
  stripWorkerEndpointPrefix,
  type BusMessage,
} from '../../shared/messages'

export function prepareMessageForWorker(message: BusMessage): BusMessage {
  return {
    ...message,
    destination: stripWorkerEndpointPrefix(message.destination),
  }
}

export function prepareMessageFromWorker(message: BusMessage): BusMessage {
  return {
    ...message,
    source: message.source ? addWorkerEndpointPrefix(message.source) : null,
  }
}

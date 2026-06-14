import { MessageBus } from '../shared/messageBroker'
import {
  addClientEndpointPrefix,
  ClientEndpointPrefix,
  isBusMessage,
  ServerEndpointPrefix,
  stripClientEndpointPrefix,
  type BusMessage,
} from '../shared/messages'
import type { Deps } from './di'

export class WorkerMessageBus extends MessageBus {
  constructor(deps: Deps) {
    super()
    void deps
    self.addEventListener('message', this.handleMessage)
  }

  override send(message: BusMessage) {
    super.send(message)

    if (message.destination.startsWith(ServerEndpointPrefix)) {
      self.postMessage(message)
      return
    }

    if (!message.destination.startsWith(ClientEndpointPrefix)) {
      return
    }

    self.postMessage({
      ...message,
      destination: stripClientEndpointPrefix(message.destination),
    })
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (!isBusMessage(event.data)) {
      return
    }

    this.dispatch({
      ...event.data,
      source: event.data.source
        ? addClientEndpointPrefix(event.data.source)
        : null,
    })
  }
}

import { MessageBus } from '../shared/messageBroker'
import { isBusMessage, type BusMessage } from '../shared/messages'
import type { Deps } from './di'

export class WorkerMessageBus extends MessageBus {
  constructor(deps: Deps) {
    super()
    void deps
    self.addEventListener('message', this.handleMessage)
  }

  override send(message: BusMessage) {
    super.send(message)
    self.postMessage(message)
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (!isBusMessage(event.data)) {
      return
    }

    this.dispatch(event.data)
  }
}

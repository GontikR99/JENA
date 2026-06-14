import {
  ClientEventTransportType,
  createClientMessage,
  isClientEventTransportMessage,
  type ClientEventTransportMessage,
  type ClientMessage,
  type ClientMessages,
  type MessageType,
} from '../shared/messages'
import type { Deps } from './di'

type MessageCallback<TMessageType extends MessageType> = (
  message: ClientMessage<TMessageType>,
) => void
type AnyMessageCallback = (message: ClientMessage) => void

export class ClientEventBus {
  private readonly listeners = new Map<MessageType, Set<AnyMessageCallback>>()

  constructor(deps: Deps) {
    void deps
    self.addEventListener('message', this.handleMessage)
  }

  subscribe<TMessageType extends MessageType>(
    type: TMessageType,
    callback: MessageCallback<TMessageType>,
  ) {
    const listeners = this.listeners.get(type) ?? new Set<AnyMessageCallback>()

    listeners.add(callback as AnyMessageCallback)
    this.listeners.set(type, listeners)
  }

  unsubscribe<TMessageType extends MessageType>(
    type: TMessageType,
    callback: MessageCallback<TMessageType>,
  ) {
    const listeners = this.listeners.get(type)

    if (!listeners) {
      return
    }

    listeners.delete(callback as AnyMessageCallback)

    if (listeners.size === 0) {
      this.listeners.delete(type)
    }
  }

  send<TMessageType extends MessageType>(
    type: TMessageType,
    payload: ClientMessages[TMessageType],
  ) {
    const message = createClientMessage(type, payload)

    this.dispatch(message)

    const transportMessage: ClientEventTransportMessage = {
      message,
      type: ClientEventTransportType.ClientEvent,
    }

    self.postMessage(transportMessage)
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (!isClientEventTransportMessage(event.data)) {
      return
    }

    this.dispatch(event.data.message)
  }

  private dispatch(message: ClientMessage) {
    this.listeners.get(message.type)?.forEach((listener) => {
      listener(message)
    })
  }
}

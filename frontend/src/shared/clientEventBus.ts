import {
  createClientMessage,
  type ClientMessage,
  type ClientMessages,
  type MessageType,
} from './messages'

type MessageCallback<TMessageType extends MessageType> = (
  message: ClientMessage<TMessageType>,
) => void
type AnyMessageCallback = (message: ClientMessage) => void

export class ClientEventBus {
  private readonly listeners = new Map<MessageType, Set<AnyMessageCallback>>()
  private readonly allListeners = new Set<AnyMessageCallback>()

  subscribe<TMessageType extends MessageType>(
    type: TMessageType,
    callback: MessageCallback<TMessageType>,
  ) {
    const listeners = this.listeners.get(type) ?? new Set<AnyMessageCallback>()

    listeners.add(callback as AnyMessageCallback)
    this.listeners.set(type, listeners)

    return () => {
      this.unsubscribe(type, callback)
    }
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

  subscribeAll(callback: AnyMessageCallback) {
    this.allListeners.add(callback)

    return () => {
      this.allListeners.delete(callback)
    }
  }

  send<TMessageType extends MessageType>(
    type: TMessageType,
    payload: ClientMessages[TMessageType],
  ) {
    this.dispatch(createClientMessage(type, payload))
  }

  dispatch(message: ClientMessage) {
    this.listeners.get(message.type)?.forEach((listener) => {
      listener(message)
    })

    this.allListeners.forEach((listener) => {
      listener(message)
    })
  }
}

export const clientEventBus = new ClientEventBus()

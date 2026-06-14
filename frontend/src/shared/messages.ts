import type { FileSystemDirectoryHandleLike } from './fileSystemAccess'

export const MessageType = {
  EverQuestDirectoryOpened: 'everquest.directory.opened',
  PipOpened: 'pip.opened',
  PipClosed: 'pip.closed',
} as const

export type MessageType = (typeof MessageType)[keyof typeof MessageType]

export type JsonSerializable =
  | null
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }

export type CloneablePayload =
  | JsonSerializable
  | FileSystemDirectoryHandleLike
  | { [key: string]: CloneablePayload }
  | CloneablePayload[]

export interface ClientMessages {
  [MessageType.EverQuestDirectoryOpened]: {
    directoryHandle: FileSystemDirectoryHandleLike
  }
  [MessageType.PipOpened]: Record<string, never>
  [MessageType.PipClosed]: Record<string, never>
}

export interface ClientMessage<
  TMessageType extends MessageType = MessageType,
> {
  id: string
  type: TMessageType
  payload: ClientMessages[TMessageType]
}

export const ClientEventTransportType = {
  ClientEvent: 'client-event',
} as const

export type ClientEventTransportType =
  (typeof ClientEventTransportType)[keyof typeof ClientEventTransportType]

export interface ClientEventTransportMessage {
  type: typeof ClientEventTransportType.ClientEvent
  message: ClientMessage
}

export function createClientMessage<TMessageType extends MessageType>(
  type: TMessageType,
  payload: ClientMessages[TMessageType],
): ClientMessage<TMessageType> {
  return {
    id: createMessageId(),
    payload,
    type,
  }
}

export function isClientEventTransportMessage(
  value: unknown,
): value is ClientEventTransportMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<ClientEventTransportMessage>

  return (
    candidate.type === ClientEventTransportType.ClientEvent &&
    typeof candidate.message?.id === 'string' &&
    typeof candidate.message.type === 'string'
  )
}

function createMessageId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

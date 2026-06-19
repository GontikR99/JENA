import type { FileSystemHandleLike } from './fileSystemAccess'
import type {
  JenaCharacterServer,
  JenaTrigger,
  JenaTriggerEnablementChange,
  JenaTriggerFlagChange,
  JenaTriggerId,
  JenaTriggerUpsert,
  JenaUserTriggerFetchResponse,
  JenaUserTriggerUpdate,
} from './triggers'

export type Endpoint = string

export interface BusMessage<TPayload = unknown> {
  id: string
  source: Endpoint | null
  destination: Endpoint
  correlationId?: string
  payload: TPayload
}

export type JsonSerializable =
  | null
  | boolean
  | number
  | string
  | JsonSerializable[]
  | { [key: string]: JsonSerializable }

export type CloneablePayload =
  | JsonSerializable
  | FileSystemHandleLike
  | { [key: string]: CloneablePayload }
  | CloneablePayload[]

export interface RegexPatternRegistration {
  pattern: string
}

export interface RegexCaptures {
  named: Record<string, string | null>
  positional: Array<string | null>
}

export interface RegexMatchFoundMessage {
  captures: RegexCaptures
  characterName: string
  pattern: string
  serverName: string
  text: string
  timestamp: string
}

export interface TriggerAlertMatchedMessage {
  characterName: string
  clipboardText?: string
  displayText?: string
  serverName: string
  speechProfile?: TriggerSpeechProfile
  speechText?: string
  text: string
  timerEndedAction?: TriggerTimerActionPayload
  timerName?: string
  timerWarningAction?: TriggerTimerActionPayload
  timestamp: string
  trigger: JenaTrigger
}

export interface TriggerTimerActionPayload {
  displayText?: string
  speechInterrupt?: boolean
  speechText?: string
}

export interface TriggerSpeechProfile {
  pitch: number
  rate: number
  voiceLang?: string
  voiceName?: string
  voiceURI: string | null
  volume: number
}

export type TriggerTimerActionKind = 'ended' | 'warning'

export interface TriggerTimerActionMessage extends TriggerTimerActionPayload {
  characterName: string
  kind: TriggerTimerActionKind
  serverName: string
  speechProfile?: TriggerSpeechProfile
  timerName: string
  timestamp: string
  trigger: JenaTrigger
}

export interface TriggerEarlyEnderMatchedMessage {
  characterName: string
  serverName: string
  text: string
  timerName?: string
  timestamp: string
  trigger: JenaTrigger
}

export type BroadcastAlertKind = 'timerEarlyEnded' | 'triggerMatched'

export interface BroadcastAlertMessage {
  alert: TriggerAlertMatchedMessage | TriggerEarlyEnderMatchedMessage
  eventId: string
  kind: BroadcastAlertKind
  subscriptionId?: string
}

export interface TriggerStopRequestedMessage {
  characterName: string
  command: '{JENA:STOP}' | '{GINA:STOP}'
  serverName: string
  text: string
  timestamp: string
}

export interface TriggerStoreTriggersSeenMessage {
  triggers: JenaTrigger[]
}

export interface TriggerSpeechPreviewRequestedMessage {
  interrupt?: boolean
  text: string
}

export interface EverQuestCharacter {
  active: boolean
  characterName: string
  serverName: string
}

export interface FileWatcherCharactersMessage {
  characters: EverQuestCharacter[]
}

export interface CharacterPresence {
  active: boolean
  characterName: string
  serverName: string
  zone: string
}

export interface CharacterPresenceCharactersMessage {
  characters: CharacterPresence[]
}

export interface AuthenticatedUser {
  avatarUrl?: string
  discordId: string
  globalName?: string
  id: string
  username: string
}

export interface UserSettings {
  displayName: string
}

export interface SubscriptionTriggerRecord {
  broadcastToSubscribers: boolean
  triggerId: JenaTriggerId
}

export interface SubscriptionUpdatedMessage {
  publisherUserId: string
}

export interface SubscriptionSyncRequestItem {
  digest: string
  id: string
}

export type SubscriptionSyncResult =
  | {
      digest: string
      id: string
      ownerDisplayName: string
      status: 'current'
    }
  | {
      digest: string
      id: string
      ownerDisplayName: string
      records: SubscriptionTriggerRecord[]
      status: 'updated'
    }
  | {
      id: string
      status: 'notFound'
    }

export type SubscriptionDefaultEnablementMode = 'disabled' | 'enabled'
export type SubscribedTriggerEnablementMode =
  | 'disabled'
  | 'enabled'
  | 'inherit'

export interface SubscriptionDefaultEnablementRecord {
  character: JenaCharacterServer
  mode: SubscriptionDefaultEnablementMode
  subscriptionId: string
}

export interface SubscribedTriggerEnablementRecord {
  character: JenaCharacterServer
  mode: Exclude<SubscribedTriggerEnablementMode, 'inherit'>
  subscriptionId: string
  triggerId: JenaTriggerId
}

export type AuthSessionResponse =
  | {
      status: 'anonymous'
    }
  | {
      status: 'authenticated'
      user: AuthenticatedUser
      userSettings: UserSettings
    }

export interface NearbyCharacterPresenceMessage {
  characters: CharacterPresence[]
}

export interface EndpointMessages {
  'alert.broadcast': BroadcastAlertMessage
  'alert.timer-action': TriggerTimerActionMessage
  'alert.timer-early-ended': TriggerEarlyEnderMatchedMessage
  'alert.stop-requested': TriggerStopRequestedMessage
  'alert.trigger-matched': TriggerAlertMatchedMessage
  'character-presence.characters': CharacterPresenceCharactersMessage
  'file-watcher.characters': FileWatcherCharactersMessage
  'matcher.match-found': RegexMatchFoundMessage
  'speech.preview-requested': TriggerSpeechPreviewRequestedMessage
  'subscriptions.updated': SubscriptionUpdatedMessage
  'trigger-store.triggers-seen': TriggerStoreTriggersSeenMessage
  'user-trigger-store.updated': JenaUserTriggerUpdate
  'worldwide-presence.nearby-characters': NearbyCharacterPresenceMessage
}

export interface EverQuestLogFile {
  characterName: string
  fileName: string
  serverName: string
}

export interface RpcEndpoints {
  'server.auth': {
    getSession: {
      request: Record<string, never>
      response: AuthSessionResponse
    }
  }
  'server.user-settings': {
    updateSettings: {
      request: {
        settings: UserSettings
      }
      response: UserSettings
    }
  }
  'server.sharing': {
    createSharePackage: {
      request: {
        triggerIds: JenaTriggerId[]
      }
      response: {
        code: string
        expiresAt: string
        id: string
        triggerIds: JenaTriggerId[]
      }
    }
    resolveSharePackage: {
      request: {
        code: string
      }
      response: {
        creatorDisplayName: string
        expiresAt: string
        triggerIds: JenaTriggerId[]
      }
    }
  }
  'server.broadcast': {
    reflectAlert: {
      request: {
        alert: TriggerAlertMatchedMessage | TriggerEarlyEnderMatchedMessage
        eventId: string
        kind: BroadcastAlertKind
        subscriptionIds: string[]
        userBroadcastMode?: 'boxes' | 'subscribers'
      }
      response: Record<string, never>
    }
  }
  'server.subscriptions': {
    addUserSubscription: {
      request: {
        subscriptionId: string
      }
      response: Record<string, never>
    }
    fetchUserSubscriptions: {
      request: Record<string, never>
      response: {
        defaultEnablement: SubscriptionDefaultEnablementRecord[]
        subscriptions: string[]
        triggerEnablement: SubscribedTriggerEnablementRecord[]
      }
    }
    getPublishedSubscriptionCode: {
      request: Record<string, never>
      response: {
        code: string
        id: string
      }
    }
    removeUserSubscription: {
      request: {
        subscriptionId: string
      }
      response: Record<string, never>
    }
    revokePublishedSubscriptionCode: {
      request: Record<string, never>
      response: Record<string, never>
    }
    setSubscribedTriggerEnablement: {
      request: {
        character: JenaCharacterServer
        mode: SubscribedTriggerEnablementMode
        subscriptionId: string
        triggerId: JenaTriggerId
      }
      response: Record<string, never>
    }
    setSubscriptionDefaultEnablement: {
      request: {
        character: JenaCharacterServer
        mode: SubscriptionDefaultEnablementMode
        subscriptionId: string
      }
      response: Record<string, never>
    }
    syncSubscriptions: {
      request: {
        subscriptions: SubscriptionSyncRequestItem[]
      }
      response: {
        subscriptions: SubscriptionSyncResult[]
      }
    }
  }
  'worker.file-watcher': {
    setFileHandle: {
      request: {
        fileHandle: FileSystemHandleLike | null
      }
      response: Record<string, never>
    }
    getCharacters: {
      request: Record<string, never>
      response: {
        characters: EverQuestCharacter[]
      }
    }
  }
  'worker.matcher-service': {
    'add-patterns': {
      request: {
        patterns: RegexPatternRegistration[]
      }
      response: Record<string, never>
    }
    flush: {
      request: Record<string, never>
      response: Record<string, never>
    }
  }
  'worker.character-presence': {
    getCharacters: {
      request: Record<string, never>
      response: {
        characters: CharacterPresence[]
      }
    }
  }
  'server.trigger-store': {
    checkTriggers: {
      request: {
        ids: string[]
      }
      response: {
        missingIds: JenaTriggerId[]
      }
    }
    storeTriggers: {
      request: {
        triggers: JenaTrigger[]
      }
      response: {
        triggers: JenaTrigger[]
      }
    }
    fetchTriggers: {
      request: {
        ids: string[]
      }
      response: {
        partial: boolean
        triggers: JenaTrigger[]
      }
    }
  }
  'server.user-trigger-store': {
    upsertTriggers: {
      request: {
        deleteTriggerIds?: JenaTriggerId[]
        knownRevision?: string
        triggers: JenaTriggerUpsert[]
      }
      response: JenaUserTriggerUpdate
    }
    deleteTriggers: {
      request: {
        knownRevision?: string
        triggerIds: JenaTriggerId[]
      }
      response: JenaUserTriggerUpdate
    }
    toggleTriggers: {
      request: {
        changes: JenaTriggerEnablementChange[]
        knownRevision?: string
      }
      response: JenaUserTriggerUpdate
    }
    setTriggerFlags: {
      request: {
        changes: JenaTriggerFlagChange[]
        knownRevision?: string
      }
      response: JenaUserTriggerUpdate
    }
    fetchTriggers: {
      request: Record<string, never>
      response: {
        records: JenaUserTriggerFetchResponse['records']
        revision: string
      }
    }
    ping: {
      request: {
        knownRevision?: string
      }
      response: {
        revision: string
      }
    }
  }
}

export interface RpcRequestPayload<
  TMethod extends string = string,
  TParams = unknown,
> {
  method: TMethod
  params: TParams
}

export type RpcResponsePayload<TResult = unknown> =
  | {
      ok: true
      result: TResult
    }
  | {
      ok: false
      error: SerializedError
    }

export interface SerializedError {
  name?: string
  message: string
  stack?: string
}

export type EndpointPayload<TDestination extends string> =
  TDestination extends keyof EndpointMessages
    ? EndpointMessages[TDestination]
    : unknown

export type RpcMethod<TEndpoint extends keyof RpcEndpoints> =
  keyof RpcEndpoints[TEndpoint] & string

export type RpcRequest<
  TEndpoint extends keyof RpcEndpoints,
  TMethod extends RpcMethod<TEndpoint>,
> = RpcEndpoints[TEndpoint][TMethod] extends { request: infer TRequest }
  ? TRequest
  : never

export type RpcResponse<
  TEndpoint extends keyof RpcEndpoints,
  TMethod extends RpcMethod<TEndpoint>,
> = RpcEndpoints[TEndpoint][TMethod] extends { response: infer TResponse }
  ? TResponse
  : never

export const WorkerEndpointPrefix = 'worker.'
export const ServerEndpointPrefix = 'server.'
export const ClientEndpointPrefix = 'client.'

export function createBusMessage<TPayload>({
  correlationId,
  destination,
  payload,
  source,
}: {
  correlationId?: string
  destination: Endpoint
  payload: TPayload
  source: Endpoint | null
}): BusMessage<TPayload> {
  return {
    id: createMessageId(),
    ...(correlationId ? { correlationId } : {}),
    destination,
    payload,
    source,
  }
}

export function createMessageId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function isBusMessage(value: unknown): value is BusMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<BusMessage>

  return (
    typeof candidate.id === 'string' &&
    (candidate.source === null || typeof candidate.source === 'string') &&
    typeof candidate.destination === 'string' &&
    (candidate.correlationId === undefined ||
      typeof candidate.correlationId === 'string') &&
    'payload' in candidate
  )
}

export function isRpcRequestPayload(
  value: unknown,
): value is RpcRequestPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RpcRequestPayload>

  return typeof candidate.method === 'string' && 'params' in candidate
}

export function isRpcResponsePayload(
  value: unknown,
): value is RpcResponsePayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<RpcResponsePayload>

  if (candidate.ok === true) {
    return 'result' in candidate
  }

  if (candidate.ok === false) {
    return isSerializedError(candidate.error)
  }

  return false
}

export function isRpcRequestMessage(
  message: BusMessage,
): message is BusMessage<RpcRequestPayload> {
  return (
    typeof message.correlationId === 'string' &&
    message.source !== null &&
    isRpcRequestPayload(message.payload)
  )
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  }

  return {
    message: String(error),
  }
}

export function stripWorkerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(WorkerEndpointPrefix)
    ? endpoint.slice(WorkerEndpointPrefix.length)
    : endpoint
}

export function addWorkerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(WorkerEndpointPrefix)
    ? endpoint
    : `${WorkerEndpointPrefix}${endpoint}`
}

export function stripServerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(ServerEndpointPrefix)
    ? endpoint.slice(ServerEndpointPrefix.length)
    : endpoint
}

export function addServerEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(ServerEndpointPrefix)
    ? endpoint
    : `${ServerEndpointPrefix}${endpoint}`
}

export function stripClientEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(ClientEndpointPrefix)
    ? endpoint.slice(ClientEndpointPrefix.length)
    : endpoint
}

export function addClientEndpointPrefix(endpoint: Endpoint) {
  return endpoint.startsWith(ClientEndpointPrefix)
    ? endpoint
    : `${ClientEndpointPrefix}${endpoint}`
}

function isSerializedError(value: unknown): value is SerializedError {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SerializedError>

  return (
    typeof candidate.message === 'string' &&
    (candidate.name === undefined || typeof candidate.name === 'string') &&
    (candidate.stack === undefined || typeof candidate.stack === 'string')
  )
}

import type { RegexPatternRegistration } from '../shared/messages'
import type { EverQuestLogLineRecord } from './FileWatcher'
import type { MatchWorkerMatch } from './MatchWorkerEngine'

export type MatchWorkerRequest =
  | {
      method: 'addPatterns'
      namespace: string
      patterns: RegexPatternRegistration[]
    }
  | {
      method: 'flush'
    }
  | {
      method: 'matchLines'
      records: EverQuestLogLineRecord[]
    }
  | {
      method: 'replacePatterns'
      namespace: string
      patterns: RegexPatternRegistration[]
    }

export interface MatchWorkerRequestMessage {
  id: string
  request: MatchWorkerRequest
  type: 'request'
}

export type MatchWorkerResponseMessage =
  | {
      id: string
      result: MatchWorkerResponse
      type: 'response'
      ok: true
    }
  | {
      error: SerializedMatchWorkerError
      id: string
      type: 'response'
      ok: false
    }

export type MatchWorkerResponse =
  | {
      matches: MatchWorkerMatch[]
      method: 'matchLines'
    }
  | {
      method: 'addPatterns' | 'flush' | 'replacePatterns'
    }

export interface SerializedMatchWorkerError {
  message: string
  name?: string
  stack?: string
}

export function isMatchWorkerResponseMessage(
  value: unknown,
): value is MatchWorkerResponseMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<MatchWorkerResponseMessage>

  return (
    candidate.type === 'response' &&
    typeof candidate.id === 'string' &&
    typeof candidate.ok === 'boolean'
  )
}

export function serializeMatchWorkerError(
  error: unknown,
): SerializedMatchWorkerError {
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

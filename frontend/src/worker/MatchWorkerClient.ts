import type { RegexPatternRegistration } from '../shared/messages'
import { createMessageId } from '../shared/messages'
import type { EverQuestLogLineRecord } from './FileWatcher'
import type { MatchWorkerMatch } from './MatchWorkerEngine'
import type {
  MatchWorkerRequest,
  MatchWorkerResponse,
} from './matchWorkerProtocol'
import { isMatchWorkerResponseMessage } from './matchWorkerProtocol'

export const defaultMatchWorkerCount = 8

interface PendingRequest {
  reject(error: Error): void
  resolve(response: MatchWorkerResponse): void
}

export interface MatchWorkerClientLike {
  addPatterns(
    namespace: string,
    patterns: RegexPatternRegistration[],
  ): Promise<void>
  dispose(): void
  flush(): Promise<void>
  matchLine(record: EverQuestLogLineRecord): Promise<MatchWorkerMatch[]>
  replacePatterns(
    namespace: string,
    patterns: RegexPatternRegistration[],
  ): Promise<void>
}

export class MatchWorkerClientFactory {
  createClients(count = defaultMatchWorkerCount): MatchWorkerClientLike[] {
    return Array.from({ length: count }, (_value, index) => {
      return new MatchWorkerClient(index)
    })
  }
}

class MatchWorkerClient implements MatchWorkerClientLike {
  private readonly index: number
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly worker: Worker

  constructor(index: number) {
    this.index = index
    this.worker = new Worker(new URL('./MatchWorker.ts', import.meta.url), {
      name: `jena-match-worker-${index}`,
      type: 'module',
    })
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
    this.worker.addEventListener('messageerror', this.handleError)
  }

  addPatterns(namespace: string, patterns: RegexPatternRegistration[]) {
    return this.call({ method: 'addPatterns', namespace, patterns }).then(
      () => undefined,
    )
  }

  replacePatterns(namespace: string, patterns: RegexPatternRegistration[]) {
    return this.call({ method: 'replacePatterns', namespace, patterns }).then(
      () => undefined,
    )
  }

  flush() {
    return this.call({ method: 'flush' }).then(() => undefined)
  }

  async matchLine(record: EverQuestLogLineRecord) {
    const response = await this.call({ method: 'matchLine', record })

    if (response.method !== 'matchLine') {
      throw new Error(
        `Match worker ${this.index} returned ${response.method} for matchLine.`,
      )
    }

    return response.matches
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.removeEventListener('messageerror', this.handleError)
    this.worker.terminate()

    const error = new Error(`Match worker ${this.index} was disposed.`)
    this.pendingRequests.forEach((request) => {
      request.reject(error)
    })
    this.pendingRequests.clear()
  }

  private call(request: MatchWorkerRequest) {
    const id = createMessageId()
    const message = {
      id,
      request,
      type: 'request',
    } as const

    return new Promise<MatchWorkerResponse>((resolve, reject) => {
      this.pendingRequests.set(id, { reject, resolve })
      this.worker.postMessage(message)
    })
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    const response = event.data

    if (!isMatchWorkerResponseMessage(response)) {
      return
    }

    const pendingRequest = this.pendingRequests.get(response.id)
    if (!pendingRequest) {
      return
    }

    this.pendingRequests.delete(response.id)

    if (response.ok) {
      pendingRequest.resolve(response.result)
      return
    }

    pendingRequest.reject(createRemoteError(response.error))
  }

  private readonly handleError = (event: ErrorEvent | MessageEvent) => {
    const error =
      'message' in event && event.message
        ? new Error(event.message)
        : new Error(`Match worker ${this.index} failed.`)

    this.pendingRequests.forEach((request) => {
      request.reject(error)
    })
    this.pendingRequests.clear()
  }
}

function createRemoteError(error: { message: string; name?: string }) {
  const remoteError = new Error(error.message)
  remoteError.name = error.name ?? 'Error'
  return remoteError
}

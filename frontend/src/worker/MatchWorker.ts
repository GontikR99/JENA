import { MatchWorkerEngine } from './MatchWorkerEngine'
import type {
  MatchWorkerRequestMessage,
  MatchWorkerResponse,
} from './matchWorkerProtocol'
import { serializeMatchWorkerError } from './matchWorkerProtocol'

const workerScope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void
  postMessage(message: unknown): void
}

const workerName =
  (globalThis as unknown as { name?: string }).name ?? 'subworker'
const engine = new MatchWorkerEngine(workerName)

workerScope.addEventListener('message', (event) => {
  void handleMessage(event.data)
})

async function handleMessage(message: unknown) {
  if (!isMatchWorkerRequestMessage(message)) {
    return
  }

  try {
    const result = await handleRequest(message)

    workerScope.postMessage({
      id: message.id,
      ok: true,
      result,
      type: 'response',
    })
  } catch (error) {
    workerScope.postMessage({
      error: serializeMatchWorkerError(error),
      id: message.id,
      ok: false,
      type: 'response',
    })
  }
}

async function handleRequest(
  message: MatchWorkerRequestMessage,
): Promise<MatchWorkerResponse> {
  const { request } = message

  switch (request.method) {
    case 'addPatterns':
      engine.addPatterns(request.namespace, request.patterns)
      return { method: request.method }

    case 'replacePatterns':
      engine.replacePatterns(request.namespace, request.patterns)
      return { method: request.method }

    case 'flush':
      await engine.flush()
      return { method: request.method }

    case 'matchLines':
      return {
        matches: await engine.matchLines(request.records),
        method: request.method,
      }
  }
}

function isMatchWorkerRequestMessage(
  value: unknown,
): value is MatchWorkerRequestMessage {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<MatchWorkerRequestMessage>

  return (
    candidate.type === 'request' &&
    typeof candidate.id === 'string' &&
    !!candidate.request &&
    typeof candidate.request === 'object' &&
    'method' in candidate.request
  )
}

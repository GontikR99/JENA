import { clipboard } from 'electron'
import type { MessageBroker } from '../bus/messageBroker'
import type { Disposable } from '../di'

const maxClipboardTextLength = 256 * 1024

export class ClipboardService implements Disposable {
  private readonly unregister: Array<() => void>

  constructor(broker: MessageBroker) {
    this.unregister = [
      broker.register('clipboard', {
        writeText: this.writeText,
      }),
      broker.listen('clipboard.write-text', (message) => {
        const request = parseWriteTextRequest(message.payload)

        console.log(
          `[ClipboardService] clipboard write requested source=${message.source ?? ''} length=${request.text.length}`,
        )
        clipboard.writeText(request.text)
      }),
    ]
  }

  dispose() {
    this.unregister.forEach((unregister) => {
      unregister()
    })
  }

  private readonly writeText = async (params: unknown) => {
    const request = parseWriteTextRequest(params)

    console.log(
      `[ClipboardService] clipboard write RPC requested length=${request.text.length}`,
    )
    clipboard.writeText(request.text)

    return {}
  }
}

function parseWriteTextRequest(params: unknown) {
  if (!params || typeof params !== 'object') {
    throw new Error('clipboard.writeText requires a request object.')
  }

  const candidate = params as Partial<{ text: unknown }>
  if (typeof candidate.text !== 'string') {
    throw new Error('clipboard.writeText requires text.')
  }
  if (candidate.text.length === 0) {
    throw new Error('clipboard.writeText requires non-empty text.')
  }
  if (candidate.text.length > maxClipboardTextLength) {
    throw new Error('clipboard.writeText text is too large.')
  }

  return {
    text: candidate.text,
  }
}

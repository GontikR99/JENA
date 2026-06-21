import { app } from 'electron'
import type { MessageBroker } from '../bus/messageBroker'
import type { Disposable } from '../di'

export const companionProtocolVersion = 1

export class StatusService implements Disposable {
  private readonly unregister: () => void

  constructor(broker: MessageBroker) {
    this.unregister = broker.register('status', {
      getStatus: async () => ({
        appName: app.getName(),
        capabilities: ['clipboard'],
        protocolVersion: companionProtocolVersion,
        version: app.getVersion(),
      }),
    })
  }

  dispose() {
    this.unregister()
  }
}

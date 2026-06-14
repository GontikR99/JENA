import { MessageBroker as SharedMessageBroker } from '../shared/messageBroker'
import { WorkerMessageBus } from './MessageBus'
import { getDependency, type Deps } from './di'

export class MessageBroker extends SharedMessageBroker {
  constructor(deps: Deps) {
    super(getDependency(deps, WorkerMessageBus))
  }
}

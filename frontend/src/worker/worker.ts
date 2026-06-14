import { createDeps, install } from './di'
import { FileWatcher } from './FileWatcher'
import { MessageBroker } from './MessageBroker'
import { WorkerMessageBus } from './MessageBus'

const deps = createDeps()

install(deps, WorkerMessageBus)
install(deps, MessageBroker)
install(deps, FileWatcher)

import { createDeps, install } from './di'
import { CharacterPresenceService } from './CharacterPresenceService'
import { FileWatcher } from './FileWatcher'
import { MatchWorkerClientFactory } from './MatchWorkerClient'
import { MatcherService } from './MatcherService'
import { MessageBroker } from './MessageBroker'
import { WorkerMessageBus } from './MessageBus'

const deps = createDeps()

install(deps, WorkerMessageBus)
install(deps, MessageBroker)
install(deps, FileWatcher)
install(deps, MatchWorkerClientFactory)
install(deps, MatcherService)
install(deps, CharacterPresenceService)

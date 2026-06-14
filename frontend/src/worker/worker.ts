import { createDeps, install } from './di'
import { CharacterPresenceService } from './CharacterPresenceService'
import { FileWatcher } from './FileWatcher'
import { MatcherService } from './MatcherService'
import { MessageBroker } from './MessageBroker'
import { WorkerMessageBus } from './MessageBus'

const deps = createDeps()

install(deps, WorkerMessageBus)
install(deps, MessageBroker)
install(deps, FileWatcher)
install(deps, MatcherService)
install(deps, CharacterPresenceService)

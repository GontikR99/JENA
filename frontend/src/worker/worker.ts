import { createDeps, install, type Deps } from './di'
import { ClientEventBus } from './ClientEventBus'

const deps = createDeps()

class WorkerLifecycleTask {
  readonly deps: Deps

  constructor(deps: Deps) {
    this.deps = deps
  }
}

install(deps, ClientEventBus)
install(deps, WorkerLifecycleTask)

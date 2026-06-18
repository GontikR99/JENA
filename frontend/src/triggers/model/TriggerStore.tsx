import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import ProgressBar from 'react-bootstrap/ProgressBar'
import { useRpc, useSender } from '../../shared/messageBrokerHooks'
import {
  withCanonicalTriggerId,
  type JenaTrigger,
  type JenaTriggerId,
} from '../../shared/triggers'
import './TriggerStore.css'

export interface TriggerStoreApi {
  fetchTriggers: (ids: JenaTriggerId[]) => Promise<JenaTrigger[]>
  storeTriggers: (triggers: JenaTrigger[]) => Promise<JenaTrigger[]>
}

export type SeenTriggersPublisher = (triggers: JenaTrigger[]) => void
export type TriggerStoreProgressReporter = (
  progress: TriggerStoreProgress | null,
) => void

export interface TriggerStoreProgress {
  completedCount: number
  phase: 'loading' | 'saving'
  totalCount: number
}

interface ServerTriggerStoreApi {
  checkTriggers: (ids: JenaTriggerId[]) => Promise<CheckTriggersResult>
  fetchTriggers: (ids: JenaTriggerId[]) => Promise<FetchTriggersResult>
  storeTriggers: (triggers: JenaTrigger[]) => Promise<JenaTrigger[]>
}

interface CheckTriggersResult {
  missingIds: JenaTriggerId[]
}

interface FetchTriggersResult {
  partial: boolean
  triggers: JenaTrigger[]
}

interface TriggerCache {
  getTriggers: (
    ids: JenaTriggerId[],
  ) => Promise<Map<JenaTriggerId, JenaTrigger>>
  putTriggers: (triggers: JenaTrigger[]) => Promise<void>
}

const databaseName = 'jena'
const databaseVersion = 4
const handlesStoreName = 'handles'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const settingsStoreName = 'settings'
const storeTriggerBatchSize = 100

const TriggerStoreContext = createContext<TriggerStoreApi | null>(null)

export function TriggerStoreProvider({ children }: { children: ReactNode }) {
  const call = useRpc('trigger-store')
  const send = useSender('trigger-store')
  const [storeProgress, setStoreProgress] =
    useState<TriggerStoreProgress | null>(null)
  const store = useMemo(() => {
    return new WriteThroughTriggerStore(
      {
        checkTriggers: async (ids) => {
          const response = await call('server.trigger-store', 'checkTriggers', {
            ids,
          })

          return response
        },
        fetchTriggers: async (ids) => {
          const response = await call('server.trigger-store', 'fetchTriggers', {
            ids,
          })

          return response
        },
        storeTriggers: async (triggers) => {
          const response = await call('server.trigger-store', 'storeTriggers', {
            triggers,
          })

          return response.triggers
        },
      },
      new IndexedDBTriggerCache(),
      (triggers) => {
        send('trigger-store.triggers-seen', { triggers })
      },
      setStoreProgress,
    )
  }, [call, send, setStoreProgress])

  return (
    <TriggerStoreContext.Provider value={store}>
      {children}
      <TriggerStoreProgressGlass progress={storeProgress} />
    </TriggerStoreContext.Provider>
  )
}

export function useTriggerStore() {
  const store = useContext(TriggerStoreContext)
  if (!store) {
    throw new Error('useTriggerStore must be used within TriggerStoreProvider')
  }

  return store
}

export class WriteThroughTriggerStore implements TriggerStoreApi {
  private readonly cachedTriggers = new Map<JenaTriggerId, JenaTrigger>()
  private readonly cache: TriggerCache
  private readonly handledTriggerIds = new Set<JenaTriggerId>()
  private readonly pendingFetches = new Map<JenaTriggerId, Promise<JenaTrigger>>()
  private readonly pendingStores = new Map<JenaTriggerId, Promise<JenaTrigger>>()
  private readonly publishSeenTriggers: SeenTriggersPublisher
  private readonly reportStoreProgress: TriggerStoreProgressReporter
  private readonly server: ServerTriggerStoreApi
  private storeProgressToken = 0

  constructor(
    server: ServerTriggerStoreApi,
    cache: TriggerCache,
    publishSeenTriggers: SeenTriggersPublisher = () => undefined,
    reportStoreProgress: TriggerStoreProgressReporter = () => undefined,
  ) {
    this.server = server
    this.cache = cache
    this.publishSeenTriggers = publishSeenTriggers
    this.reportStoreProgress = reportStoreProgress
  }

  async storeTriggers(triggers: JenaTrigger[]) {
    if (triggers.length === 0) {
      return []
    }

    const canonicalTriggers = triggers.map(withCanonicalTriggerId)
    const triggersById = new Map<JenaTriggerId, JenaTrigger>()
    const pendingTriggers = new Map<JenaTriggerId, Promise<JenaTrigger>>()

    canonicalTriggers.forEach((trigger) => {
      const pendingStore = this.pendingStores.get(trigger.id)
      if (pendingStore) {
        pendingTriggers.set(trigger.id, pendingStore)
        return
      }

      triggersById.set(trigger.id, trigger)
    })

    const storePromise =
      triggersById.size > 0
        ? this.storeMissingTriggers([...triggersById.values()])
        : Promise.resolve(new Map<JenaTriggerId, JenaTrigger>())

    const storedTriggers = await storePromise
    const pendingStoredTriggers = await resolvePendingTriggers(pendingTriggers)

    const resolvedTriggers = canonicalTriggers.map((trigger) => {
      return (
        storedTriggers.get(trigger.id) ??
        pendingStoredTriggers.get(trigger.id) ??
        this.cachedTriggers.get(trigger.id) ??
        trigger
      )
    })

    this.cacheTriggers(resolvedTriggers)
    this.markHandledTriggers(resolvedTriggers)
    return resolvedTriggers
  }

  async fetchTriggers(ids: JenaTriggerId[]) {
    if (ids.length === 0) {
      return []
    }

    const cachedResults = new Map<JenaTriggerId, JenaTrigger>()
    const pendingTriggers = new Map<JenaTriggerId, Promise<JenaTrigger>>()
    const missingIds = new Set<JenaTriggerId>()
    const persistedTriggers = await this.getCachedTriggers(ids)

    ids.forEach((id) => {
      const cachedTrigger = persistedTriggers.get(id)
      if (cachedTrigger) {
        cachedResults.set(id, cachedTrigger)
        return
      }

      const pendingFetch = this.pendingFetches.get(id)
      if (pendingFetch) {
        pendingTriggers.set(id, pendingFetch)
        return
      }

      missingIds.add(id)
    })

    const fetchedMissingTriggers =
      missingIds.size > 0
        ? await this.fetchMissingTriggers([...missingIds])
        : new Map<JenaTriggerId, JenaTrigger>()
    const pendingFetchedTriggers = await resolvePendingTriggers(pendingTriggers)

    const allTriggers = new Map<JenaTriggerId, JenaTrigger>([
      ...cachedResults,
      ...fetchedMissingTriggers,
      ...pendingFetchedTriggers,
    ])
    const unresolvedIds = ids.filter((id) => !allTriggers.has(id))

    if (unresolvedIds.length > 0) {
      throw new Error(`Missing triggers: ${unresolvedIds.join(', ')}`)
    }

    const resolvedTriggers = ids.map((id) => allTriggers.get(id) as JenaTrigger)
    this.markHandledTriggers(resolvedTriggers)
    return resolvedTriggers
  }

  private async storeMissingTriggers(triggers: JenaTrigger[]) {
    const response = await this.server.checkTriggers(
      triggers.map((trigger) => trigger.id),
    )
    const missingIds = new Set(response.missingIds)
    const missingTriggers = triggers.filter((trigger) => missingIds.has(trigger.id))

    if (missingTriggers.length === 0) {
      return new Map<JenaTriggerId, JenaTrigger>()
    }

    if (missingTriggers.length <= storeTriggerBatchSize) {
      return await this.storeTriggersOnServer(missingTriggers)
    }

    const progressToken = ++this.storeProgressToken
    const storedTriggers = new Map<JenaTriggerId, JenaTrigger>()
    let completedCount = 0

    try {
      this.reportStoreProgress({
        completedCount,
        phase: 'saving',
        totalCount: missingTriggers.length,
      })

      for (const chunk of chunkArray(missingTriggers, storeTriggerBatchSize)) {
        const storedChunk = await this.storeTriggersOnServer(chunk)
        storedChunk.forEach((trigger, triggerId) => {
          storedTriggers.set(triggerId, trigger)
        })
        completedCount += chunk.length
        this.reportStoreProgress({
          completedCount,
          phase: 'saving',
          totalCount: missingTriggers.length,
        })
      }
    } finally {
      if (progressToken === this.storeProgressToken) {
        this.reportStoreProgress(null)
      }
    }

    return storedTriggers
  }

  private async storeTriggersOnServer(triggers: JenaTrigger[]) {
    const pendingStore = this.server
      .storeTriggers(triggers)
      .then((storedTriggers) => {
        const cachedTriggers = this.cacheReturnedTriggers(triggers, storedTriggers)
        this.markHandledTriggers(cachedTriggers.values())
        return cachedTriggers
      })

    triggers.forEach((trigger) => {
      const pendingTrigger = pendingStore.then((storedTriggers) => {
        return storedTriggers.get(trigger.id) as JenaTrigger
      })

      pendingTrigger.catch(() => undefined)
      this.pendingStores.set(trigger.id, pendingTrigger)
    })

    try {
      return await pendingStore
    } finally {
      triggers.forEach((trigger) => {
        this.pendingStores.delete(trigger.id)
      })
    }
  }

  private async fetchMissingTriggers(ids: JenaTriggerId[]) {
    const pendingFetch = this.fetchMissingTriggersFromServer(ids)
      .then((fetchedTriggers) => {
        const cachedTriggers = this.cacheReturnedTriggersByIDs(ids, fetchedTriggers)
        this.markHandledTriggers(cachedTriggers.values())
        return cachedTriggers
      })

    ids.forEach((id) => {
      const pendingTrigger = pendingFetch.then((fetchedTriggers) => {
        return fetchedTriggers.get(id) as JenaTrigger
      })

      pendingTrigger.catch(() => undefined)
      this.pendingFetches.set(id, pendingTrigger)
    })

    try {
      return await pendingFetch
    } finally {
      ids.forEach((id) => {
        this.pendingFetches.delete(id)
      })
    }
  }

  private async fetchMissingTriggersFromServer(ids: JenaTriggerId[]) {
    const fetchedTriggers: JenaTrigger[] = []
    const fetchedIds = new Set<JenaTriggerId>()
    let progressToken: number | null = null
    let remainingIds = [...ids]

    try {
      while (remainingIds.length > 0) {
        const response = await this.server.fetchTriggers(remainingIds)
        const novelTriggers = response.triggers.filter((trigger) => {
          const canonicalTrigger = withCanonicalTriggerId(trigger)

          return !fetchedIds.has(canonicalTrigger.id)
        })

        novelTriggers.forEach((trigger) => {
          const canonicalTrigger = withCanonicalTriggerId(trigger)
          fetchedIds.add(canonicalTrigger.id)
          fetchedTriggers.push(canonicalTrigger)
        })

        if (response.partial || progressToken !== null) {
          if (progressToken === null) {
            progressToken = ++this.storeProgressToken
          }
          this.reportStoreProgress({
            completedCount: fetchedIds.size,
            phase: 'loading',
            totalCount: ids.length,
          })
        }

        if (!response.partial) {
          break
        }
        if (novelTriggers.length === 0) {
          throw new Error('Partial trigger fetch made no progress.')
        }

        remainingIds = remainingIds.filter((id) => !fetchedIds.has(id))
      }
    } finally {
      if (progressToken !== null && progressToken === this.storeProgressToken) {
        this.reportStoreProgress(null)
      }
    }

    return fetchedTriggers
  }

  private cacheReturnedTriggers(
    requestedTriggers: JenaTrigger[],
    returnedTriggers: JenaTrigger[],
  ) {
    const returnedByID = new Map<JenaTriggerId, JenaTrigger>()

    returnedTriggers.forEach((trigger) => {
      const canonicalTrigger = withCanonicalTriggerId(trigger)
      returnedByID.set(canonicalTrigger.id, canonicalTrigger)
      this.cachedTriggers.set(canonicalTrigger.id, canonicalTrigger)
    })

    const missingIds = requestedTriggers
      .map((trigger) => trigger.id)
      .filter((id) => !returnedByID.has(id))

    if (missingIds.length > 0) {
      throw new Error(`Missing triggers: ${missingIds.join(', ')}`)
    }

    this.persistTriggers([...returnedByID.values()])

    return returnedByID
  }

  private cacheReturnedTriggersByIDs(
    requestedIDs: JenaTriggerId[],
    returnedTriggers: JenaTrigger[],
  ) {
    const returnedByID = new Map<JenaTriggerId, JenaTrigger>()

    returnedTriggers.forEach((trigger) => {
      const canonicalTrigger = withCanonicalTriggerId(trigger)
      returnedByID.set(canonicalTrigger.id, canonicalTrigger)
      this.cachedTriggers.set(canonicalTrigger.id, canonicalTrigger)
    })

    const missingIds = requestedIDs.filter((id) => !returnedByID.has(id))
    if (missingIds.length > 0) {
      throw new Error(`Missing triggers: ${missingIds.join(', ')}`)
    }

    this.persistTriggers([...returnedByID.values()])

    return returnedByID
  }

  private async getCachedTriggers(ids: JenaTriggerId[]) {
    const cachedTriggers = new Map<JenaTriggerId, JenaTrigger>()
    const missingMemoryIds: JenaTriggerId[] = []

    ids.forEach((id) => {
      const cachedTrigger = this.cachedTriggers.get(id)
      if (cachedTrigger) {
        cachedTriggers.set(id, cachedTrigger)
        return
      }

      missingMemoryIds.push(id)
    })

    if (missingMemoryIds.length === 0) {
      return cachedTriggers
    }

    const persistedTriggers = await this.cache
      .getTriggers(missingMemoryIds)
      .catch((error: unknown) => {
        console.warn('[TriggerStore] unable to read trigger cache', error)

        return new Map<JenaTriggerId, JenaTrigger>()
      })
    persistedTriggers.forEach((trigger, id) => {
      cachedTriggers.set(id, trigger)
      this.cachedTriggers.set(id, trigger)
    })
    this.markHandledTriggers(persistedTriggers.values())

    return cachedTriggers
  }

  private persistTriggers(triggers: JenaTrigger[]) {
    void this.cache.putTriggers(triggers).catch((error: unknown) => {
      console.warn('[TriggerStore] unable to write trigger cache', error)
    })
  }

  private cacheTriggers(triggers: JenaTrigger[]) {
    const canonicalTriggers = triggers.map(withCanonicalTriggerId)

    canonicalTriggers.forEach((trigger) => {
      this.cachedTriggers.set(trigger.id, trigger)
    })
    this.persistTriggers(canonicalTriggers)
  }

  private markHandledTriggers(triggers: Iterable<JenaTrigger>) {
    const newlySeenTriggers: JenaTrigger[] = []

    for (const trigger of triggers) {
      const canonicalTrigger = withCanonicalTriggerId(trigger)
      if (this.handledTriggerIds.has(canonicalTrigger.id)) {
        continue
      }

      this.handledTriggerIds.add(canonicalTrigger.id)
      newlySeenTriggers.push(canonicalTrigger)
    }

    if (newlySeenTriggers.length > 0) {
      this.publishSeenTriggers(newlySeenTriggers)
    }
  }
}

function TriggerStoreProgressGlass({
  progress,
}: {
  progress: TriggerStoreProgress | null
}) {
  if (!progress) {
    return null
  }

  const progressPercent =
    progress.totalCount > 0
      ? Math.round((progress.completedCount / progress.totalCount) * 100)
      : 0
  const title = progress.phase === 'saving' ? 'Saving triggers' : 'Loading triggers'

  return (
    <div
      aria-live="polite"
      className="trigger-store-glass"
      role="status"
    >
      <div className="trigger-store-progress-panel">
        <div className="trigger-store-progress-title">{title}</div>
        <div className="trigger-store-progress-status">
          {progress.completedCount} / {progress.totalCount} triggers
        </div>
        <ProgressBar
          animated
          now={progressPercent}
          striped
          variant="success"
        />
      </div>
    </div>
  )
}

function chunkArray<TItem>(items: TItem[], chunkSize: number) {
  const chunks: TItem[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

async function resolvePendingTriggers(
  pendingTriggers: Map<JenaTriggerId, Promise<JenaTrigger>>,
) {
  const resolvedTriggers = new Map<JenaTriggerId, JenaTrigger>()

  await Promise.all(
    [...pendingTriggers].map(async ([id, pendingTrigger]) => {
      resolvedTriggers.set(id, await pendingTrigger)
    }),
  )

  return resolvedTriggers
}

export class InMemoryTriggerCache implements TriggerCache {
  private readonly triggers = new Map<JenaTriggerId, JenaTrigger>()

  async getTriggers(ids: JenaTriggerId[]) {
    return new Map(
      ids.flatMap((id) => {
        const trigger = this.triggers.get(id)

        return trigger ? [[id, trigger] as const] : []
      }),
    )
  }

  async putTriggers(triggers: JenaTrigger[]) {
    triggers.forEach((trigger) => {
      this.triggers.set(trigger.id, trigger)
    })
  }
}

class IndexedDBTriggerCache implements TriggerCache {
  async getTriggers(ids: JenaTriggerId[]) {
    const database = await openDatabase()

    try {
      return await getCachedTriggers(database, ids)
    } finally {
      database.close()
    }
  }

  async putTriggers(triggers: JenaTrigger[]) {
    if (triggers.length === 0) {
      return
    }

    const database = await openDatabase()

    try {
      await putCachedTriggers(database, triggers)
    } finally {
      database.close()
    }
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(handlesStoreName)) {
        database.createObjectStore(handlesStoreName)
      }
      if (!database.objectStoreNames.contains(triggerCacheStoreName)) {
        database.createObjectStore(triggerCacheStoreName)
      }
      if (!database.objectStoreNames.contains(userTriggerCacheStoreName)) {
        database.createObjectStore(userTriggerCacheStoreName)
      }
      if (!database.objectStoreNames.contains(settingsStoreName)) {
        database.createObjectStore(settingsStoreName)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'))
  })
}

function getCachedTriggers(database: IDBDatabase, ids: JenaTriggerId[]) {
  return new Promise<Map<JenaTriggerId, JenaTrigger>>((resolve, reject) => {
    const transaction = database.transaction(triggerCacheStoreName, 'readonly')
    const store = transaction.objectStore(triggerCacheStoreName)
    const triggers = new Map<JenaTriggerId, JenaTrigger>()
    let remaining = ids.length

    if (remaining === 0) {
      resolve(triggers)
      return
    }

    ids.forEach((id) => {
      const request = store.get(id)

      request.onsuccess = () => {
        if (request.result) {
          triggers.set(id, request.result as JenaTrigger)
        }

        remaining -= 1
        if (remaining === 0) {
          resolve(triggers)
        }
      }
      request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    })

    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function putCachedTriggers(database: IDBDatabase, triggers: JenaTrigger[]) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(triggerCacheStoreName, 'readwrite')
    const store = transaction.objectStore(triggerCacheStoreName)

    triggers.forEach((trigger) => {
      store.put(trigger, trigger.id)
    })

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

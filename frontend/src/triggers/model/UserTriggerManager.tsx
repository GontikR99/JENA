import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuthToken } from '../../auth/AuthContext'
import { useListen, useRpc } from '../../shared/messageBrokerHooks'
import { createMessageId, type BusMessage } from '../../shared/messages'
import {
  getJenaCharacterServerKey,
  withCanonicalTriggerId,
  type JenaCharacterServer,
  type JenaExtendedTrigger,
  type JenaResolvedTrigger,
  type JenaTrigger,
  type JenaTriggerEnablementChange,
  type JenaTriggerFlagChange,
  type JenaTriggerId,
  type JenaTriggerUpsert,
  type JenaUserTriggerFetchResponse,
  type JenaUserTriggerUpdate,
} from '../../shared/triggers'
import { useTriggerStore } from './TriggerStore'

const databaseName = 'jena'
const databaseVersion = 3
const handlesStoreName = 'handles'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const loggedOutCacheKey = 'logged-out'
const pingIntervalMs = 10_000

export interface UpsertTriggerOptions {
  deleteTriggerIds?: JenaTriggerId[]
  enabledFor?: JenaCharacterServer[]
}

export interface UpsertTriggersOptions {
  deleteTriggerIds?: JenaTriggerId[]
}

export interface TriggerManagerApi {
  deleteTrigger: (triggerId: JenaTriggerId) => Promise<JenaUserTriggerUpdate>
  deleteTriggers: (triggerIds: JenaTriggerId[]) => Promise<JenaUserTriggerUpdate>
  setTriggerFlags: (
    changes: JenaTriggerFlagChange[],
  ) => Promise<JenaUserTriggerUpdate>
  toggleTriggers: (
    changes: JenaTriggerEnablementChange[],
  ) => Promise<JenaUserTriggerUpdate>
  triggers: JenaResolvedTrigger[]
  upsertTrigger: (
    trigger: JenaTrigger,
    options?: UpsertTriggerOptions,
  ) => Promise<JenaUserTriggerUpdate>
  upsertTriggers: (
    triggers: Array<JenaTrigger | JenaTriggerUpsert>,
    options?: UpsertTriggersOptions,
  ) => Promise<JenaUserTriggerUpdate>
}

interface LocalUserTriggerCache {
  records: JenaExtendedTrigger[]
  revision: string
  triggers: JenaTrigger[]
}

const TriggerManagerContext = createContext<TriggerManagerApi | null>(null)

export function UserTriggerManagerProvider({
  children,
}: {
  children: ReactNode
}) {
  const authToken = useAuthToken()
  const call = useRpc('user-trigger-manager')
  const triggerStore = useTriggerStore()
  const authTokenRef = useRef(authToken)
  const recordsRef = useRef(new Map<JenaTriggerId, JenaExtendedTrigger>())
  const revisionRef = useRef<string | null>(null)
  const triggersByIdRef = useRef(new Map<JenaTriggerId, JenaTrigger>())
  const [triggers, setTriggers] = useState<JenaResolvedTrigger[]>([])

  useEffect(() => {
    authTokenRef.current = authToken
  }, [authToken])

  const publishSnapshot = useCallback(() => {
    setTriggers(getResolvedSnapshot(recordsRef.current, triggersByIdRef.current))
  }, [])

  const replaceState = useCallback(
    async (state: JenaUserTriggerFetchResponse) => {
      recordsRef.current = new Map(
        state.records.map((record) => [record.triggerId, normalizeRecord(record)]),
      )
      triggersByIdRef.current = new Map(
        state.triggers.map((trigger) => {
          const canonicalTrigger = withCanonicalTriggerId(trigger)
          return [canonicalTrigger.id, canonicalTrigger]
        }),
      )
      revisionRef.current = state.revision

      if (state.triggers.length > 0) {
        await triggerStore.storeTriggers(state.triggers)
      }

      publishSnapshot()
    },
    [publishSnapshot, triggerStore],
  )

  const applyUpdate = useCallback(
    async (update: JenaUserTriggerUpdate) => {
      update.deletedTriggerIds.forEach((triggerId) => {
        recordsRef.current.delete(triggerId)
      })

      update.upsertedTriggers.forEach((trigger) => {
        const canonicalTrigger = withCanonicalTriggerId(trigger)
        triggersByIdRef.current.set(canonicalTrigger.id, canonicalTrigger)
      })
      update.upsertedRecords.forEach((record) => {
        recordsRef.current.set(record.triggerId, normalizeRecord(record))
      })
      revisionRef.current = update.revision

      if (update.upsertedTriggers.length > 0) {
        await triggerStore.storeTriggers(update.upsertedTriggers)
      }

      publishSnapshot()
    },
    [publishSnapshot, triggerStore],
  )

  const loadLocalState = useCallback(async () => {
    const cache = await readLocalUserTriggerCache()
    await replaceState({
      records: cache?.records ?? [],
      revision: cache?.revision ?? createMessageId(),
      triggers: cache?.triggers ?? [],
    })
  }, [replaceState])

  const fetchServerState = useCallback(async () => {
    const state = await call(
      'server.user-trigger-store',
      'fetchTriggers',
      {},
    )
    await replaceState(state)
  }, [call, replaceState])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (authToken) {
        await fetchServerState()
      } else {
        await loadLocalState()
      }

      if (cancelled) {
        return
      }

      publishSnapshot()
    })().catch((error: unknown) => {
      console.warn('[UserTriggerManager] failed to load triggers', error)
    })

    return () => {
      cancelled = true
    }
  }, [authToken, fetchServerState, loadLocalState, publishSnapshot])

  useEffect(() => {
    if (!authToken) {
      return
    }

    const intervalId = globalThis.setInterval(() => {
      void call('server.user-trigger-store', 'ping', {
        knownRevision: revisionRef.current ?? undefined,
      })
        .then((response) => {
          if (response.revision !== revisionRef.current) {
            return fetchServerState()
          }

          return undefined
        })
        .catch((error: unknown) => {
          console.warn('[UserTriggerManager] ping failed', error)
        })
    }, pingIntervalMs)

    return () => {
      globalThis.clearInterval(intervalId)
    }
  }, [authToken, call, fetchServerState])

  useListen('user-trigger-store.updated', (message: BusMessage) => {
    if (!authTokenRef.current) {
      return
    }

    void applyUpdate(message.payload as JenaUserTriggerUpdate).catch(
      (error: unknown) => {
        console.warn('[UserTriggerManager] update failed', error)
      },
    )
  })

  const persistLocalState = useCallback(async () => {
    await writeLocalUserTriggerCache({
      records: [...recordsRef.current.values()],
      revision: revisionRef.current ?? createMessageId(),
      triggers: [...triggersByIdRef.current.values()],
    })
  }, [])

  const upsertTriggers = useCallback(
    async (
      triggerInputs: Array<JenaTrigger | JenaTriggerUpsert>,
      options: UpsertTriggersOptions = {},
    ) => {
      const upserts = normalizeUpsertInputs(triggerInputs)

      if (authTokenRef.current) {
        const update = await call('server.user-trigger-store', 'upsertTriggers', {
          deleteTriggerIds: options.deleteTriggerIds,
          knownRevision: revisionRef.current ?? undefined,
          triggers: upserts,
        })
        await applyUpdate(update)
        return update
      }

      const update = applyLocalUpsert(
        recordsRef.current,
        triggersByIdRef.current,
        upserts,
        options.deleteTriggerIds ?? [],
      )
      await applyUpdate(update)
      await persistLocalState()
      return update
    },
    [applyUpdate, call, persistLocalState],
  )

  const upsertTrigger = useCallback(
    async (trigger: JenaTrigger, options: UpsertTriggerOptions = {}) => {
      return await upsertTriggers(
        [
          {
            enabledFor: options.enabledFor,
            trigger,
          },
        ],
        {
          deleteTriggerIds: options.deleteTriggerIds,
        },
      )
    },
    [upsertTriggers],
  )

  const deleteTriggers = useCallback(
    async (triggerIds: JenaTriggerId[]) => {
      if (authTokenRef.current) {
        const update = await call('server.user-trigger-store', 'deleteTriggers', {
          knownRevision: revisionRef.current ?? undefined,
          triggerIds,
        })
        await applyUpdate(update)
        return update
      }

      const update = applyLocalDelete(triggerIds)
      await applyUpdate(update)
      await persistLocalState()
      return update
    },
    [applyUpdate, call, persistLocalState],
  )

  const deleteTrigger = useCallback(
    async (triggerId: JenaTriggerId) => {
      return await deleteTriggers([triggerId])
    },
    [deleteTriggers],
  )

  const toggleTriggers = useCallback(
    async (changes: JenaTriggerEnablementChange[]) => {
      if (authTokenRef.current) {
        const update = await call('server.user-trigger-store', 'toggleTriggers', {
          changes,
          knownRevision: revisionRef.current ?? undefined,
        })
        await applyUpdate(update)
        return update
      }

      const update = applyLocalToggle(changes)
      await applyUpdate(update)
      await persistLocalState()
      return update
    },
    [applyUpdate, call, persistLocalState],
  )

  const setTriggerFlags = useCallback(
    async (changes: JenaTriggerFlagChange[]) => {
      if (authTokenRef.current) {
        const update = await call('server.user-trigger-store', 'setTriggerFlags', {
          changes,
          knownRevision: revisionRef.current ?? undefined,
        })
        await applyUpdate(update)
        return update
      }

      const update = applyLocalFlagChanges(changes, false)
      await applyUpdate(update)
      await persistLocalState()
      return update
    },
    [applyUpdate, call, persistLocalState],
  )

  function applyLocalDelete(triggerIds: JenaTriggerId[]): JenaUserTriggerUpdate {
    const deletedTriggerIds = [...new Set(triggerIds)]
    const revision = createMessageId()

    revisionRef.current = revision

    return {
      deletedTriggerIds,
      revision,
      upsertedRecords: [],
      upsertedTriggers: [],
    }
  }

  function applyLocalToggle(
    changes: JenaTriggerEnablementChange[],
  ): JenaUserTriggerUpdate {
    const updatedIds = new Set<JenaTriggerId>()

    changes.forEach((change) => {
      const existingRecord =
        recordsRef.current.get(change.triggerId) ??
        ({
          broadcast: false,
          enabledFor: [],
          publish: false,
          triggerId: change.triggerId,
        } satisfies JenaExtendedTrigger)
      const enabledFor = mergeEnablementChanges(existingRecord.enabledFor, [
        change,
      ])

      recordsRef.current.set(change.triggerId, {
        broadcast: existingRecord.broadcast,
        enabledFor,
        publish: existingRecord.publish,
        triggerId: change.triggerId,
      })
      updatedIds.add(change.triggerId)
    })

    const revision = createMessageId()
    revisionRef.current = revision

    return {
      deletedTriggerIds: [],
      revision,
      upsertedRecords: [...updatedIds].flatMap((triggerId) => {
        const record = recordsRef.current.get(triggerId)

        return record ? [record] : []
      }),
      upsertedTriggers: [...updatedIds].flatMap((triggerId) => {
        const trigger = triggersByIdRef.current.get(triggerId)

        return trigger ? [trigger] : []
      }),
    }
  }

  function applyLocalFlagChanges(
    changes: JenaTriggerFlagChange[],
    allowPublish: boolean,
  ): JenaUserTriggerUpdate {
    const updatedIds = new Set<JenaTriggerId>()

    changes.forEach((change) => {
      const existingRecord =
        recordsRef.current.get(change.triggerId) ??
        ({
          broadcast: false,
          enabledFor: [],
          publish: false,
          triggerId: change.triggerId,
        } satisfies JenaExtendedTrigger)
      const nextRecord = {
        ...existingRecord,
        broadcast: change.broadcast ?? existingRecord.broadcast,
        publish:
          allowPublish && change.publish !== undefined
            ? change.publish
            : existingRecord.publish,
      }

      recordsRef.current.set(change.triggerId, nextRecord)
      updatedIds.add(change.triggerId)
    })

    const revision = createMessageId()
    revisionRef.current = revision

    return {
      deletedTriggerIds: [],
      revision,
      upsertedRecords: [...updatedIds].flatMap((triggerId) => {
        const record = recordsRef.current.get(triggerId)

        return record ? [record] : []
      }),
      upsertedTriggers: [...updatedIds].flatMap((triggerId) => {
        const trigger = triggersByIdRef.current.get(triggerId)

        return trigger ? [trigger] : []
      }),
    }
  }

  function applyLocalUpsert(
    recordsById: Map<JenaTriggerId, JenaExtendedTrigger>,
    triggersById: Map<JenaTriggerId, JenaTrigger>,
    upserts: JenaTriggerUpsert[],
    deleteTriggerIds: JenaTriggerId[],
  ): JenaUserTriggerUpdate {
    const revision = createMessageId()
    const deletedIds = new Set(deleteTriggerIds)
    const upsertedRecords: JenaExtendedTrigger[] = []
    const upsertedTriggers: JenaTrigger[] = []
    const canonicalUpserts = upserts.map((upsert) => ({
      enabledFor: upsert.enabledFor ?? [],
      trigger: withCanonicalTriggerId(upsert.trigger),
    }))

    canonicalUpserts.forEach((upsert) => {
      const implicitDeleteIds = findPathNameMatches(
        recordsById,
        triggersById,
        upsert.trigger,
      )

      implicitDeleteIds.forEach((triggerId) => {
        if (triggerId !== upsert.trigger.id) {
          deletedIds.add(triggerId)
        }
      })
    })

    canonicalUpserts.forEach((upsert) => {
      deletedIds.delete(upsert.trigger.id)
    })

    canonicalUpserts.forEach((upsert) => {
      const copiedEnabledFor = [...deletedIds].flatMap((triggerId) => {
        return recordsById.get(triggerId)?.enabledFor ?? []
      })
      const copiedRecords = [...deletedIds].flatMap((triggerId) => {
        const record = recordsById.get(triggerId)

        return record ? [record] : []
      })
      const existingEnabledFor =
        recordsById.get(upsert.trigger.id)?.enabledFor ?? []
      const existingRecord = recordsById.get(upsert.trigger.id)
      const enabledFor = mergeEnabledFor([
        ...existingEnabledFor,
        ...copiedEnabledFor,
        ...upsert.enabledFor,
      ])
      const record = {
        broadcast:
          existingRecord?.broadcast ??
          copiedRecords.some((copiedRecord) => copiedRecord.broadcast),
        enabledFor,
        publish:
          existingRecord?.publish ??
          copiedRecords.some((copiedRecord) => copiedRecord.publish),
        triggerId: upsert.trigger.id,
      }

      recordsById.set(upsert.trigger.id, record)
      triggersById.set(upsert.trigger.id, upsert.trigger)
      upsertedRecords.push(record)
      upsertedTriggers.push(upsert.trigger)
    })

    revisionRef.current = revision

    return {
      deletedTriggerIds: [...deletedIds],
      revision,
      upsertedRecords,
      upsertedTriggers,
    }
  }

  return (
    <TriggerManagerContext.Provider
      value={{
        deleteTrigger,
        deleteTriggers,
        setTriggerFlags,
        toggleTriggers,
        triggers,
        upsertTrigger,
        upsertTriggers,
      }}
    >
      {children}
    </TriggerManagerContext.Provider>
  )
}

export function useTriggerManager() {
  const manager = useContext(TriggerManagerContext)
  if (!manager) {
    throw new Error('useTriggerManager must be used within UserTriggerManagerProvider')
  }

  return manager
}

function normalizeUpsertInputs(
  triggerInputs: Array<JenaTrigger | JenaTriggerUpsert>,
): JenaTriggerUpsert[] {
  return triggerInputs.map((input) => {
    if ('trigger' in input) {
      return input
    }

    return {
      trigger: input,
    }
  })
}

function getResolvedSnapshot(
  recordsById: Map<JenaTriggerId, JenaExtendedTrigger>,
  triggersById: Map<JenaTriggerId, JenaTrigger>,
) {
  return [...recordsById.values()]
    .flatMap((record) => {
      const trigger = triggersById.get(record.triggerId)

      return trigger
        ? [
            {
              broadcast: record.broadcast,
              enabledFor: record.enabledFor,
              publish: record.publish,
              trigger,
            },
          ]
        : []
    })
    .sort(compareResolvedTriggers)
}

function normalizeRecord(record: JenaExtendedTrigger): JenaExtendedTrigger {
  return {
    broadcast: !!record.broadcast,
    enabledFor: mergeEnabledFor(record.enabledFor),
    publish: !!record.publish,
    triggerId: record.triggerId,
  }
}

function mergeEnablementChanges(
  enabledFor: JenaCharacterServer[],
  changes: JenaTriggerEnablementChange[],
) {
  const byKey = new Map(
    enabledFor.map((character) => [
      getJenaCharacterServerKey(character),
      character,
    ]),
  )

  changes.forEach((change) => {
    const key = getJenaCharacterServerKey(change.character)
    if (change.enabled) {
      byKey.set(key, change.character)
    } else {
      byKey.delete(key)
    }
  })

  return sortCharacterServers([...byKey.values()])
}

function mergeEnabledFor(characters: JenaCharacterServer[]) {
  return sortCharacterServers([
    ...new Map(
      characters.map((character) => [
        getJenaCharacterServerKey(character),
        character,
      ]),
    ).values(),
  ])
}

function findPathNameMatches(
  recordsById: Map<JenaTriggerId, JenaExtendedTrigger>,
  triggersById: Map<JenaTriggerId, JenaTrigger>,
  trigger: JenaTrigger,
) {
  return [...recordsById.values()].flatMap((record) => {
    const existingTrigger = triggersById.get(record.triggerId)
    if (!existingTrigger || existingTrigger.id === trigger.id) {
      return []
    }
    if (
      existingTrigger.name === trigger.name &&
      areStringArraysEqual(existingTrigger.groupPath, trigger.groupPath)
    ) {
      return [existingTrigger.id]
    }

    return []
  })
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sortCharacterServers(characters: JenaCharacterServer[]) {
  return [...characters].sort((left, right) => {
    const serverComparison = left.serverName.localeCompare(right.serverName, undefined, {
      sensitivity: 'base',
    })
    if (serverComparison !== 0) {
      return serverComparison
    }

    return left.characterName.localeCompare(right.characterName, undefined, {
      sensitivity: 'base',
    })
  })
}

function compareResolvedTriggers(
  left: JenaResolvedTrigger,
  right: JenaResolvedTrigger,
) {
  const pathComparison = left.trigger.groupPath
    .join('\0')
    .localeCompare(right.trigger.groupPath.join('\0'), undefined, {
      sensitivity: 'base',
    })
  if (pathComparison !== 0) {
    return pathComparison
  }

  return left.trigger.name.localeCompare(right.trigger.name, undefined, {
    sensitivity: 'base',
  })
}


async function readLocalUserTriggerCache() {
  const database = await openDatabase()

  try {
    return await getValue<LocalUserTriggerCache>(database, loggedOutCacheKey)
  } finally {
    database.close()
  }
}

async function writeLocalUserTriggerCache(cache: LocalUserTriggerCache) {
  const database = await openDatabase()

  try {
    await putValue(database, loggedOutCacheKey, cache)
  } finally {
    database.close()
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
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'))
  })
}

function getValue<TValue>(database: IDBDatabase, key: IDBValidKey) {
  return new Promise<TValue | undefined>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readonly')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result as TValue | undefined)
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function putValue(database: IDBDatabase, key: IDBValidKey, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readwrite')
    const store = transaction.objectStore(userTriggerCacheStoreName)

    store.put(value, key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

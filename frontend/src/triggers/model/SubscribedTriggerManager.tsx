import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth, type AuthStatus } from '../../auth/authContext'
import type {
  RegexMatchFoundMessage,
  SubscribedTriggerEnablementMode,
  SubscribedTriggerEnablementRecord,
  SubscriptionDefaultEnablementMode,
  SubscriptionDefaultEnablementRecord,
  SubscriptionTriggerRecord,
} from '../../shared/messages'
import { useListen, useRpc } from '../../shared/messageBrokerHooks'
import type {
  JenaBroadcastMode,
  JenaCharacterServer,
  JenaTrigger,
  JenaTriggerId,
} from '../../shared/triggers'
import { useTriggerStore } from './TriggerStore'

const databaseName = 'jena'
const databaseVersion = 4
const handlesStoreName = 'handles'
const settingsStoreName = 'settings'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const subscriptionCacheKey = 'subscribed-trigger-manager'
const subscriptionPollIntervalMs = 30_000
const subscriptionPattern =
  '\\{[Jj][Ee][Nn][Aa]:[Ss][Uu][Bb]:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\\}'

export interface SubscribedTriggerSnapshot {
  digest: string
  id: string
  ownerDisplayName: string
  records: SubscriptionTriggerRecord[]
  triggers: ResolvedSubscribedTrigger[]
}

export interface ResolvedSubscribedTrigger {
  broadcastToSubscribers: boolean
  trigger: JenaTrigger
}

export interface SubscribedTriggerManagerState {
  defaultEnablement: SubscriptionDefaultEnablementRecord[]
  snapshots: SubscribedTriggerSnapshot[]
  subscriptions: string[]
  triggerEnablement: SubscribedTriggerEnablementRecord[]
}

export interface SubscribedTriggerManagerApi
  extends SubscribedTriggerManagerState {
  addSubscription: (subscriptionId: string) => Promise<void>
  getTimerEarlyEnderBroadcastRegistrations: (
    triggerId: JenaTriggerId,
  ) => SubscribedTriggerAlertRegistration[]
  getTriggerAlertRegistrations: (
    triggerId: JenaTriggerId,
    character: JenaCharacterServer,
  ) => SubscribedTriggerAlertRegistration[]
  hasSubscriptionTrigger: (
    subscriptionId: string,
    triggerId: JenaTriggerId,
  ) => boolean
  isSubscriptionTriggerEnabledForCharacter: (
    subscriptionId: string,
    triggerId: JenaTriggerId,
    character: JenaCharacterServer,
  ) => boolean
  isTriggerEnabledForCharacter: (
    triggerId: JenaTriggerId,
    character: JenaCharacterServer,
  ) => boolean
  removeSubscription: (subscriptionId: string) => Promise<void>
  setSubscribedTriggerEnablement: (
    subscriptionId: string,
    triggerId: JenaTriggerId,
    character: JenaCharacterServer,
    mode: SubscribedTriggerEnablementMode,
  ) => Promise<void>
  setSubscriptionDefaultEnablement: (
    subscriptionId: string,
    character: JenaCharacterServer,
    mode: SubscriptionDefaultEnablementMode,
  ) => Promise<void>
}

export interface SubscribedTriggerAlertRegistration {
  broadcastMode: Extract<JenaBroadcastMode, 'private' | 'subscribers'>
  enabled: boolean
  source: 'subscription'
  subscriptionId: string
}

const emptyState: SubscribedTriggerManagerState = {
  defaultEnablement: [],
  snapshots: [],
  subscriptions: [],
  triggerEnablement: [],
}

const SubscribedTriggerManagerContext =
  createContext<SubscribedTriggerManagerApi | null>(null)

export function SubscribedTriggerManagerProvider({
  children,
}: {
  children: ReactNode
}) {
  const call = useRpc('subscribed-trigger-manager')
  const { status } = useAuth()
  const triggerStore = useTriggerStore()
  const [state, setState] = useState<SubscribedTriggerManagerState>(emptyState)
  const defaultEnablementRef = useRef<SubscriptionDefaultEnablementRecord[]>([])
  const snapshotsRef = useRef(new Map<string, SubscribedTriggerSnapshot>())
  const statusRef = useRef<AuthStatus>(status)
  const subscriptionIdsRef = useRef(new Set<string>())
  const syncSubscriptionsRef = useRef<() => Promise<void>>(
    async () => undefined,
  )
  const triggerEnablementRef = useRef<SubscribedTriggerEnablementRecord[]>([])
  const triggerStoreRef = useRef(triggerStore)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    triggerStoreRef.current = triggerStore
  }, [triggerStore])

  const getStateFromRefs = useCallback((): SubscribedTriggerManagerState => {
    return {
      defaultEnablement: [...defaultEnablementRef.current].sort(
        compareDefaultEnablementRecords,
      ),
      snapshots: [...snapshotsRef.current.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      subscriptions: [...subscriptionIdsRef.current].sort(),
      triggerEnablement: [...triggerEnablementRef.current].sort(
        compareTriggerEnablementRecords,
      ),
    }
  }, [])

  const publishState = useCallback(() => {
    setState(getStateFromRefs())
  }, [getStateFromRefs])

  const getTriggerAlertRegistrations = useCallback(
    (triggerId: JenaTriggerId, character: JenaCharacterServer) => {
      const normalizedTriggerId = triggerId.trim().toLocaleLowerCase()
      const registrations: SubscribedTriggerAlertRegistration[] = []

      for (const snapshot of snapshotsRef.current.values()) {
        const record = snapshot.records.find(
          (candidate) =>
            candidate.triggerId.trim().toLocaleLowerCase() === normalizedTriggerId,
        )
        if (!record) {
          continue
        }

        registrations.push({
          broadcastMode: record.broadcastToSubscribers ? 'subscribers' : 'private',
          enabled: isSubscribedTriggerEnabled(
            snapshot.id,
            normalizedTriggerId,
            character,
            defaultEnablementRef.current,
            triggerEnablementRef.current,
          ),
          source: 'subscription',
          subscriptionId: snapshot.id,
        })
      }

      return registrations
    },
    [],
  )

  const isTriggerEnabledForCharacter = useCallback(
    (triggerId: JenaTriggerId, character: JenaCharacterServer) => {
      return getTriggerAlertRegistrations(triggerId, character).some(
        (registration) => registration.enabled,
      )
    },
    [getTriggerAlertRegistrations],
  )

  const hasSubscriptionTrigger = useCallback(
    (subscriptionId: string, triggerId: JenaTriggerId) => {
      const normalizedSubscriptionId = normalizeSubscriptionID(subscriptionId)
      if (!normalizedSubscriptionId) {
        return false
      }

      return subscriptionHasTrigger(
        normalizedSubscriptionId,
        triggerId,
        snapshotsRef.current,
      )
    },
    [],
  )

  const isSubscriptionTriggerEnabledForCharacter = useCallback(
    (
      subscriptionId: string,
      triggerId: JenaTriggerId,
      character: JenaCharacterServer,
    ) => {
      const normalizedSubscriptionId = normalizeSubscriptionID(subscriptionId)
      if (
        !normalizedSubscriptionId ||
        !subscriptionHasTrigger(
          normalizedSubscriptionId,
          triggerId,
          snapshotsRef.current,
        )
      ) {
        return false
      }

      return isSubscribedTriggerEnabled(
        normalizedSubscriptionId,
        triggerId.trim().toLocaleLowerCase(),
        character,
        defaultEnablementRef.current,
        triggerEnablementRef.current,
      )
    },
    [],
  )

  const getTimerEarlyEnderBroadcastRegistrations = useCallback(
    (triggerId: JenaTriggerId) => {
      const normalizedTriggerId = triggerId.trim().toLocaleLowerCase()
      const registrations: SubscribedTriggerAlertRegistration[] = []

      for (const snapshot of snapshotsRef.current.values()) {
        const record = snapshot.records.find(
          (candidate) =>
            candidate.triggerId.trim().toLocaleLowerCase() === normalizedTriggerId,
        )
        if (!record || !record.broadcastToSubscribers) {
          continue
        }

        registrations.push({
          broadcastMode: 'subscribers',
          enabled: true,
          source: 'subscription',
          subscriptionId: snapshot.id,
        })
      }

      return registrations
    },
    [],
  )

  const persistIfAnonymous = useCallback(async () => {
    if (statusRef.current !== 'anonymous') {
      return
    }

    await saveCachedState(getStateFromRefs()).catch((error: unknown) => {
      console.warn('[SubscribedTriggerManager] unable to save local state', error)
    })
  }, [getStateFromRefs])

  const replaceState = useCallback(
    (nextState: SubscribedTriggerManagerState) => {
      subscriptionIdsRef.current = new Set(
        nextState.subscriptions.flatMap((subscriptionId) => {
          const normalized = normalizeSubscriptionID(subscriptionId)

          return normalized ? [normalized] : []
        }),
      )
      snapshotsRef.current = new Map(
        nextState.snapshots.flatMap((snapshot) => {
          const normalized = normalizeSubscriptionID(snapshot.id)

          return normalized
            ? [
                [
                  normalized,
                  {
                    ...snapshot,
                    id: normalized,
                    records: snapshot.records ?? [],
                    triggers: snapshot.triggers ?? [],
                  },
                ],
              ]
            : []
        }),
      )
      defaultEnablementRef.current = nextState.defaultEnablement.filter(
        (record) => subscriptionIdsRef.current.has(record.subscriptionId),
      )
      triggerEnablementRef.current = nextState.triggerEnablement.filter(
        (record) => subscriptionIdsRef.current.has(record.subscriptionId),
      )
      publishState()
    },
    [publishState],
  )

  function removeSubscriptionLocally(subscriptionId: string) {
    subscriptionIdsRef.current.delete(subscriptionId)
    snapshotsRef.current.delete(subscriptionId)
    defaultEnablementRef.current = defaultEnablementRef.current.filter(
      (record) => record.subscriptionId !== subscriptionId,
    )
    triggerEnablementRef.current = triggerEnablementRef.current.filter(
      (record) => record.subscriptionId !== subscriptionId,
    )
  }

  function upsertSubscriptionDefaultEnablementLocally(
    subscriptionId: string,
    character: JenaCharacterServer,
    mode: SubscriptionDefaultEnablementMode,
  ) {
    subscriptionIdsRef.current.add(subscriptionId)
    const recordKey = getCharacterRecordKey(subscriptionId, character)
    defaultEnablementRef.current = [
      ...defaultEnablementRef.current.filter(
        (record) =>
          getCharacterRecordKey(record.subscriptionId, record.character) !==
          recordKey,
      ),
      {
        character,
        mode,
        subscriptionId,
      },
    ]
  }

  function upsertSubscribedTriggerEnablementLocally(
    subscriptionId: string,
    triggerId: JenaTriggerId,
    character: JenaCharacterServer,
    mode: SubscribedTriggerEnablementMode,
  ) {
    subscriptionIdsRef.current.add(subscriptionId)
    const recordKey = getTriggerRecordKey(subscriptionId, triggerId, character)
    triggerEnablementRef.current = triggerEnablementRef.current.filter(
      (record) =>
        getTriggerRecordKey(
          record.subscriptionId,
          record.triggerId,
          record.character,
        ) !== recordKey,
    )

    if (mode === 'inherit') {
      return
    }

    triggerEnablementRef.current = [
      ...triggerEnablementRef.current,
      {
        character,
        mode,
        subscriptionId,
        triggerId,
      },
    ]
  }

  const syncSubscriptions = useCallback(async () => {
    const subscriptionIds = [...subscriptionIdsRef.current]
    if (subscriptionIds.length === 0) {
      return
    }

    try {
      const response = await call('server.subscriptions', 'syncSubscriptions', {
        subscriptions: subscriptionIds.map((id) => ({
          digest: snapshotsRef.current.get(id)?.digest ?? '',
          id,
        })),
      })
      const updatedResults = response.subscriptions.filter(
        (result) => result.status === 'updated',
      )
      const triggerIds = [
        ...new Set(
          updatedResults.flatMap((result) => {
            return (result.records ?? []).map((record) => record.triggerId)
          }),
        ),
      ]
      const fetchedTriggers =
        triggerIds.length > 0
          ? await triggerStoreRef.current.fetchTriggers(triggerIds)
          : []
      const fetchedTriggersById = new Map(
        fetchedTriggers.map((trigger) => [trigger.id, trigger]),
      )

      response.subscriptions.forEach((result) => {
        if (result.status === 'notFound') {
          removeSubscriptionLocally(result.id)
          return
        }

        if (result.status === 'current') {
          const currentSnapshot = snapshotsRef.current.get(result.id)
          if (currentSnapshot) {
            snapshotsRef.current.set(result.id, {
              ...currentSnapshot,
              digest: result.digest,
              ownerDisplayName: result.ownerDisplayName,
            })
          }
          return
        }

        const records = result.records ?? []
        snapshotsRef.current.set(result.id, {
          digest: result.digest,
          id: result.id,
          ownerDisplayName: result.ownerDisplayName,
          records,
          triggers: records.flatMap((record) => {
            const trigger = fetchedTriggersById.get(record.triggerId)

            return trigger
              ? [
                  {
                    broadcastToSubscribers: record.broadcastToSubscribers,
                    trigger,
                  },
                ]
              : []
          }),
        })
      })

      publishState()
      await persistIfAnonymous()
    } catch (error) {
      console.warn('[SubscribedTriggerManager] subscription sync failed', error)
    }
  }, [call, persistIfAnonymous, publishState])

  useEffect(() => {
    syncSubscriptionsRef.current = syncSubscriptions
  }, [syncSubscriptions])

  useEffect(() => {
    void call('worker.matcher-service', 'add-patterns', {
      namespace: 'subscriptions',
      patterns: [{ pattern: subscriptionPattern }],
    }).catch((error: unknown) => {
      console.warn(
        '[SubscribedTriggerManager] subscription pattern registration failed',
        error,
      )
    })
  }, [call])

  useEffect(() => {
    if (status === 'checking') {
      return
    }

    let cancelled = false

    void (async () => {
      if (status === 'authenticated') {
        const response = await call(
          'server.subscriptions',
          'fetchUserSubscriptions',
          {},
        )
        if (cancelled) {
          return
        }

        replaceState({
          defaultEnablement: response.defaultEnablement,
          snapshots: [],
          subscriptions: response.subscriptions,
          triggerEnablement: response.triggerEnablement,
        })
      } else {
        const cachedState = await loadCachedState()
        if (cancelled) {
          return
        }

        replaceState(cachedState ?? emptyState)
      }

      await syncSubscriptionsRef.current()
    })().catch((error: unknown) => {
      console.warn('[SubscribedTriggerManager] unable to load subscriptions', error)
      replaceState(emptyState)
    })

    return () => {
      cancelled = true
    }
  }, [call, replaceState, status])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void syncSubscriptionsRef.current()
    }, subscriptionPollIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  const addSubscription = useCallback(
    async (subscriptionId: string) => {
      const normalized = normalizeSubscriptionID(subscriptionId)
      if (!normalized || subscriptionIdsRef.current.has(normalized)) {
        return
      }

      subscriptionIdsRef.current.add(normalized)
      publishState()
      await persistIfAnonymous()

      try {
        if (statusRef.current === 'authenticated') {
          await call('server.subscriptions', 'addUserSubscription', {
            subscriptionId: normalized,
          })
        }
        await syncSubscriptionsRef.current()
      } catch (error) {
        removeSubscriptionLocally(normalized)
        publishState()
        await persistIfAnonymous()
        console.warn('[SubscribedTriggerManager] unable to add subscription', error)
      }
    },
    [call, persistIfAnonymous, publishState],
  )

  const removeSubscription = useCallback(
    async (subscriptionId: string) => {
      const normalized = normalizeSubscriptionID(subscriptionId)
      if (!normalized || !subscriptionIdsRef.current.has(normalized)) {
        return
      }

      removeSubscriptionLocally(normalized)
      publishState()
      await persistIfAnonymous()

      if (statusRef.current === 'authenticated') {
        await call('server.subscriptions', 'removeUserSubscription', {
          subscriptionId: normalized,
        })
      }
    },
    [call, persistIfAnonymous, publishState],
  )

  const setSubscriptionDefaultEnablement = useCallback(
    async (
      subscriptionId: string,
      character: JenaCharacterServer,
      mode: SubscriptionDefaultEnablementMode,
    ) => {
      const normalized = normalizeSubscriptionID(subscriptionId)
      if (!normalized) {
        return
      }

      upsertSubscriptionDefaultEnablementLocally(normalized, character, mode)
      publishState()
      await persistIfAnonymous()

      if (statusRef.current === 'authenticated') {
        await call('server.subscriptions', 'setSubscriptionDefaultEnablement', {
          character,
          mode,
          subscriptionId: normalized,
        })
      }
    },
    [call, persistIfAnonymous, publishState],
  )

  const setSubscribedTriggerEnablement = useCallback(
    async (
      subscriptionId: string,
      triggerId: JenaTriggerId,
      character: JenaCharacterServer,
      mode: SubscribedTriggerEnablementMode,
    ) => {
      const normalized = normalizeSubscriptionID(subscriptionId)
      if (!normalized) {
        return
      }

      upsertSubscribedTriggerEnablementLocally(
        normalized,
        triggerId,
        character,
        mode,
      )
      publishState()
      await persistIfAnonymous()

      if (statusRef.current === 'authenticated') {
        await call('server.subscriptions', 'setSubscribedTriggerEnablement', {
          character,
          mode,
          subscriptionId: normalized,
          triggerId,
        })
      }
    },
    [call, persistIfAnonymous, publishState],
  )

  useListen('matcher.match-found', (message) => {
    const payload = message.payload as RegexMatchFoundMessage
    if (payload.pattern !== subscriptionPattern) {
      return
    }

    const subscriptionId = payload.captures.positional[0]
    if (!subscriptionId) {
      return
    }

    void addSubscription(subscriptionId)
  })

  useListen('subscriptions.updated', () => {
    void syncSubscriptionsRef.current()
  })

  const value = useMemo(
    () => ({
      ...state,
      addSubscription,
      getTimerEarlyEnderBroadcastRegistrations,
      getTriggerAlertRegistrations,
      hasSubscriptionTrigger,
      isSubscriptionTriggerEnabledForCharacter,
      isTriggerEnabledForCharacter,
      removeSubscription,
      setSubscribedTriggerEnablement,
      setSubscriptionDefaultEnablement,
    }),
    [
      addSubscription,
      getTimerEarlyEnderBroadcastRegistrations,
      getTriggerAlertRegistrations,
      hasSubscriptionTrigger,
      isSubscriptionTriggerEnabledForCharacter,
      isTriggerEnabledForCharacter,
      removeSubscription,
      setSubscribedTriggerEnablement,
      setSubscriptionDefaultEnablement,
      state,
    ],
  )

  return (
    <SubscribedTriggerManagerContext.Provider value={value}>
      {children}
    </SubscribedTriggerManagerContext.Provider>
  )
}

export function useSubscribedTriggerManager() {
  const manager = useContext(SubscribedTriggerManagerContext)
  if (!manager) {
    throw new Error(
      'useSubscribedTriggerManager must be used within SubscribedTriggerManagerProvider',
    )
  }

  return manager
}

function normalizeSubscriptionID(subscriptionId: string) {
  const match = subscriptionId
    .trim()
    .match(
      /^\{?[Jj][Ee][Nn][Aa]:[Ss][Uu][Bb]:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$/,
    )
  if (match?.[1]) {
    return match[1].toLowerCase()
  }

  if (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
      subscriptionId.trim(),
    )
  ) {
    return subscriptionId.trim().toLowerCase()
  }

  return null
}

function getCharacterRecordKey(
  subscriptionId: string,
  character: JenaCharacterServer,
) {
  return [
    subscriptionId,
    character.serverName.trim().toLocaleLowerCase(),
    character.characterName.trim().toLocaleLowerCase(),
  ].join('\0')
}

function getTriggerRecordKey(
  subscriptionId: string,
  triggerId: JenaTriggerId,
  character: JenaCharacterServer,
) {
  return [
    getCharacterRecordKey(subscriptionId, character),
    triggerId.toLocaleLowerCase(),
  ].join('\0')
}

function isSubscribedTriggerEnabled(
  subscriptionId: string,
  normalizedTriggerId: string,
  character: JenaCharacterServer,
  defaultEnablement: SubscriptionDefaultEnablementRecord[],
  triggerEnablement: SubscribedTriggerEnablementRecord[],
) {
  const triggerOverride = triggerEnablement.find((record) => {
    return (
      record.subscriptionId === subscriptionId &&
      record.triggerId.trim().toLocaleLowerCase() === normalizedTriggerId &&
      getCharacterRecordKey(record.subscriptionId, record.character) ===
        getCharacterRecordKey(subscriptionId, character)
    )
  })
  if (triggerOverride) {
    return triggerOverride.mode === 'enabled'
  }

  const defaultRecord = defaultEnablement.find((record) => {
    return (
      record.subscriptionId === subscriptionId &&
      getCharacterRecordKey(record.subscriptionId, record.character) ===
        getCharacterRecordKey(subscriptionId, character)
    )
  })

  return defaultRecord?.mode === 'enabled'
}

function subscriptionHasTrigger(
  subscriptionId: string,
  triggerId: JenaTriggerId,
  snapshots: Map<string, SubscribedTriggerSnapshot>,
) {
  const normalizedTriggerId = triggerId.trim().toLocaleLowerCase()

  return (
    snapshots
      .get(subscriptionId)
      ?.records.some(
        (record) =>
          record.triggerId.trim().toLocaleLowerCase() === normalizedTriggerId,
      ) ?? false
  )
}

function compareDefaultEnablementRecords(
  left: SubscriptionDefaultEnablementRecord,
  right: SubscriptionDefaultEnablementRecord,
) {
  return getCharacterRecordKey(left.subscriptionId, left.character).localeCompare(
    getCharacterRecordKey(right.subscriptionId, right.character),
  )
}

function compareTriggerEnablementRecords(
  left: SubscribedTriggerEnablementRecord,
  right: SubscribedTriggerEnablementRecord,
) {
  return getTriggerRecordKey(
    left.subscriptionId,
    left.triggerId,
    left.character,
  ).localeCompare(
    getTriggerRecordKey(right.subscriptionId, right.triggerId, right.character),
  )
}

async function loadCachedState() {
  const database = await openDatabase()

  try {
    return await readCachedState(database)
  } finally {
    database.close()
  }
}

async function saveCachedState(state: SubscribedTriggerManagerState) {
  const database = await openDatabase()

  try {
    await writeCachedState(database, state)
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
      if (!database.objectStoreNames.contains(settingsStoreName)) {
        database.createObjectStore(settingsStoreName)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'))
  })
}

function readCachedState(database: IDBDatabase) {
  return new Promise<SubscribedTriggerManagerState | null>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readonly')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    const request = store.get(subscriptionCacheKey)

    request.onsuccess = () => {
      resolve(isSubscribedTriggerManagerState(request.result) ? request.result : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function writeCachedState(
  database: IDBDatabase,
  state: SubscribedTriggerManagerState,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(userTriggerCacheStoreName, 'readwrite')
    const store = transaction.objectStore(userTriggerCacheStoreName)
    store.put(state, subscriptionCacheKey)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

function isSubscribedTriggerManagerState(
  value: unknown,
): value is SubscribedTriggerManagerState {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<SubscribedTriggerManagerState>

  return (
    Array.isArray(candidate.defaultEnablement) &&
    Array.isArray(candidate.snapshots) &&
    Array.isArray(candidate.subscriptions) &&
    Array.isArray(candidate.triggerEnablement)
  )
}

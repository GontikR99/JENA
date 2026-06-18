import {
  normalizeMachineSettings,
  type MachineSettings,
} from './settingsTypes'

const databaseName = 'jena'
const databaseVersion = 4
const handlesStoreName = 'handles'
const triggerCacheStoreName = 'trigger-cache'
const userTriggerCacheStoreName = 'user-trigger-cache'
const settingsStoreName = 'settings'
const machineSettingsKey = 'machine-settings'

export async function readMachineSettings() {
  const database = await openDatabase()

  try {
    return normalizeMachineSettings(
      await getValue<Partial<MachineSettings>>(database, machineSettingsKey),
    )
  } finally {
    database.close()
  }
}

export async function writeMachineSettings(settings: MachineSettings) {
  const database = await openDatabase()

  try {
    await putValue(database, machineSettingsKey, settings)
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

function getValue<TValue>(database: IDBDatabase, key: IDBValidKey) {
  return new Promise<TValue | undefined>((resolve, reject) => {
    const transaction = database.transaction(settingsStoreName, 'readonly')
    const store = transaction.objectStore(settingsStoreName)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result as TValue | undefined)
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function putValue(database: IDBDatabase, key: IDBValidKey, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(settingsStoreName, 'readwrite')
    const store = transaction.objectStore(settingsStoreName)

    store.put(value, key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

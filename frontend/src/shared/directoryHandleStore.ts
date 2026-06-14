import type { FileSystemDirectoryHandleLike } from './fileSystemAccess'

const databaseName = 'jena'
const databaseVersion = 1
const storeName = 'handles'
const everQuestDirectoryKey = 'everquest-directory'

export async function getSavedEverQuestDirectoryHandle() {
  const database = await openDatabase()

  try {
    return await getValue<FileSystemDirectoryHandleLike>(
      database,
      everQuestDirectoryKey,
    )
  } finally {
    database.close()
  }
}

export async function saveEverQuestDirectoryHandle(
  directoryHandle: FileSystemDirectoryHandleLike,
) {
  const database = await openDatabase()

  try {
    await putValue(database, everQuestDirectoryKey, directoryHandle)
  } finally {
    database.close()
  }
}

export async function forgetSavedEverQuestDirectoryHandle() {
  const database = await openDatabase()

  try {
    await deleteValue(database, everQuestDirectoryKey)
  } finally {
    database.close()
  }
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion)

    request.onupgradeneeded = () => {
      const database = request.result

      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'))
  })
}

function getValue<TValue>(database: IDBDatabase, key: IDBValidKey) {
  return new Promise<TValue | undefined>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.get(key)

    request.onsuccess = () => resolve(request.result as TValue | undefined)
    request.onerror = () => reject(request.error ?? new Error('Read failed.'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
  })
}

function putValue(database: IDBDatabase, key: IDBValidKey, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)

    store.put(value, key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

function deleteValue(database: IDBDatabase, key: IDBValidKey) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)

    store.delete(key)

    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Transaction aborted.'))
  })
}

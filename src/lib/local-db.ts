/** Small native IndexedDB adapter used as a durable mirror for local-first data.
 * It deliberately has no React or PocketBase dependency, so it can be used
 * from the store and sync layers without creating an import cycle.
 */
const DATABASE = "jornal-local-v1"
const STORE = "state"
const VERSION = 1

interface StateRow {
  key: string
  value: unknown
  updatedAt: number
}

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"))
  })
}

export async function mirrorState(key: string, value: unknown): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, value, updatedAt: Date.now() } satisfies StateRow)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"))
  }).finally(() => db.close())
}

export async function restoreState(key: string): Promise<unknown | undefined> {
  const db = await database()
  if (!db) return undefined
  return new Promise<unknown | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
    request.onsuccess = () => {
      resolve((request.result as StateRow | undefined)?.value)
      db.close()
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"))
  })
}

export async function clearMirroredState(key: string): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"))
  }).finally(() => db.close())
}

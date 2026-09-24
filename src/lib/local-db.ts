/** Small native IndexedDB adapter used as a durable mirror for local-first data.
 * It deliberately has no React or PocketBase dependency, so it can be used
 * from the store and sync layers without creating an import cycle.
 */
const DATABASE = "jornal-local-v1"
const STORE = "state"
const VERSION = 3
const OUTBOX = "outbox"
const BLOBS = "blobs"

interface StateRow {
  key: string
  value: unknown
  updatedAt: number
}

export interface BlobRow {
  key: string
  blob: Blob
  mimeType: string
  filename: string
  byteSize: number
  updatedAt: number
}

export interface OutboxRow { key: string; value: unknown; queuedAt: number; version?: string }

// Synchronous session mirror closes the small race between a local write and
// IndexedDB committing it, and keeps sync functional when IndexedDB is
// temporarily unavailable (private-mode/quota failures).
const volatileOutbox = new Map<string, OutboxRow>()

function outboxRow(key: string, value: unknown): OutboxRow {
  return { key, value, queuedAt: Date.now(), version: crypto.randomUUID() }
}

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" })
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "key" })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"))
  })
}

/** Persist private document bytes separately from JSON state. Callers must use
 * a tenant/company-scoped key; this module intentionally cannot infer scope. */
export async function storeBlob(row: Omit<BlobRow, "updatedAt">): Promise<void> {
  const db = await database()
  if (!db) throw new Error("Penyimpanan offline tidak tersedia")
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(BLOBS, "readwrite").objectStore(BLOBS).put({ ...row, updatedAt: Date.now() } satisfies BlobRow)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("Penyimpanan dokumen gagal"))
  }).finally(() => db.close())
}

export async function restoreBlob(key: string): Promise<BlobRow | undefined> {
  const db = await database()
  if (!db) return undefined
  return new Promise<BlobRow | undefined>((resolve, reject) => {
    const request = db.transaction(BLOBS, "readonly").objectStore(BLOBS).get(key)
    request.onsuccess = () => { resolve(request.result as BlobRow | undefined); db.close() }
    request.onerror = () => { db.close(); reject(request.error ?? new Error("Dokumen offline tidak dapat dibaca")) }
  })
}

export async function listBlobsByPrefix(prefix: string): Promise<BlobRow[]> {
  const db = await database()
  if (!db) return []
  return new Promise<BlobRow[]>((resolve, reject) => {
    const request = db.transaction(BLOBS, "readonly").objectStore(BLOBS).getAll()
    request.onsuccess = () => { resolve((request.result as BlobRow[]).filter((row) => row.key.startsWith(prefix))); db.close() }
    request.onerror = () => { db.close(); reject(request.error ?? new Error("Dokumen offline tidak dapat dimuat")) }
  })
}

export async function removeBlob(key: string): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(BLOBS, "readwrite").objectStore(BLOBS).delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("Dokumen offline tidak dapat dihapus"))
  }).finally(() => db.close())
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
    request.onerror = () => {
      db.close()
      reject(request.error ?? new Error("IndexedDB read failed"))
    }
  })
}

export async function listMirroredStateByPrefix(prefix: string): Promise<StateRow[]> {
  const db = await database()
  if (!db) return []
  return new Promise<StateRow[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll()
    request.onsuccess = () => {
      resolve((request.result as StateRow[]).filter((row) => row.key.startsWith(prefix)))
      db.close()
    }
    request.onerror = () => { reject(request.error ?? new Error("IndexedDB state lookup failed")); db.close() }
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

/** Remove all durable state entries whose keys belong to a scoped prefix. */
export async function clearMirroredStateByPrefix(prefix: string): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite")
    const objectStore = transaction.objectStore(STORE)
    const request = objectStore.getAllKeys()
    request.onsuccess = () => {
      for (const key of request.result) if (typeof key === "string" && key.startsWith(prefix)) objectStore.delete(key)
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB key lookup failed"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB prefix delete failed"))
  }).finally(() => db.close())
}

export async function enqueueOutbox(key: string, value: unknown): Promise<void> {
  const row = outboxRow(key, value)
  volatileOutbox.set(key, row)
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(OUTBOX, "readwrite").objectStore(OUTBOX).put(row)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("IndexedDB outbox write failed"))
  }).finally(() => db.close())
}

/** Persist the local mirror and its pending sync operation atomically. */
export async function persistState(key: string, value: unknown): Promise<void> {
  // Sync reads the authoritative snapshot from local state. The outbox only
  // needs to mark which collection changed, so avoid cloning the same large
  // transaction array into IndexedDB a second time.
  const row = outboxRow(key, null)
  volatileOutbox.set(key, row)
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([STORE, OUTBOX], "readwrite")
    transaction.objectStore(STORE).put({ key, value, updatedAt: Date.now() } satisfies StateRow)
    transaction.objectStore(OUTBOX).put(row)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB persistence failed"))
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB persistence aborted"))
  }).finally(() => db.close())
}

export async function listOutbox(): Promise<OutboxRow[]> {
  const db = await database()
  if (!db) return [...volatileOutbox.values()]
  return new Promise<OutboxRow[]>((resolve, reject) => {
    const request = db.transaction(OUTBOX, "readonly").objectStore(OUTBOX).getAll()
    request.onsuccess = () => {
      const rows = new Map((request.result as OutboxRow[]).map((row) => [row.key, row]))
      for (const row of volatileOutbox.values()) rows.set(row.key, row)
      resolve([...rows.values()]); db.close()
    }
    request.onerror = () => { reject(request.error ?? new Error("IndexedDB outbox read failed")); db.close() }
  })
}

/** Idempotently copy pending work to a new scope while retaining the legacy
 * rows as a recovery source until the rollout retention window expires. */
export async function copyOutboxByPrefix(sourcePrefix: string, targetPrefix: string): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX, "readwrite")
    const objectStore = transaction.objectStore(OUTBOX)
    const request = objectStore.getAll()
    request.onsuccess = () => {
      for (const row of request.result as OutboxRow[]) {
        if (!row.key.startsWith(sourcePrefix)) continue
        const targetKey = `${targetPrefix}${row.key.slice(sourcePrefix.length)}`
        const target = objectStore.get(targetKey)
        target.onsuccess = () => {
          if (!target.result) objectStore.put(outboxRow(targetKey, row.value))
        }
      }
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB outbox migration lookup failed"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB outbox migration failed"))
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB outbox migration aborted"))
  }).finally(() => db.close())
}

export async function acknowledgeOutbox(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  for (const key of keys) volatileOutbox.delete(key)
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX, "readwrite")
    const objectStore = transaction.objectStore(OUTBOX)
    for (const key of keys) objectStore.delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB outbox acknowledge failed"))
  }).finally(() => db.close())
}

/** Acknowledge only the exact snapshots that were sent. A newer write to the
 * same key must stay queued. */
export async function acknowledgeOutboxSnapshots(rows: OutboxRow[]): Promise<void> {
  if (rows.length === 0) return
  for (const row of rows) {
    const current = volatileOutbox.get(row.key)
    if (current?.version === row.version) volatileOutbox.delete(row.key)
  }
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX, "readwrite")
    const objectStore = transaction.objectStore(OUTBOX)
    for (const row of rows) {
      const request = objectStore.get(row.key)
      request.onsuccess = () => {
        const current = request.result as OutboxRow | undefined
        const sameSnapshot = current && row.version && current.version
          ? current.version === row.version
          : current?.queuedAt === row.queuedAt && JSON.stringify(current.value) === JSON.stringify(row.value)
        if (sameSnapshot) objectStore.delete(row.key)
      }
    }
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB outbox acknowledge failed"))
  }).finally(() => db.close())
}

export async function clearOutboxByPrefix(prefix: string): Promise<void> {
  for (const key of volatileOutbox.keys()) if (key.startsWith(prefix)) volatileOutbox.delete(key)
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX, "readwrite")
    const objectStore = transaction.objectStore(OUTBOX)
    const request = objectStore.getAllKeys()
    request.onsuccess = () => {
      for (const key of request.result) if (typeof key === "string" && key.startsWith(prefix)) objectStore.delete(key)
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB outbox key lookup failed"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB outbox prefix clear failed"))
  }).finally(() => db.close())
}

/** Preserve stale/pre-reset operations for support recovery while removing
 * them from every active company scheduler prefix. */
export async function quarantineOutboxByPrefix(prefix: string, reason: string): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(OUTBOX, "readwrite")
    const objectStore = transaction.objectStore(OUTBOX)
    const request = objectStore.getAll()
    request.onsuccess = () => {
      for (const row of request.result as OutboxRow[]) {
        if (!row.key.startsWith(prefix)) continue
        objectStore.put({ ...row, key: `jornal.quarantine.${reason}.${row.queuedAt}.${row.key}` })
        objectStore.delete(row.key)
      }
    }
    request.onerror = () => reject(request.error ?? new Error("IndexedDB outbox lookup failed"))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB outbox quarantine failed"))
  }).finally(() => db.close())
}

/** Drop every pending mutation when the user explicitly resets this device's data. */
export async function clearOutbox(): Promise<void> {
  const db = await database()
  if (!db) return
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(OUTBOX, "readwrite").objectStore(OUTBOX).clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error("IndexedDB outbox clear failed"))
  }).finally(() => db.close())
}

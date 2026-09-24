import { clearMirroredState, clearMirroredStateByPrefix, mirrorState, restoreState } from "./local-db"

export const PERSISTENT_CACHE_UPDATED_EVENT = "jornal:persistent-cache-updated"

interface CacheUpdateDetail {
  namespace: string
  key: string
}

const refreshes = new Map<string, Promise<unknown>>()
let cacheGeneration = 0

function readLocal<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? undefined : JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export async function readPersistentCache<T>(key: string): Promise<T | undefined> {
  const local = readLocal<T>(key)
  if (local !== undefined) return local
  const durable = await restoreState(key).catch(() => undefined)
  if (durable === undefined) return undefined
  try { window.localStorage.setItem(key, JSON.stringify(durable)) } catch { /* IndexedDB remains the durable copy */ }
  return durable as T
}

export async function writePersistentCache<T>(key: string, value: T) {
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* IndexedDB remains the durable copy */ }
  await mirrorState(key, value).catch(() => undefined)
  return value
}

function announce(namespace: string, key: string) {
  window.dispatchEvent(new CustomEvent<CacheUpdateDetail>(PERSISTENT_CACHE_UPDATED_EVENT, {
    detail: { namespace, key },
  }))
}

function refresh<T>(namespace: string, key: string, load: () => Promise<T>) {
  const active = refreshes.get(key)
  if (active) return active as Promise<T>
  const generation = cacheGeneration
  const request = load()
    .then(async (fresh) => {
      if (generation !== cacheGeneration) return fresh
      const previous = readLocal<T>(key)
      await writePersistentCache(key, fresh)
      if (JSON.stringify(previous) !== JSON.stringify(fresh)) announce(namespace, key)
      return fresh
    })
    .finally(() => {
      // An invalidation may have detached this request and started a newer
      // refresh for the same key. The older request must never remove that
      // replacement from the de-duplication map when it eventually settles.
      if (refreshes.get(key) === request) refreshes.delete(key)
    })
  refreshes.set(key, request)
  return request
}

/** Return durable data immediately and refresh it without blocking the UI. */
export async function staleWhileRevalidate<T>(namespace: string, key: string, load: () => Promise<T>): Promise<T> {
  const cached = await readPersistentCache<T>(key)
  if (cached !== undefined) {
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      void refresh(namespace, key, load).catch(() => undefined)
    }
    return cached
  }
  return refresh(namespace, key, load)
}

export async function clearPersistentCache(key: string) {
  cacheGeneration += 1
  // Detach any pre-mutation GET immediately. It cannot always be aborted, but
  // callers after this point must start a fresh request rather than receive
  // its obsolete result.
  refreshes.delete(key)
  try { window.localStorage.removeItem(key) } catch { /* durable cleanup follows */ }
  await clearMirroredState(key).catch(() => undefined)
}

export async function clearPersistentCachePrefix(prefix: string) {
  cacheGeneration += 1
  for (const key of refreshes.keys()) if (key.startsWith(prefix)) refreshes.delete(key)
  const keys: string[] = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch { /* durable cleanup follows */ }
  await clearMirroredStateByPrefix(prefix).catch(() => undefined)
}

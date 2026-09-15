import type { Account, AppSettings, BusinessProfile, CorrectionPattern, RecurringRule, Reserve, Transaction } from "./types"
import { KEYS, scopedStorageKey } from "./store"
import { pb } from "./pb"
import { acknowledgeOutbox, listOutbox, mirrorState, restoreState } from "./local-db"

type EntityName =
  | "profile"
  | "settings"
  | "accounts"
  | "transactions"
  | "reserves"
  | "corrections"
  | "recurringRules"
  | "profileHistory"
  | "accountHistory"
  | "transactionHistory"
  | "reserveHistory"

type LocalStateMap = {
  profile: BusinessProfile | null
  settings: AppSettings | null
  accounts: Account[]
  transactions: Transaction[]
  reserves: Reserve[]
  corrections: CorrectionPattern[]
  recurringRules: RecurringRule[]
  profileHistory: Array<{ id: string; effectiveAt: string; deletedAt: string | null; value: BusinessProfile }>
  accountHistory: Array<{ id: string; effectiveAt: string; deletedAt: string | null; value: Account }>
  transactionHistory: Array<{ id: string; effectiveAt: string; deletedAt: string | null; value: Transaction }>
  reserveHistory: Array<{ id: string; effectiveAt: string; deletedAt: string | null; value: Reserve }>
}

interface PocketBaseRecord {
  id: string
  entity: EntityName
  app_id: string
  business_id: string
  payload: unknown
  attachment?: string | null
  updated: string
  created: string
  revision?: number
  deleted_at?: string | null
}

const COLLECTION = "jornal_records"

/**
 * Every tenant (PocketBase user) owns their records: business_id = user id.
 * Falls back to "local" for unit tests / unauthenticated local-only usage.
 */
function businessId(): string {
  return pb.authStore.isValid ? (pb.authStore.record?.id ?? "local") : "local"
}

let testUrlOverride: string | null = null
let syncQueued = false
let hydrationStarted = false
let syncGeneration = 0
export type SyncStatus = "idle" | "syncing" | "synced" | "retrying" | "failed"
export interface SyncConflict {
  id: string
  message: string
  entity?: string
  appId?: string
  localPayload?: unknown
  remotePayload?: unknown
  occurredAt: string
}
let syncStatus: SyncStatus = "idle"
const syncStatusListeners = new Set<(status: SyncStatus) => void>()

export function getSyncStatus() {
  return syncStatus
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void) {
  syncStatusListeners.add(listener)
  return () => { syncStatusListeners.delete(listener) }
}

function setSyncStatus(status: SyncStatus) {
  syncStatus = status
  for (const listener of syncStatusListeners) listener(status)
}

export function loadSyncConflicts(): SyncConflict[] {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(KEYS.syncConflicts))
    return raw ? JSON.parse(raw) as SyncConflict[] : []
  } catch { return [] }
}

export function resolveSyncConflict(id: string, choice: "local" | "remote") {
  const conflict = loadSyncConflicts().find((item) => item.id === id)
  if (!conflict || !conflict.entity) return false
  const key = entityKey(conflict.entity as EntityName)
  const current = localJson<unknown>(key, null)
  const currentLocalValue = Array.isArray(current) && conflict.appId
    ? current.find((item) => item && typeof item === "object" && (item as { id?: string }).id === conflict.appId)
    : current
  const selected = choice === "remote" ? conflict.remotePayload : currentLocalValue ?? conflict.localPayload
  if (selected === undefined) return false
  const value = choice === "local" && selected && typeof selected === "object"
    ? { ...(selected as Record<string, unknown>), updatedAt: new Date().toISOString() }
    : selected
  try {
    if (Array.isArray(current) && value && typeof value === "object" && "id" in value) {
      const next = current.map((item) => item && typeof item === "object" && (item as { id?: string }).id === (value as { id?: string }).id ? value : item)
      writeLocalJson(key, next)
    } else {
      writeLocalJson(key, value)
    }
    const remaining = loadSyncConflicts().filter((item) => item.id !== id)
    window.localStorage.setItem(scopedStorageKey(KEYS.syncConflicts), JSON.stringify(remaining))
    schedulePocketBaseSync()
    return true
  } catch { return false }
}

function recordSyncConflict(error: unknown, details?: Partial<SyncConflict>) {
  const errorText = String(error)
  if (!errorText.startsWith("Error: Conflict") && !errorText.startsWith("Conflict") && !errorText.includes("PocketBase 409")) return
  const existing = loadSyncConflicts()
  const message = errorText.replace(/^Error:\s*/, "")
  if (existing.some((item) =>
    details?.entity && details.appId
      ? item.entity === details.entity && item.appId === details.appId
      : item.message === message,
  )) return
  const conflicts = [...existing, {
    id: crypto.randomUUID(),
    message,
    occurredAt: new Date().toISOString(),
    ...details,
  }]
  try {
    window.localStorage.setItem(scopedStorageKey(KEYS.syncConflicts), JSON.stringify(conflicts.slice(-20)))
  } catch { /* local work remains available even when storage is full */ }
}

/** Test seam: override/clear the configured PocketBase URL at runtime. */
export function setPocketBaseUrl(url: string | null) {
  testUrlOverride = url
}

/** Test seam: reset once-per-session hydration/sync guards. */
export function resetPocketBaseSyncState() {
  syncQueued = false
  hydrationStarted = false
  syncGeneration += 1
  setSyncStatus("idle")
}

/** Read lazily so tests can toggle the endpoint at runtime. */
function configuredUrl(): string {
  if (testUrlOverride !== null) return testUrlOverride
  // Must be a direct import.meta.env.VITE_* access: Vite only statically
  // replaces that exact expression at build time, so the URL gets baked in.
  return import.meta.env.VITE_POCKETBASE_URL?.trim() ?? ""
}


function enabled() {
  return configuredUrl().length > 0
}

function baseUrl() {
  return configuredUrl().replace(/\/+$/, "")
}

function localJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(scopedStorageKey(key))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocalJson<T>(key: string, value: T) {
  const storageKey = scopedStorageKey(key)
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // ignore
  }
  void mirrorState(storageKey, value).catch(() => undefined)
}

async function restoreMissingLocalState() {
  for (const key of Object.values(KEYS)) {
    const storageKey = scopedStorageKey(key)
    if (window.localStorage.getItem(storageKey) !== null) continue
    const value = await restoreState(storageKey).catch(() => undefined)
    if (value === undefined) continue
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* quota remains unavailable */ }
  }
}

function mergeLocalArray(remotePayloads: unknown[], key: string): unknown[] {
  const local = localJson<unknown[]>(key, [])
  const identity = (value: unknown) => {
    if (!value || typeof value !== "object") return String(value)
    const candidate = value as { id?: string; effectiveAt?: string; deletedAt?: string | null }
    if (key.toLowerCase().includes("history")) return `${candidate.id ?? ""}:${candidate.effectiveAt ?? ""}:${candidate.deletedAt ?? "live"}`
    return candidate.id ?? JSON.stringify(value)
  }
  const merged = new Map(local.map((value) => [identity(value), value]))
  for (const value of remotePayloads) merged.set(identity(value), value)
  return [...merged.values()]
}

function isDataUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("data:")
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error("Invalid data URL")
  }
  const mimeType = match[1]
  const base64 = match[2]
  let binary: string
  try {
    binary = atob(base64)
  } catch {
    throw new Error("Invalid data URL")
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], filename, { type: mimeType })
}

function entityAppId(entity: EntityName, value: unknown) {
  if (!value || typeof value !== "object") return entity
  const candidate = value as {
    id?: string
    effectiveAt?: string
    deletedAt?: string | null
  }
  if (entity.endsWith("History")) {
    const id = candidate.id ?? entity
    const effectiveAt = candidate.effectiveAt ?? ""
    const deletedAt = candidate.deletedAt ?? "live"
    return `${id}:${effectiveAt}:${deletedAt}`
  }
  return candidate.id ?? entity
}

function entityKey(entity: EntityName): string {
  switch (entity) {
    case "profile":
      return KEYS.profile
    case "settings":
      return KEYS.settings
    case "accounts":
      return KEYS.accounts
    case "transactions":
      return KEYS.transactions
    case "reserves":
      return KEYS.reserves
    case "corrections":
      return KEYS.corrections
    case "recurringRules":
      return KEYS.recurringRules
    case "profileHistory":
      return KEYS.profileHistory
    case "accountHistory":
      return KEYS.accountHistory
    case "transactionHistory":
      return KEYS.transactionHistory
    case "reserveHistory":
      return KEYS.reserveHistory
  }
}

function historyKey(entity: EntityName): string | null {
  if (entity === "profile") return KEYS.profileHistory
  if (entity === "accounts") return KEYS.accountHistory
  if (entity === "transactions") return KEYS.transactionHistory
  if (entity === "reserves") return KEYS.reserveHistory
  return null
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (!(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  // The API rules scope records to business_id = @request.auth.id, so every
  // request must carry the auth token of the logged-in tenant.
  if (pb.authStore.isValid) {
    headers.set("Authorization", pb.authStore.token)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const externalSignal = init?.signal
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller()
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true })
  }
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeout)
    externalSignal?.removeEventListener("abort", abortFromCaller)
    throw error
  }
  clearTimeout(timeout)
  externalSignal?.removeEventListener("abort", abortFromCaller)
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`PocketBase ${response.status}: ${text}`)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function recordFileUrl(record: PocketBaseRecord, fileToken: string): string | null {
  if (!record.attachment) return null
  // Protected files (collection has a viewRule) need a short-lived file token.
  const token = fileToken ? `?token=${encodeURIComponent(fileToken)}` : ""
  return `${baseUrl()}/api/files/${COLLECTION}/${record.id}/${encodeURIComponent(record.attachment)}${token}`
}

function transactionPayloadForRemote(transaction: Transaction) {
  const payload = { ...transaction }
  delete payload.attachmentRemoteUrl
  if (!isDataUrl(transaction.attachmentDataUrl)) return payload
  return { ...payload, attachmentDataUrl: null }
}

function transactionPayloadForLocal(record: PocketBaseRecord, payload: Transaction, fileToken: string): Transaction {
  const remoteFileUrl = recordFileUrl(record, fileToken)
  return {
    ...payload,
    attachmentName: payload.attachmentName ?? record.attachment ?? null,
    attachmentDataUrl: payload.attachmentDataUrl ?? null,
    attachmentRemoteUrl: payload.attachmentDataUrl?.startsWith("data:") ? null : remoteFileUrl ? remoteFileUrl.split("?")[0] : null,
  }
}

async function listRecords(entity: EntityName, appId?: string): Promise<PocketBaseRecord[]> {
  const records: PocketBaseRecord[] = []
  let page = 1
  const perPage = 200
  while (true) {
    const query = new URLSearchParams({
      perPage: String(perPage),
      page: String(page),
      sort: "-updated",
      filter: `business_id = "${businessId()}" && entity = "${entity}"${appId ? ` && app_id = "${appId}"` : ""}`,
    })
    const result = await requestJson<{ items: PocketBaseRecord[]; totalPages?: number }>(
      `/api/collections/${COLLECTION}/records?${query.toString()}`,
    )
    records.push(...result.items)
    const totalPages = result.totalPages
    if ((totalPages != null && page >= totalPages) || result.items.length < perPage) break
    page += 1
  }
  return records
}

async function upsertRecord(entity: EntityName, appId: string, payload: unknown): Promise<void> {
  // Look up only the tenant/entity/app key being written. Full entity scans
  // made a 100-row sync issue hundreds of unnecessary reads and enlarged the
  // race window between two devices.
  const existing = await listRecords(entity, appId)
  const found = existing.find((record) => record.app_id === appId)
  const sanitizedPayload =
    entity === "transactions" && payload && typeof payload === "object"
      ? transactionPayloadForRemote(payload as Transaction)
      : payload
  const body = {
    business_id: businessId(),
    entity,
    app_id: appId,
    payload: sanitizedPayload,
    revision: (found?.revision ?? 0) + 1,
    deleted_at: null,
  }
  if (found && found.payload && payload && typeof found.payload === "object" && typeof payload === "object") {
    const remoteUpdatedAt = (found.payload as { updatedAt?: unknown }).updatedAt
    const localUpdatedAt = (payload as { updatedAt?: unknown }).updatedAt
    if (typeof remoteUpdatedAt === "string" && typeof localUpdatedAt === "string") {
      if (remoteUpdatedAt > localUpdatedAt) {
        recordSyncConflict(new Error(`Conflict: remote ${entity}/${appId} is newer`), {
          entity,
          appId,
          localPayload: sanitizedPayload,
          remotePayload: found.payload,
        })
        throw new Error(`Conflict: remote ${entity}/${appId} is newer`)
      }
    }
  }
  const formData = new FormData()
  formData.append("business_id", businessId())
  formData.append("entity", entity)
  formData.append("app_id", appId)
  formData.append("payload", JSON.stringify(sanitizedPayload))
  formData.append("revision", String(body.revision))
  formData.append("deleted_at", "")
  if (entity === "transactions" && payload && typeof payload === "object") {
    const transaction = payload as Transaction
    if (isDataUrl(transaction.attachmentDataUrl)) {
      const filename = transaction.attachmentName ?? "attachment"
      formData.append("attachment", dataUrlToFile(transaction.attachmentDataUrl, filename))
    }
  }
  const hasAttachment = entity === "transactions" && payload && typeof payload === "object" && isDataUrl((payload as Transaction).attachmentDataUrl)
  try {
    if (found) {
      await requestJson(
        `/api/collections/${COLLECTION}/records/${found.id}`,
        hasAttachment
          ? { method: "PATCH", body: formData }
          : { method: "PATCH", body: JSON.stringify(body) },
      )
    } else {
      await requestJson(
        `/api/collections/${COLLECTION}/records`,
        hasAttachment
          ? { method: "POST", body: formData }
          : { method: "POST", body: JSON.stringify(body) },
      )
    }
  } catch (error) {
    if (String(error).includes("PocketBase 409")) {
      recordSyncConflict(error, {
        entity,
        appId,
        localPayload: sanitizedPayload,
        remotePayload: found?.payload,
      })
    }
    throw error
  }
}

async function pruneExplicitlyDeleted(entity: EntityName) {
  const key = historyKey(entity)
  if (!key) return
  const history = localJson<Array<{ id?: string; deletedAt?: string | null }>>(key, [])
  const deletedIds = new Set(history.filter((record) => record.deletedAt).map((record) => record.id).filter(Boolean))
  if (deletedIds.size === 0) return
  const remote = await listRecords(entity)
  await Promise.all(
    remote
      .filter((record) => deletedIds.has(record.app_id))
      .map((record) => requestJson(`/api/collections/${COLLECTION}/records/${record.id}`, { method: "DELETE" })),
  )
}

async function syncToPocketBaseUnsafe(runGeneration: number, runBusinessId: string) {
  if (!enabled() || typeof window === "undefined") return
  const states: Partial<LocalStateMap> = {
    profile: localJson(KEYS.profile, null),
    settings: localJson(KEYS.settings, null),
    accounts: localJson(KEYS.accounts, []),
    transactions: localJson(KEYS.transactions, []),
    reserves: localJson(KEYS.reserves, []),
    corrections: localJson(KEYS.corrections, []),
    recurringRules: localJson(KEYS.recurringRules, []),
    profileHistory: localJson(KEYS.profileHistory, []),
    accountHistory: localJson(KEYS.accountHistory, []),
    transactionHistory: localJson(KEYS.transactionHistory, []),
    reserveHistory: localJson(KEYS.reserveHistory, []),
  }

  const queuedKeys = new Set((await listOutbox()).map((row) => row.key))
  const hasQueuedState = queuedKeys.size > 0

  for (const [entity, value] of Object.entries(states) as Array<[EntityName, unknown]>) {
    if (hasQueuedState && !queuedKeys.has(scopedStorageKey(entityKey(entity)))) continue
    // Never continue a request sequence after logout or tenant switch.
    if (runGeneration !== syncGeneration || runBusinessId !== businessId()) {
      throw new Error("Sync cancelled: account changed")
    }
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const item of value as Array<{ id?: string }>) {
        const appId = entityAppId(entity, item)
        await upsertRecord(entity, appId, item)
      }
      // A missing item is ambiguous across devices. Only explicit tombstones
      // may delete a remote record.
      await pruneExplicitlyDeleted(entity)
    } else {
      await upsertRecord(entity, entity, value)
      await pruneExplicitlyDeleted(entity)
    }
  }
  await acknowledgeOutbox(Object.values(KEYS).map((key) => scopedStorageKey(key)))
}

export async function syncToPocketBase() {
  const runGeneration = syncGeneration
  const runBusinessId = businessId()
  setSyncStatus("syncing")
  try {
    const result = await syncToPocketBaseUnsafe(runGeneration, runBusinessId)
    setSyncStatus("synced")
    return result
  } catch (error) {
    recordSyncConflict(error)
    setSyncStatus("failed")
    throw error
  }
}

function retryableSyncError(error: unknown) {
  const status = Number(String(error).match(/PocketBase (\d{3})/)?.[1] ?? 0)
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

async function syncWithRetry() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await syncToPocketBase()
      return
    } catch (error) {
      if (!retryableSyncError(error) || attempt === 2) throw error
      setSyncStatus("retrying")
      const exponentialDelay = 400 * 2 ** attempt
      const jitter = Math.floor(Math.random() * 200)
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, exponentialDelay + jitter)))
    }
  }
}

export async function hydrateFromPocketBase() {
  if (!enabled() || typeof window === "undefined") return false
  const entities: EntityName[] = [
    "profile",
    "settings",
    "accounts",
    "transactions",
    "reserves",
    "corrections",
    "recurringRules",
    "profileHistory",
    "accountHistory",
    "transactionHistory",
    "reserveHistory",
  ]

  let foundAny = false
  // Files are protected by the collection view rule; a short-lived token lets
  // payload URLs render attachments. Empty token = public files (local dev).
  const fileToken = await pb.files
    .getToken()
    .then((token) => token)
    .catch(() => "")
  for (const entity of entities) {
    const remote = await listRecords(entity)
    if (remote.length === 0) continue
    foundAny = true
    const key = entityKey(entity)
    if (entity === "profile" || entity === "settings") {
      const payload = remote[0]?.payload ?? null
      const local = localJson<unknown>(key, null)
      const localUpdatedAt = local && typeof local === "object" ? (local as { updatedAt?: unknown }).updatedAt : undefined
      const remoteUpdatedAt = payload && typeof payload === "object" ? (payload as { updatedAt?: unknown }).updatedAt : undefined
      // A device may have a durable offline edit that has not reached the
      // server yet. Do not erase it during startup hydration.
      if (!(typeof localUpdatedAt === "string" && typeof remoteUpdatedAt === "string" && localUpdatedAt > remoteUpdatedAt)) {
        writeLocalJson(key, payload)
      }
      continue
    }
    writeLocalJson(
      key,
      mergeLocalArray(
        remote
        .map((record) => {
          const payload = record.payload
          if (!payload || typeof payload !== "object") return payload
          if (entity === "transactions") {
            return transactionPayloadForLocal(record, payload as Transaction, fileToken)
          }
          return payload
        })
        .filter((payload) => payload !== null && payload !== undefined),
        key,
      ),
    )
  }
  return foundAny
}

export function schedulePocketBaseSync() {
  if (!enabled() || typeof window === "undefined") return
  if (syncQueued) return
  syncQueued = true
  queueMicrotask(() => {
    syncQueued = false
    void syncWithRetry().catch(() => {
      // Keep local data available; the visible status remains failed so the
      // user can retry on reconnect/focus or the next mutation.
    })
  })
}

export async function initializePocketBaseSync() {
  if (typeof window === "undefined") return false
  if (hydrationStarted) return false
  hydrationStarted = true
  try {
    await restoreMissingLocalState()
    if (!enabled()) {
      hydrationStarted = false
      return false
    }
    await hydrateFromPocketBase()
    return true
  } catch {
    hydrationStarted = false
    return false
  }
}

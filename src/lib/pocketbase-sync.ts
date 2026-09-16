import type { Account, AppSettings, BusinessProfile, CompanyScope, CorrectionPattern, RecurringRule, Reserve, Transaction } from "./types"
import { getCompanyScope, KEYS, RESET_PENDING_KEY, scopedStorageKey, storageKeyForScope } from "./store"
import { pb } from "./pb"
import { acknowledgeOutboxSnapshots, clearMirroredState, listOutbox, mirrorState, restoreState } from "./local-db"

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
  company_id?: string
  data_epoch?: number
  payload: unknown
  attachment?: string | null
  updated: string
  created: string
  revision?: number
  deleted_at?: string | null
}

const COLLECTION = "jornal_records"
export const CLIENT_UPDATE_REQUIRED_EVENT = "jornal:client-update-required"

function companyScope(): CompanyScope {
  const scope = getCompanyScope()
  return {
    tenantId: pb.authStore.isValid ? (pb.authStore.record?.id ?? scope.tenantId) : scope.tenantId,
    companyId: scope.companyId,
    dataEpoch: scope.dataEpoch,
  }
}

function sameScope(a: CompanyScope, b = companyScope()) {
  return a.tenantId === b.tenantId && a.companyId === b.companyId && a.dataEpoch === b.dataEpoch
}

let testUrlOverride: string | null = null
let syncGeneration = 0
const activeRequestControllers = new Set<AbortController>()
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
interface ScopeRuntime {
  syncQueued: boolean
  hydrationStarted: boolean
  hydrationState: "idle" | "ready" | "unavailable"
  syncStatus: SyncStatus
  running?: Promise<unknown>
}

const scopeRuntimes = new Map<string, ScopeRuntime>()
const syncStatusListeners = new Set<(status: SyncStatus) => void>()

function scopeId(scope: CompanyScope) {
  return `${scope.tenantId}:${scope.companyId}:${scope.dataEpoch}`
}

function runtimeFor(scope = companyScope()) {
  const id = scopeId(scope)
  let runtime = scopeRuntimes.get(id)
  if (!runtime) {
    runtime = { syncQueued: false, hydrationStarted: false, hydrationState: "idle", syncStatus: "idle" }
    scopeRuntimes.set(id, runtime)
  }
  return runtime
}

export function getSyncStatus() {
  return runtimeFor().syncStatus
}

/** Distinguishes a known empty account from a backend we could not reach. */
export function getHydrationState() {
  return runtimeFor().hydrationState
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void) {
  syncStatusListeners.add(listener)
  return () => { syncStatusListeners.delete(listener) }
}

function setSyncStatus(status: SyncStatus, scope = companyScope()) {
  runtimeFor(scope).syncStatus = status
  if (sameScope(scope)) for (const listener of syncStatusListeners) listener(status)
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

function recordSyncConflict(error: unknown, details?: Partial<SyncConflict>, scope = companyScope()) {
  const errorText = String(error)
  if (!errorText.startsWith("Error: Conflict") && !errorText.startsWith("Conflict") && !errorText.includes("PocketBase 409")) return
  const existing = localJson<SyncConflict[]>(KEYS.syncConflicts, [], scope)
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
    window.localStorage.setItem(storageKeyForScope(scope, KEYS.syncConflicts), JSON.stringify(conflicts.slice(-20)))
  } catch { /* local work remains available even when storage is full */ }
}

/** Test seam: override/clear the configured PocketBase URL at runtime. */
export function setPocketBaseUrl(url: string | null) {
  testUrlOverride = url
  for (const controller of activeRequestControllers) controller.abort("PocketBase endpoint changed")
  activeRequestControllers.clear()
  scopeRuntimes.clear()
  syncGeneration += 1
}

/** Test seam: reset once-per-session hydration/sync guards. */
export function resetPocketBaseSyncState() {
  for (const controller of activeRequestControllers) controller.abort("Authentication session changed")
  activeRequestControllers.clear()
  scopeRuntimes.clear()
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

function localJson<T>(key: string, fallback: T, scope?: CompanyScope): T {
  try {
    const raw = window.localStorage.getItem(scope ? storageKeyForScope(scope, key) : scopedStorageKey(key))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocalJson<T>(key: string, value: T, scope?: CompanyScope) {
  const storageKey = scope ? storageKeyForScope(scope, key) : scopedStorageKey(key)
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // ignore
  }
  void mirrorState(storageKey, value).catch(() => undefined)
}

async function restoreMissingLocalState(scope = companyScope()) {
  for (const key of Object.values(KEYS)) {
    const storageKey = storageKeyForScope(scope, key)
    if (window.localStorage.getItem(storageKey) !== null) continue
    const value = await restoreState(storageKey).catch(() => undefined)
    if (value === undefined) continue
    try { window.localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* quota remains unavailable */ }
  }
}

function hasCachedCompanyState(scope: CompanyScope) {
  return [KEYS.profile, KEYS.settings, KEYS.accounts, KEYS.transactions]
    .some((key) => window.localStorage.getItem(storageKeyForScope(scope, key)) !== null)
}

function mergeLocalArray(remotePayloads: unknown[], key: string, scope?: CompanyScope): unknown[] {
  const local = localJson<unknown[]>(key, [], scope)
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

async function requestJson<T>(path: string, init?: RequestInit, scope = companyScope()): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (!(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  // The API rules scope records to business_id = @request.auth.id, so every
  // request must carry the auth token of the logged-in tenant.
  if (pb.authStore.isValid) {
    headers.set("Authorization", pb.authStore.token)
  }
  headers.set("X-Jornal-Protocol", "2")
  headers.set("X-Jornal-Company", scope.companyId)
  headers.set("X-Jornal-Data-Epoch", String(scope.dataEpoch))
  const controller = new AbortController()
  activeRequestControllers.add(controller)
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
    activeRequestControllers.delete(controller)
    throw error
  }
  clearTimeout(timeout)
  externalSignal?.removeEventListener("abort", abortFromCaller)
  activeRequestControllers.delete(controller)
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    if (response.status === 426 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(CLIENT_UPDATE_REQUIRED_EVENT))
    }
    throw new Error(`PocketBase ${response.status}: ${text}`)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function recordFileUrl(record: PocketBaseRecord, fileToken: string): string | null {
  if (!record.attachment) return null
  // Protected files (collection has a viewRule) need a short-lived file token.
  const query = new URLSearchParams({ protocol: "2", company: record.company_id ?? companyScope().companyId })
  if (fileToken) query.set("token", fileToken)
  return `${baseUrl()}/api/files/${COLLECTION}/${record.id}/${encodeURIComponent(record.attachment)}?${query.toString()}`
}

function transactionPayloadForRemote(transaction: Transaction) {
  const payload = { ...transaction }
  delete payload.attachmentRemoteUrl
  if (!isDataUrl(transaction.attachmentDataUrl)) return payload
  return { ...payload, attachmentDataUrl: null }
}

function transactionPayloadForLocal(record: PocketBaseRecord, payload: Transaction, fileToken: string): Transaction {
  const remoteFileUrl = recordFileUrl(record, fileToken)
  let stableRemoteFileUrl: string | null = null
  if (remoteFileUrl) {
    const parsed = new URL(remoteFileUrl)
    parsed.searchParams.delete("token")
    stableRemoteFileUrl = parsed.toString()
  }
  return {
    ...payload,
    attachmentName: payload.attachmentName ?? record.attachment ?? null,
    attachmentDataUrl: payload.attachmentDataUrl ?? null,
    attachmentRemoteUrl: payload.attachmentDataUrl?.startsWith("data:") ? null : stableRemoteFileUrl,
  }
}

async function listRecords(entity: EntityName, appId?: string, requestedScope = companyScope()): Promise<PocketBaseRecord[]> {
  const records: PocketBaseRecord[] = []
  let page = 1
  const perPage = 200
  while (true) {
    const query = new URLSearchParams({
      perPage: String(perPage),
      page: String(page),
      sort: "-updated",
      filter: `business_id = "${requestedScope.tenantId}" && company_id = "${requestedScope.companyId}" && entity = "${entity}"${appId ? ` && app_id = "${appId}"` : ""}`,
    })
    const result = await requestJson<{ items: PocketBaseRecord[]; totalPages?: number }>(
      `/api/collections/${COLLECTION}/records?${query.toString()}`,
      undefined,
      requestedScope,
    )
    records.push(...result.items)
    const totalPages = result.totalPages
    if ((totalPages != null && page >= totalPages) || result.items.length < perPage) break
    page += 1
  }
  return records
}

async function upsertRecord(entity: EntityName, appId: string, payload: unknown, requestedScope = companyScope()): Promise<void> {
  // Look up only the tenant/entity/app key being written. Full entity scans
  // made a 100-row sync issue hundreds of unnecessary reads and enlarged the
  // race window between two devices.
  const existing = await listRecords(entity, appId, requestedScope)
  const found = existing.find((record) => record.app_id === appId)
  const sanitizedPayload =
    entity === "transactions" && payload && typeof payload === "object"
      ? transactionPayloadForRemote(payload as Transaction)
      : payload
  const body = {
    business_id: requestedScope.tenantId,
    company_id: requestedScope.companyId,
    data_epoch: requestedScope.dataEpoch,
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
        }, requestedScope)
        throw new Error(`Conflict: remote ${entity}/${appId} is newer`)
      }
    }
  }
  const formData = new FormData()
  formData.append("business_id", requestedScope.tenantId)
  formData.append("company_id", requestedScope.companyId)
  formData.append("data_epoch", String(requestedScope.dataEpoch))
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
        requestedScope,
      )
    } else {
      await requestJson(
        `/api/collections/${COLLECTION}/records`,
        hasAttachment
          ? { method: "POST", body: formData }
          : { method: "POST", body: JSON.stringify(body) },
        requestedScope,
      )
    }
  } catch (error) {
    if (String(error).includes("PocketBase 409")) {
      recordSyncConflict(error, {
        entity,
        appId,
        localPayload: sanitizedPayload,
        remotePayload: found?.payload,
      }, requestedScope)
    }
    throw error
  }
}

async function pruneExplicitlyDeleted(entity: EntityName, requestedScope = companyScope()) {
  const key = historyKey(entity)
  if (!key) return
  const history = localJson<Array<{ id?: string; deletedAt?: string | null }>>(key, [], requestedScope)
  const deletedIds = new Set(history.filter((record) => record.deletedAt).map((record) => record.id).filter(Boolean))
  if (deletedIds.size === 0) return
  const remote = await listRecords(entity, undefined, requestedScope)
  await Promise.all(
    remote
      .filter((record) => deletedIds.has(record.app_id))
      .map((record) => requestJson(`/api/collections/${COLLECTION}/records/${record.id}`, { method: "DELETE" }, requestedScope)),
  )
}

async function processPendingReset(runScope: CompanyScope) {
  const markerKey = storageKeyForScope(runScope, RESET_PENDING_KEY)
  // The marker is an ISO string written directly so it remains readable even
  // if a previous localStorage JSON payload was corrupted.
  if (!window.localStorage.getItem(markerKey)) return false
  for (const entity of ["profile", "settings", "accounts", "transactions", "reserves", "corrections", "recurringRules", "profileHistory", "accountHistory", "transactionHistory", "reserveHistory"] as EntityName[]) {
    const records = await listRecords(entity, undefined, runScope)
    for (const record of records) {
      try {
        await requestJson(`/api/collections/${COLLECTION}/records/${record.id}`, { method: "DELETE" }, runScope)
      } catch (error) {
        // A concurrent device may have deleted the row already; reset remains
        // idempotent. Other failures must keep the marker for retry.
        if (!String(error).includes("PocketBase 404")) throw error
      }
    }
  }
  try { window.localStorage.removeItem(markerKey) } catch { /* durable mirror cleanup still follows */ }
  await clearResetMarker(markerKey)
  return true
}

async function clearResetMarker(markerKey: string) {
  await clearMirroredState(markerKey).catch(() => undefined)
}

async function syncToPocketBaseUnsafe(runGeneration: number, runScope: CompanyScope) {
  if (!enabled() || typeof window === "undefined") return
  await processPendingReset(runScope)
  const states: Partial<LocalStateMap> = {
    profile: localJson(KEYS.profile, null, runScope),
    settings: localJson(KEYS.settings, null, runScope),
    accounts: localJson(KEYS.accounts, [], runScope),
    transactions: localJson(KEYS.transactions, [], runScope),
    reserves: localJson(KEYS.reserves, [], runScope),
    corrections: localJson(KEYS.corrections, [], runScope),
    recurringRules: localJson(KEYS.recurringRules, [], runScope),
    profileHistory: localJson(KEYS.profileHistory, [], runScope),
    accountHistory: localJson(KEYS.accountHistory, [], runScope),
    transactionHistory: localJson(KEYS.transactionHistory, [], runScope),
    reserveHistory: localJson(KEYS.reserveHistory, [], runScope),
  }

  const scopePrefix = storageKeyForScope(runScope, "")
  const queuedRows = (await listOutbox()).filter((row) => row.key.startsWith(scopePrefix))
  const queuedKeys = new Set(queuedRows.map((row) => row.key))
  const hasQueuedState = queuedRows.length > 0

  for (const [entity, value] of Object.entries(states) as Array<[EntityName, unknown]>) {
    if (hasQueuedState && !queuedKeys.has(storageKeyForScope(runScope, entityKey(entity)))) continue
    // Never continue a request sequence after logout or tenant switch.
    if (runGeneration !== syncGeneration) {
      throw new Error("Sync cancelled: session changed")
    }
    if (value == null) continue
    if (Array.isArray(value)) {
      const items = entity === "transactions"
        ? [...value].sort((a, b) => Number((a as Transaction).classification === "RECEIVABLE_PAYMENT") - Number((b as Transaction).classification === "RECEIVABLE_PAYMENT"))
        : value
      for (const item of items as Array<{ id?: string }>) {
        const appId = entityAppId(entity, item)
      await upsertRecord(entity, appId, item, runScope)
      }
      // A missing item is ambiguous across devices. Only explicit tombstones
      // may delete a remote record.
      await pruneExplicitlyDeleted(entity, runScope)
    } else {
      await upsertRecord(entity, entity, value, runScope)
      await pruneExplicitlyDeleted(entity, runScope)
    }
  }
  await acknowledgeOutboxSnapshots(queuedRows)
}

export async function syncToPocketBase(runScope = companyScope()) {
  const runGeneration = syncGeneration
  const runtime = runtimeFor(runScope)
  if (runtime.running) return runtime.running
  setSyncStatus("syncing", runScope)
  const run = (async () => {
  try {
    const result = await syncToPocketBaseUnsafe(runGeneration, runScope)
    setSyncStatus("synced", runScope)
    return result
  } catch (error) {
    recordSyncConflict(error, undefined, runScope)
    setSyncStatus("failed", runScope)
    throw error
  } finally {
    runtime.running = undefined
  }
  })()
  runtime.running = run
  return run
}

function retryableSyncError(error: unknown) {
  const status = Number(String(error).match(/PocketBase (\d{3})/)?.[1] ?? 0)
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

async function syncWithRetry(scope = companyScope()) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await syncToPocketBase(scope)
      return
    } catch (error) {
      if (!retryableSyncError(error) || attempt === 2) throw error
      setSyncStatus("retrying", scope)
      const exponentialDelay = 400 * 2 ** attempt
      const jitter = Math.floor(Math.random() * 200)
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, exponentialDelay + jitter)))
    }
  }
}

export async function hydrateFromPocketBase(runScope = companyScope()) {
  if (!enabled() || typeof window === "undefined") return false
  const runGeneration = syncGeneration
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
    if (runGeneration !== syncGeneration) throw new Error("Hydration cancelled: session changed")
    const remote = await listRecords(entity, undefined, runScope)
    if (runGeneration !== syncGeneration) throw new Error("Hydration cancelled: session changed")
    if (remote.length === 0) continue
    foundAny = true
    const key = entityKey(entity)
    if (entity === "profile" || entity === "settings") {
      const payload = remote[0]?.payload ?? null
      const local = localJson<unknown>(key, null, runScope)
      const localUpdatedAt = local && typeof local === "object" ? (local as { updatedAt?: unknown }).updatedAt : undefined
      const remoteUpdatedAt = payload && typeof payload === "object" ? (payload as { updatedAt?: unknown }).updatedAt : undefined
      // A device may have a durable offline edit that has not reached the
      // server yet. Do not erase it during startup hydration.
      if (!(typeof localUpdatedAt === "string" && typeof remoteUpdatedAt === "string" && localUpdatedAt > remoteUpdatedAt)) {
        writeLocalJson(key, payload, runScope)
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
        runScope,
      ),
      runScope,
    )
  }
  return foundAny
}

export function schedulePocketBaseSync() {
  if (!enabled() || typeof window === "undefined") return
  const scope = companyScope()
  const runtime = runtimeFor(scope)
  if (runtime.syncQueued) return
  runtime.syncQueued = true
  queueMicrotask(() => {
    runtime.syncQueued = false
    void syncWithRetry(scope).catch(() => {
      // Keep local data available; the visible status remains failed so the
      // user can retry on reconnect/focus or the next mutation.
    })
  })
}

/** Retry pending mutations for every cached active company of the logged-in
 * tenant. Runs at most two scopes concurrently and never changes UI scope. */
export async function syncPendingCompanies() {
  if (!enabled() || typeof window === "undefined" || !pb.authStore.isValid) return
  const [{ loadCachedCompanies }, rows] = await Promise.all([
    import("./companies"),
    listOutbox(),
  ])
  const tenantId = pb.authStore.record?.id ?? ""
  const scopes = loadCachedCompanies()
    .filter((company) => company.tenantId === tenantId && company.status === "ACTIVE")
    .filter((company) => {
      const prefix = storageKeyForScope({ tenantId, companyId: company.id, dataEpoch: company.dataEpoch }, "")
      const resetKey = storageKeyForScope({ tenantId, companyId: company.id, dataEpoch: company.dataEpoch }, RESET_PENDING_KEY)
      return rows.some((row) => row.key.startsWith(prefix)) || window.localStorage.getItem(resetKey) !== null
    })
    .map((company) => ({ tenantId, companyId: company.id, dataEpoch: company.dataEpoch }))
  let cursor = 0
  const worker = async () => {
    while (cursor < scopes.length) {
      const scope = scopes[cursor++]
      await syncWithRetry(scope).catch(() => undefined)
    }
  }
  await Promise.all([worker(), worker()])
}

export async function initializePocketBaseSync() {
  if (typeof window === "undefined") return false
  const runScope = companyScope()
  const runtime = runtimeFor(runScope)
  if (runtime.hydrationStarted) return false
  runtime.hydrationStarted = true
  try {
    await restoreMissingLocalState(runScope)
    if (navigator.onLine === false) {
      runtime.hydrationStarted = false
      runtime.hydrationState = hasCachedCompanyState(runScope) ? "ready" : "unavailable"
      return false
    }
    if (!enabled()) {
      runtime.hydrationStarted = false
      runtime.hydrationState = "ready"
      return false
    }
    await hydrateFromPocketBase(runScope)
    runtime.hydrationState = "ready"
    return true
  } catch {
    runtime.hydrationStarted = false
    runtime.hydrationState = hasCachedCompanyState(runScope) ? "ready" : "unavailable"
    if (runtime.hydrationState === "ready") setSyncStatus("failed", runScope)
    return false
  }
}

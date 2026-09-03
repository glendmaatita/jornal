import type { Account, AppSettings, BusinessProfile, CorrectionPattern, RecurringRule, Reserve, Transaction } from "./types"
import { KEYS } from "./store"

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
}

const COLLECTION = "jornal_records"
const BUSINESS_ID = "local"

let testUrlOverride: string | null = null

/** Test seam: override/clear the configured PocketBase URL at runtime. */
export function setPocketBaseUrl(url: string | null) {
  testUrlOverride = url
}

/** Test seam: reset once-per-session hydration/sync guards. */
export function resetPocketBaseSyncStateForTests() {
  syncQueued = false
  hydrationStarted = false
}

/** Read lazily so tests can toggle the endpoint at runtime. */
function configuredUrl(): string {
  if (testUrlOverride !== null) return testUrlOverride
  // Must be a direct import.meta.env.VITE_* access: Vite only statically
  // replaces that exact expression at build time, so the URL gets baked in.
  return import.meta.env.VITE_POCKETBASE_URL?.trim() ?? ""
}

let syncQueued = false
let hydrationStarted = false

function enabled() {
  return configuredUrl().length > 0
}

function baseUrl() {
  return configuredUrl().replace(/\/+$/, "")
}

function localJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocalJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore
  }
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {})
  if (!(init?.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`PocketBase ${response.status}: ${text}`)
  }
  return (await response.json()) as T
}

function recordFileUrl(record: PocketBaseRecord): string | null {
  if (!record.attachment) return null
  return `${baseUrl()}/api/files/${COLLECTION}/${record.id}/${encodeURIComponent(record.attachment)}`
}

function transactionPayloadForRemote(transaction: Transaction) {
  if (!isDataUrl(transaction.attachmentDataUrl)) return transaction
  return {
    ...transaction,
    attachmentDataUrl: null,
  }
}

function transactionPayloadForLocal(record: PocketBaseRecord, payload: Transaction): Transaction {
  const remoteFileUrl = recordFileUrl(record)
  return {
    ...payload,
    attachmentName: payload.attachmentName ?? record.attachment ?? null,
    attachmentDataUrl: payload.attachmentDataUrl ?? remoteFileUrl,
  }
}

async function listRecords(entity: EntityName): Promise<PocketBaseRecord[]> {
  const records: PocketBaseRecord[] = []
  let page = 1
  const perPage = 200
  while (true) {
    const query = new URLSearchParams({
      perPage: String(perPage),
      page: String(page),
      sort: "-updated",
      filter: `business_id = "${BUSINESS_ID}" && entity = "${entity}"`,
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
  const existing = await listRecords(entity)
  const found = existing.find((record) => record.app_id === appId)
  const sanitizedPayload =
    entity === "transactions" && payload && typeof payload === "object"
      ? transactionPayloadForRemote(payload as Transaction)
      : payload
  const body = {
    business_id: BUSINESS_ID,
    entity,
    app_id: appId,
    payload: sanitizedPayload,
  }
  const formData = new FormData()
  formData.append("business_id", BUSINESS_ID)
  formData.append("entity", entity)
  formData.append("app_id", appId)
  formData.append("payload", JSON.stringify(sanitizedPayload))
  if (entity === "transactions" && payload && typeof payload === "object") {
    const transaction = payload as Transaction
    if (isDataUrl(transaction.attachmentDataUrl)) {
      const filename = transaction.attachmentName ?? "attachment"
      formData.append("attachment", dataUrlToFile(transaction.attachmentDataUrl, filename))
    }
  }
  const hasAttachment = entity === "transactions" && payload && typeof payload === "object" && isDataUrl((payload as Transaction).attachmentDataUrl)
  if (found) {
    await requestJson(
      `/api/collections/${COLLECTION}/records/${found.id}`,
      hasAttachment
        ? {
            method: "PATCH",
            body: formData,
          }
        : {
            method: "PATCH",
            body: JSON.stringify(body),
          },
    )
  } else {
    await requestJson(
      `/api/collections/${COLLECTION}/records`,
      hasAttachment
        ? {
            method: "POST",
            body: formData,
          }
        : {
            method: "POST",
            body: JSON.stringify(body),
          },
    )
  }
}

async function pruneMissing(entity: EntityName, keepAppIds: Set<string>) {
  const remote = await listRecords(entity)
  await Promise.all(
    remote
      .filter((record) => !keepAppIds.has(record.app_id))
      .map((record) =>
        requestJson(`/api/collections/${COLLECTION}/records/${record.id}`, {
          method: "DELETE",
        }),
      ),
  )
}

export async function syncToPocketBase() {
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

  for (const [entity, value] of Object.entries(states) as Array<[EntityName, unknown]>) {
    if (value == null) continue
    if (Array.isArray(value)) {
      const keep = new Set<string>()
      for (const item of value as Array<{ id?: string }>) {
        const appId = entityAppId(entity, item)
        keep.add(appId)
        await upsertRecord(entity, appId, item)
      }
      await pruneMissing(entity, keep)
    } else {
      await upsertRecord(entity, entity, value)
      await pruneMissing(entity, new Set([entity]))
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
  for (const entity of entities) {
    const remote = await listRecords(entity)
    if (remote.length === 0) continue
    foundAny = true
    const key = entityKey(entity)
    if (entity === "profile" || entity === "settings") {
      const payload = remote[0]?.payload ?? null
      writeLocalJson(key, payload)
      continue
    }
    writeLocalJson(
      key,
      remote
        .map((record) => {
          const payload = record.payload
          if (!payload || typeof payload !== "object") return payload
          if (entity === "transactions") {
            return transactionPayloadForLocal(record, payload as Transaction)
          }
          return payload
        })
        .filter((payload) => payload !== null && payload !== undefined),
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
    void syncToPocketBase().catch(() => {
      // Keep the local-first app working if backend sync is unavailable.
    })
  })
}

export async function initializePocketBaseSync() {
  if (!enabled() || typeof window === "undefined") return false
  if (hydrationStarted) return false
  hydrationStarted = true
  try {
    await hydrateFromPocketBase()
    return true
  } catch {
    return false
  }
}

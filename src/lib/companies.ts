import { copyOutboxByPrefix, listMirroredStateByPrefix, listOutbox, mirrorState, persistState, quarantineOutboxByPrefix, restoreState } from "./local-db"
import { pb } from "./pb"
import { KEYS, RESET_PENDING_KEY, setCompanyDisplayName } from "./store"
import type { Account, AppSettings, BusinessProfile, Company } from "./types"

const catalogVersion = 1
const listeners = new Set<() => void>()
const CREATION_RETURN_KEY = "jornal.company-creation-return.v1"
export const multiCompanyCreationEnabled = import.meta.env.VITE_MULTI_COMPANY_ENABLED !== "false"

function tenantId() {
  return pb.authStore.record?.id ?? "local"
}

function catalogKey(id = tenantId()) {
  return `jornal.${id}.companies.v${catalogVersion}`
}

function selectedCompanyKey(id = tenantId()) {
  return `jornal.${id}.selected-company.v1`
}

function parseCompany(record: Record<string, unknown>): Company {
  return {
    id: String(record.id ?? ""),
    tenantId: String(record.tenant_id ?? record.tenantId ?? ""),
    name: String(record.name ?? "Bisnis Saya"),
    status: record.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
    onboardingCompletedAt: String(record.onboarding_completed_at ?? record.onboardingCompletedAt ?? "") || null,
    legacyDefault: Boolean(record.legacy_default ?? record.legacyDefault),
    dataEpoch: Number(record.data_epoch ?? record.dataEpoch ?? 1),
    revision: Number(record.revision ?? 1),
    archivedAt: String(record.archived_at ?? record.archivedAt ?? "") || null,
    createdAt: String(record.created ?? record.createdAt ?? ""),
    updatedAt: String(record.updated ?? record.updatedAt ?? ""),
  }
}

function saveCatalog(companies: Company[]) {
  try { window.localStorage.setItem(catalogKey(), JSON.stringify(companies)) } catch { /* IndexedDB remains authoritative */ }
  void mirrorState(catalogKey(), companies).catch(() => undefined)
  for (const listener of listeners) listener()
}

export function subscribeCompanies(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function loadCachedCompanies(): Company[] {
  try {
    const raw = window.localStorage.getItem(catalogKey())
    return raw ? (JSON.parse(raw) as Company[]) : []
  } catch { return [] }
}

export async function loadCompanies(): Promise<Company[]> {
  if (!pb.authStore.isValid) return []
  try {
    const records = await pb.collection("companies").getFullList({ sort: "created" })
    const companies = records.map((record) => parseCompany(record))
    saveCatalog(companies)
    return companies
  } catch (error) {
    let cached = loadCachedCompanies()
    if (cached.length === 0) {
      const durable = await restoreState(catalogKey()).catch(() => undefined)
      if (Array.isArray(durable)) {
        cached = durable as Company[]
        saveCatalog(cached)
      }
    }
    if (cached.length > 0) return cached
    throw error
  }
}

export function selectedCompanyId(): string | null {
  const companies = loadCachedCompanies()
  let selected = ""
  try {
    selected = window.sessionStorage.getItem(selectedCompanyKey())
      ?? window.localStorage.getItem(selectedCompanyKey())
      ?? ""
  } catch { /* fallback below */ }
  const company = companies.find((item) => item.id === selected)
    ?? companies.find((item) => item.legacyDefault && item.status === "ACTIVE")
    ?? companies.find((item) => item.status === "ACTIVE")
    ?? companies[0]
  return company?.id ?? null
}

export function selectCompany(id: string) {
  const company = loadCachedCompanies().find((item) => item.id === id)
  if (!company) throw new Error("Company tidak ditemukan")
  try {
    window.sessionStorage.setItem(selectedCompanyKey(), id)
    window.localStorage.setItem(selectedCompanyKey(), id)
  } catch { /* selection still applies to the current in-memory scope */ }
  for (const listener of listeners) listener()
  return company
}

export function activeCompany(): Company | null {
  const id = selectedCompanyId()
  return loadCachedCompanies().find((company) => company.id === id) ?? null
}

export function rememberCompanyCreationReturn(href = window.location.href) {
  try { window.sessionStorage.setItem(CREATION_RETURN_KEY, href) } catch { /* optional convenience only */ }
}

export function consumeCompanyCreationReturn() {
  try {
    const href = window.sessionStorage.getItem(CREATION_RETURN_KEY)
    window.sessionStorage.removeItem(CREATION_RETURN_KEY)
    return href
  } catch { return null }
}

interface CreateCompanyInput {
  name: string
  creationKey: string
  requestId?: string
  profile: BusinessProfile
  accounts: Account[]
  settings?: AppSettings
  initialSetup?: boolean
  companyId?: string
}

export async function createCompanyWithSetup(input: CreateCompanyInput): Promise<Company> {
  const response = await fetch(`${pb.baseURL.replace(/\/$/, "")}/api/jornal/companies/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
    body: JSON.stringify(input),
  })
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(data.message ?? "Company gagal dibuat"))
  const company = parseCompany(data)
  const next = [...loadCachedCompanies().filter((item) => item.id !== company.id), company]
  saveCatalog(next.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
  selectCompany(company.id)
  return company
}

export async function updateCompany(company: Company, patch: { name?: string; status?: "ACTIVE" | "ARCHIVED" }) {
  const data: Record<string, unknown> = { revision: company.revision, requestId: crypto.randomUUID() }
  if (patch.name !== undefined) data.name = patch.name.trim().slice(0, 100)
  if (patch.status !== undefined) data.status = patch.status
  const response = await fetch(`${pb.baseURL.replace(/\/$/, "")}/api/jornal/companies/${encodeURIComponent(company.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
    body: JSON.stringify(data),
  })
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(body.message ?? "Company gagal diperbarui"))
  const updated = parseCompany(body)
  saveCatalog(loadCachedCompanies().map((item) => item.id === updated.id ? updated : item))
  if (selectedCompanyId() === updated.id) setCompanyDisplayName(updated.name)
  return updated
}

export async function resetCompany(company: Company) {
  const prefix = companyStoragePrefix(company.tenantId, company.id)
  const response = await fetch(`${pb.baseURL.replace(/\/$/, "")}/api/jornal/companies/${encodeURIComponent(company.id)}/reset`, {
    method: "POST",
    headers: { Authorization: pb.authStore.token },
  })
  const data = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(data.message ?? "Company gagal direset"))
  const updated = parseCompany(data)
  saveCatalog(loadCachedCompanies().map((item) => item.id === updated.id ? updated : item))
  await quarantineOutboxByPrefix(prefix, `reset-epoch-${company.dataEpoch}`)
  return updated
}

export function companyStoragePrefix(tenant: string, company: string) {
  return `jornal.v2.${tenant}.${company}.`
}

export async function pendingChangesForCompany(company: Company) {
  const prefix = companyStoragePrefix(company.tenantId, company.id)
  return (await listOutbox()).filter((row) => row.key.startsWith(prefix)).length
}

export async function persistCompanyDrafts(company: Company) {
  const prefix = `${companyStoragePrefix(company.tenantId, company.id)}jornal.transaction-draft.`
  const writes: Promise<void>[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    writes.push(mirrorState(key, JSON.parse(raw)))
  }
  await Promise.all(writes)
}

/** Idempotently copy the old per-user namespace into the server-assigned
 * legacy company. Sources remain untouched for rollback/recovery. */
export async function migrateLegacyCompanyData(company: Company) {
  if (!company.legacyDefault) return
  const marker = `${companyStoragePrefix(company.tenantId, company.id)}migration-complete.v1`
  if (window.localStorage.getItem(marker) === "1") return
  const run = async () => {
    if (window.localStorage.getItem(marker) === "1") return
    const oldPrefix = `jornal.${company.tenantId}.`
    const newPrefix = companyStoragePrefix(company.tenantId, company.id)
    await copyOutboxByPrefix(oldPrefix, newPrefix)
    for (const key of [...Object.values(KEYS), RESET_PENDING_KEY]) {
      const oldKey = `${oldPrefix}${key}`
      const newKey = `${newPrefix}${key}`
      if (window.localStorage.getItem(newKey) !== null) continue
      let value: unknown
      const raw = window.localStorage.getItem(oldKey)
      if (raw !== null) {
        if (key === RESET_PENDING_KEY) value = raw
        else try { value = JSON.parse(raw) } catch { continue }
      } else {
        value = await restoreState(oldKey).catch(() => undefined)
      }
      if (value === undefined) continue
      window.localStorage.setItem(newKey, key === RESET_PENDING_KEY ? String(value) : JSON.stringify(value))
      await persistState(newKey, value)
    }
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(oldPrefix)) continue
      const scopedSuffix = key.slice(oldPrefix.length)
      if (!scopedSuffix.startsWith("jornal.transaction-draft.") && !scopedSuffix.startsWith("jornal.entry-default.")) continue
      const newKey = `${newPrefix}${key.slice(oldPrefix.length)}`
      if (window.localStorage.getItem(newKey) !== null) continue
      const raw = window.localStorage.getItem(key)
      if (raw === null) continue
      window.localStorage.setItem(newKey, raw)
      try { await persistState(newKey, JSON.parse(raw)) } catch { /* malformed legacy drafts stay only at source */ }
    }
    const mirroredDrafts = await listMirroredStateByPrefix(`${oldPrefix}jornal.transaction-draft.`).catch(() => [])
    for (const row of mirroredDrafts) {
      const newKey = `${newPrefix}${row.key.slice(oldPrefix.length)}`
      if (window.localStorage.getItem(newKey) !== null) continue
      window.localStorage.setItem(newKey, JSON.stringify(row.value))
      await persistState(newKey, row.value)
    }
    for (const key of [...Object.values(KEYS), RESET_PENDING_KEY]) {
      const oldKey = `${oldPrefix}${key}`
      const newKey = `${newPrefix}${key}`
      const source = window.localStorage.getItem(oldKey) ?? await restoreState(oldKey).then((value) => value === undefined ? null : JSON.stringify(value)).catch(() => null)
      if (source !== null && window.localStorage.getItem(newKey) === null) throw new Error(`Migrasi lokal belum lengkap: ${key}`)
    }
    window.localStorage.setItem(marker, "1")
    await mirrorState(marker, "1")
  }
  const locks = navigator.locks
  if (locks) await locks.request(`jornal-company-migration-${company.tenantId}`, run)
  else await run()
}

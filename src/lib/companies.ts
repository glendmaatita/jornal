import { copyOutboxByPrefix, listMirroredStateByPrefix, listOutbox, mirrorState, persistState, quarantineOutboxByPrefix, restoreState } from "./local-db"
import { pb } from "./pb"
import { getCompanyScope, KEYS, RESET_PENDING_KEY, setCompanyDisplayName, setCompanyLegacyDefault, setCompanyScope, setCompanyWritable } from "./store"
import type { Account, AppSettings, BusinessProfile, Company } from "./types"
import { staleWhileRevalidate } from "./persistent-cache"

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
    membershipRevision: Number(record.membership_revision ?? record.membershipRevision ?? 1),
    logoAssetId: String(record.logo_asset_id ?? record.logoAssetId ?? "") || null,
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
  return () => { listeners.delete(listener) }
}

export function loadCachedCompanies(): Company[] {
  try {
    const raw = window.localStorage.getItem(catalogKey())
    return raw ? (JSON.parse(raw) as Company[]) : []
  } catch { return [] }
}

export async function restoreCachedCompanies(): Promise<Company[]> {
  const cached = loadCachedCompanies()
  if (cached.length > 0) return cached
  const durable = await restoreState(catalogKey()).catch(() => undefined)
  if (!Array.isArray(durable)) return []
  saveCatalog(durable as Company[])
  return durable as Company[]
}

export async function loadCompanies(): Promise<Company[]> {
  if (!pb.authStore.isValid) return []
  const cached = await restoreCachedCompanies()
  try {
    const result = await refreshCompanyMemberships()
    return result.companies
  } catch (cause) {
    if (cached.length > 0) return cached
    throw cause
  }
}

export async function loadCompaniesFromServer(): Promise<Company[]> {
  if (!pb.authStore.isValid) return []
  const companies: Company[] = []; let cursor = ""
  do {
    const query = new URLSearchParams({ limit: "100" }); if (cursor) query.set("cursor", cursor)
    const result = await pb.send<{ items: Record<string, unknown>[]; cursor: string | null; hasMore: boolean }>(`/api/jornal/companies?${query}`, {})
    companies.push(...result.items.map(parseCompany)); cursor = result.hasMore && result.cursor ? result.cursor : ""
  } while (cursor)
  saveCatalog(companies)
  return companies
}

export async function refreshCompanyMemberships() {
  const previous = activeCompany()
  const companies = await loadCompaniesFromServer()
  if (!previous) return { removed: false, scopeChanged: false, companies }
  const current = companies.find((company) => company.id === previous.id)
  if (!current || current.membershipRevision !== previous.membershipRevision) {
    await quarantineOutboxByPrefix(companyStoragePrefix(previous.tenantId, previous.id, previous.dataEpoch, previous.membershipRevision), "membership-revoked-or-replaced")
    return { removed: true, scopeChanged: false, companies }
  }
  const scopeChanged = current.dataEpoch !== previous.dataEpoch || current.tenantId !== previous.tenantId
  if (scopeChanged) {
    await quarantineOutboxByPrefix(companyStoragePrefix(previous.tenantId, previous.id, previous.dataEpoch, previous.membershipRevision), "remote-company-scope-changed")
  }
  // Keep the synchronous local store aligned with the catalog that was just
  // accepted. This matters when a reset or metadata change happened on a
  // different device while this tab rendered from its cached catalog.
  if (selectedCompanyId() === current.id) {
    setCompanyScope(current.id, current.dataEpoch, current.tenantId, current.membershipRevision)
    setCompanyWritable(current.status === "ACTIVE")
    setCompanyLegacyDefault(current.legacyDefault)
    setCompanyDisplayName(current.name)
  }
  return { removed: false, scopeChanged, companies }
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
  const prefix = companyStoragePrefix(company.tenantId, company.id, company.dataEpoch, company.membershipRevision)
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

async function fileBase64(file: Blob) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary) }
async function normalizeLogoFile(file: File) { if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Logo harus PNG, JPEG, atau WebP"); const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); try { if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16_000_000) throw new Error("Dimensi logo maksimal 4096 px dan 16 megapixel"); const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext("2d"); if (!context) throw new Error("Logo tidak dapat diproses"); context.drawImage(bitmap, 0, 0); const type = file.type === "image/jpeg" ? "image/jpeg" : file.type === "image/webp" ? "image/webp" : "image/png"; const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, type === "image/jpeg" ? 0.92 : undefined)); if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("Logo hasil normalisasi melebihi 2 MB"); return new File([blob], file.name.replace(/\.[^.]+$/, "") + (type === "image/jpeg" ? ".jpg" : type === "image/webp" ? ".webp" : ".png"), { type }) } finally { bitmap.close() } }
export async function uploadCompanyLogo(company: Company, file: File) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Logo maksimal 2 MB")
  const normalized = await normalizeLogoFile(file); const form = new FormData(); form.set("revision", String(company.revision)); form.set("requestId", crypto.randomUUID()); form.set("filename", normalized.name); form.set("contentBase64", await fileBase64(normalized)); form.set("file", normalized, normalized.name)
  const response = await fetch(`${pb.baseURL.replace(/\/$/, "")}/api/jornal/companies/${encodeURIComponent(company.id)}/logo`, { method: "PUT", headers: { Authorization: pb.authStore.token }, body: form }); const result = await response.json() as { company: Record<string, unknown>; asset: { id: string }; message?: string }; if (!response.ok) throw new Error(result.message || "Logo gagal disimpan")
  const updated = parseCompany(result.company); saveCatalog(loadCachedCompanies().map((item) => item.id === updated.id ? updated : item)); return updated
}
export async function removeCompanyLogo(company: Company) { const result = await pb.send<{ company: Record<string, unknown> }>(`/api/jornal/companies/${encodeURIComponent(company.id)}/logo`, { method: "DELETE", body: { revision: company.revision, requestId: crypto.randomUUID() } }); const updated = parseCompany(result.company); saveCatalog(loadCachedCompanies().map((item) => item.id === updated.id ? updated : item)); return updated }
export async function loadCompanyLogo(company: Company, assetId = company.logoAssetId) { if (!assetId) return null; return staleWhileRevalidate("company-assets", `${catalogKey()}.asset.${company.id}.${assetId}`, async () => { const result = await pb.send<{ mime: string; contentBase64: string; checksum: string }>(`/api/jornal/companies/${encodeURIComponent(company.id)}/assets/${encodeURIComponent(assetId)}`, {}); return { ...result, dataUrl: `data:${result.mime};base64,${result.contentBase64}` } }) }

export function companyStoragePrefix(ownerTenant: string, company: string, dataEpoch = 1, membershipRevision = 1) {
  const actor = pb.authStore.record?.id ?? ownerTenant
  return `jornal.v3.${actor}.${ownerTenant}.${company}.${dataEpoch}.${membershipRevision}.`
}

export async function pendingChangesForCompany(company: Company) {
  const prefix = companyStoragePrefix(company.tenantId, company.id, company.dataEpoch, company.membershipRevision)
  return (await listOutbox()).filter((row) => row.key.startsWith(prefix)).length
}

export async function persistCompanyDrafts(company: Company) {
  const prefix = `${companyStoragePrefix(company.tenantId, company.id, company.dataEpoch, company.membershipRevision)}jornal.transaction-draft.`
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
  const actor = pb.authStore.record?.id ?? getCompanyScope().actorUserId
  if (!company.legacyDefault || actor !== company.tenantId) return
  const marker = `${companyStoragePrefix(company.tenantId, company.id, company.dataEpoch, company.membershipRevision)}migration-complete.v2`
  if (window.localStorage.getItem(marker) === "1") return
  const run = async () => {
    if (window.localStorage.getItem(marker) === "1") return
    const oldPrefix = `jornal.v2.${company.tenantId}.${company.id}.`
    const preCompanyPrefix = `jornal.${company.tenantId}.`
    const newPrefix = companyStoragePrefix(company.tenantId, company.id, company.dataEpoch, company.membershipRevision)
    const sourcePrefix = window.localStorage.getItem(`${oldPrefix}${KEYS.profile}`) !== null ? oldPrefix : preCompanyPrefix
    await copyOutboxByPrefix(sourcePrefix, newPrefix)
    for (const key of [...Object.values(KEYS), RESET_PENDING_KEY]) {
      const oldKey = `${sourcePrefix}${key}`
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
      if (!key?.startsWith(sourcePrefix)) continue
      const scopedSuffix = key.slice(sourcePrefix.length)
      if (!scopedSuffix.startsWith("jornal.transaction-draft.") && !scopedSuffix.startsWith("jornal.entry-default.")) continue
      const newKey = `${newPrefix}${key.slice(sourcePrefix.length)}`
      if (window.localStorage.getItem(newKey) !== null) continue
      const raw = window.localStorage.getItem(key)
      if (raw === null) continue
      window.localStorage.setItem(newKey, raw)
      try { await persistState(newKey, JSON.parse(raw)) } catch { /* malformed legacy drafts stay only at source */ }
    }
    const mirroredDrafts = await listMirroredStateByPrefix(`${sourcePrefix}jornal.transaction-draft.`).catch(() => [])
    for (const row of mirroredDrafts) {
      const newKey = `${newPrefix}${row.key.slice(sourcePrefix.length)}`
      if (window.localStorage.getItem(newKey) !== null) continue
      window.localStorage.setItem(newKey, JSON.stringify(row.value))
      await persistState(newKey, row.value)
    }
    for (const key of [...Object.values(KEYS), RESET_PENDING_KEY]) {
      const oldKey = `${sourcePrefix}${key}`
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

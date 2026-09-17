import { listBlobsByPrefix, mirrorState, removeBlob, restoreBlob, restoreState, storeBlob } from "./local-db"
import type { LocalDocumentDraft } from "./document-types"

const KEY_PREFIX = "jornal.document-drafts.v1"

function scopePrefix(tenantId: string | null, companyId: string | null) {
  // Unauthenticated shared files remain staging-only and must be explicitly
  // assigned after login; they never inherit the previous user's company.
  return `${KEY_PREFIX}.${tenantId ?? "staging"}.${companyId ?? "unassigned"}`
}

function indexKey(tenantId: string | null, companyId: string | null) {
  return `${scopePrefix(tenantId, companyId)}.index`
}

function blobKey(draft: Pick<LocalDocumentDraft, "tenantId" | "companyId" | "id">) {
  return `${scopePrefix(draft.tenantId, draft.companyId)}.blob.${draft.id}`
}

async function index(tenantId: string | null, companyId: string | null): Promise<LocalDocumentDraft[]> {
  const key = indexKey(tenantId, companyId)
  const restored = await restoreState(key).catch(() => undefined)
  return Array.isArray(restored) ? restored as LocalDocumentDraft[] : []
}

async function saveIndex(tenantId: string | null, companyId: string | null, drafts: LocalDocumentDraft[]) {
  await mirrorState(indexKey(tenantId, companyId), drafts)
}

export async function saveLocalDocument(
  input: Omit<LocalDocumentDraft, "id" | "createdAt" | "updatedAt" | "localOnly" | "serverDocumentId">,
  file: Blob,
): Promise<LocalDocumentDraft> {
  if (file.size !== input.byteSize) throw new Error("Ukuran file dokumen tidak konsisten")
  const now = new Date().toISOString()
  const draft: LocalDocumentDraft = {
    ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now, localOnly: true, serverDocumentId: null,
  }
  await storeBlob({ key: blobKey(draft), blob: file, mimeType: draft.mimeType, filename: draft.filename, byteSize: draft.byteSize })
  const current = await index(draft.tenantId, draft.companyId)
  await saveIndex(draft.tenantId, draft.companyId, [draft, ...current])
  return draft
}

export async function listLocalDocuments(tenantId: string | null, companyId: string | null) {
  return index(tenantId, companyId)
}

export async function loadLocalDocumentFile(draft: LocalDocumentDraft) {
  return restoreBlob(blobKey(draft))
}

export async function discardLocalDocument(draft: LocalDocumentDraft) {
  await removeBlob(blobKey(draft))
  const current = await index(draft.tenantId, draft.companyId)
  await saveIndex(draft.tenantId, draft.companyId, current.filter((item) => item.id !== draft.id))
}

export async function markLocalDocumentUploaded(draft: LocalDocumentDraft, serverDocumentId: string) {
  const current = await index(draft.tenantId, draft.companyId)
  const updated = current.map((item) => item.id === draft.id ? { ...item, localOnly: false, serverDocumentId, updatedAt: new Date().toISOString() } : item)
  await saveIndex(draft.tenantId, draft.companyId, updated)
  return updated.find((item) => item.id === draft.id) ?? draft
}

/** Diagnostic used by storage UX; it never reads bytes into JS memory. */
export async function localDocumentUsage(tenantId: string | null, companyId: string | null) {
  const rows = await listBlobsByPrefix(`${scopePrefix(tenantId, companyId)}.blob.`)
  return rows.reduce((sum, row) => sum + row.byteSize, 0)
}

export async function adoptStagedDocuments(tenantId: string, companyId: string) {
  const staged = await index(null, null); if (!staged.length) return []
  const target = await index(tenantId, companyId); const adopted: LocalDocumentDraft[] = []
  for (const item of staged) {
    const source = await restoreBlob(blobKey(item)); if (!source) continue
    const next = { ...item, tenantId, companyId, updatedAt: new Date().toISOString() }
    await storeBlob({ key: blobKey(next), blob: source.blob, mimeType: source.mimeType, filename: source.filename, byteSize: source.byteSize }); await removeBlob(blobKey(item)); adopted.push(next)
  }
  await saveIndex(tenantId, companyId, [...adopted, ...target]); await saveIndex(null, null, staged.filter((item) => !adopted.some((next) => next.id === item.id)))
  return adopted
}

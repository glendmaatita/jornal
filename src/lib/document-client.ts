import { activeCompany } from "./companies"
import { markLocalDocumentUploaded, saveLocalDocument } from "./document-local-store"
import type { DocumentExtraction, DocumentSource, ServerDocument } from "./document-types"
import type { LocalDocumentDraft } from "./document-types"
import { pb } from "./pb"
import { reconcileServerTransaction, reconcileServerTransactionDeletion } from "./store"
import type { Transaction } from "./types"
import type { Invoice } from "./invoice-types"

function scope() { const company = activeCompany(); if (!company) throw new Error("Pilih company terlebih dahulu"); return { companyId: company.id, dataEpoch: company.dataEpoch } }
function params() { return new URLSearchParams(Object.entries(scope()).map(([key, value]) => [key, String(value)])).toString() }
async function base64(file: Blob) { const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ""; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary) }
async function uploadLocal(draft: LocalDocumentDraft, file: Blob) { const form = new FormData(); const currentScope = scope(); form.set("companyId", currentScope.companyId); form.set("dataEpoch", String(currentScope.dataEpoch)); form.set("source", draft.source); form.set("filename", draft.filename); form.set("contentBase64", await base64(file)); form.set("file", file, draft.filename); const upload = await fetch(`${pb.baseURL.replace(/\/$/, "")}/api/jornal/documents`, { method: "POST", headers: { Authorization: pb.authStore.token }, body: form }); const response = await upload.json() as { document: ServerDocument; duplicate: ServerDocument | null; message?: string }; if (!upload.ok) throw new Error(response.message || "Dokumen gagal diunggah"); return { local: await markLocalDocumentUploaded(draft, response.document.id), server: response } }

export async function captureDocument(file: File, source: DocumentSource = "UPLOAD") {
  const company = activeCompany(); const tenantId = pb.authStore.record?.id ?? null
  const local = await saveLocalDocument({ tenantId, companyId: company?.id ?? null, source, filename: file.name || "dokumen", mimeType: file.type, byteSize: file.size, status: "UNPROCESSED" }, file)
  if (!navigator.onLine || !company) return { local, server: null }
  return uploadLocal(local, file)
}
export function uploadLocalDocument(draft: LocalDocumentDraft, file: Blob) { if (!navigator.onLine) throw new Error("Perangkat masih offline"); const company = activeCompany(); if (!company || draft.companyId !== company.id || draft.tenantId !== (pb.authStore.record?.id ?? null)) throw new Error("Scope dokumen tidak cocok dengan company aktif"); return uploadLocal(draft, file) }
export function listDocuments(status?: string) { return pb.send<{ items: ServerDocument[] }>(`/api/jornal/documents?${params()}${status ? `&status=${encodeURIComponent(status)}` : ""}`, {}) }
export function searchDocuments(search: string) { return pb.send<{ items: Array<{ document: ServerDocument; summary: { documentType: string | null; merchantName: string | null; description: string | null } }> }>(`/api/jornal/documents/search?${params()}&search=${encodeURIComponent(search)}`, {}) }
export function listDocumentInvoiceCandidates(id: string, amount: number) { return pb.send<{ items: Invoice[] }>(`/api/jornal/documents/${encodeURIComponent(id)}/invoice-candidates?${params()}&amount=${amount}`, {}) }
export function getDocument(id: string) { return pb.send<{ document: ServerDocument; linkedInvoiceId: string | null; contentBase64: string; extraction: { id: string; result: DocumentExtraction; warnings: string[]; model: string; createdAt: string } | null }>(`/api/jornal/documents/${encodeURIComponent(id)}?${params()}`, {}) }
export function extractDocument(id: string) { return pb.send<{ job: { id: string; status: string } }>(`/api/jornal/documents/${encodeURIComponent(id)}/extract`, { method: "POST", body: { ...scope(), requestKey: crypto.randomUUID() } }) }
export function getAiJob(id: string) { return pb.send<{ job: { id: string; documentId: string; status: string; errorCode: string | null; result: DocumentExtraction | null } }>(`/api/jornal/ai-jobs/${encodeURIComponent(id)}?${params()}`, {}) }
export function archiveDocument(document: ServerDocument) { return pb.send(`/api/jornal/documents/${encodeURIComponent(document.id)}/archive`, { method: "POST", body: { ...scope(), expectedRevision: document.revision } }) }
export async function confirmDocument(document: ServerDocument, input: { mode?: "CREATE_TRANSACTION" | "LINK_TRANSACTION" | "MATCH_INVOICE"; transactionId?: string; expectedTransactionRevision?: number; invoiceId?: string; expectedInvoiceRevision?: number; direction?: "MONEY_IN" | "MONEY_OUT"; amount?: number; transactionDate?: string; description?: string; accountId?: string | null }) { const result = await pb.send<{ document: ServerDocument; ledgerTransaction: Transaction; ledgerRevision: number }>(`/api/jornal/documents/${encodeURIComponent(document.id)}/confirm`, { method: "POST", body: { ...scope(), ...input, mode: input.mode || "CREATE_TRANSACTION", transactionId: input.transactionId || crypto.randomUUID(), expectedRevision: document.revision, commandKey: crypto.randomUUID() } }); reconcileServerTransaction(result.ledgerTransaction); return result }
export async function unlinkDocument(document: ServerDocument, reason: string) { const result = await pb.send<{ document: ServerDocument; ledgerTransaction: Transaction; ledgerDeleted: boolean }>(`/api/jornal/documents/${encodeURIComponent(document.id)}/unlink`, { method: "POST", body: { ...scope(), expectedRevision: document.revision, reason, commandKey: crypto.randomUUID() } }); if (result.ledgerDeleted) reconcileServerTransactionDeletion(result.ledgerTransaction); else reconcileServerTransaction(result.ledgerTransaction); return result }

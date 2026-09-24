import { pb, pocketBaseConfigured } from "./pb"
import { clearPersistentCachePrefix, readPersistentCache, staleWhileRevalidate } from "./persistent-cache"
import { reconcileServerTransaction } from "./store"
import { acceptServerTransactionRevision } from "./pocketbase-sync"
import { getCompanyScope, getDataScope } from "./store"
import type { Transaction } from "./types"
import type {
  TaxFiling,
  TaxKind,
  TaxNotificationPreference,
  TaxObligation,
  TaxRegistration,
  TaxSubject,
} from "./tax-compliance-types"

export const taxComplianceEnabled = import.meta.env.VITE_TAX_COMPLIANCE_ENABLED !== "false"

export interface TaxConfiguration {
  subjects: TaxSubject[]
  memberships: Array<{ id: string; tenant_id: string; subject_id: string; company_id: string; effective_from: string; effective_until: string; revision: number }>
  registrations: Array<Record<string, unknown>>
  preferences: Array<Record<string, unknown>>
  taxCoverage?: "COMPLETE" | "RESTRICTED_SHARED_SUBJECT"
}

export interface TaxAgenda {
  obligations: TaxObligation[]
  filings: TaxFiling[]
  settlements: Array<Record<string, unknown>>
  allocations: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
  taxCoverage?: "COMPLETE" | "RESTRICTED_SHARED_SUBJECT"
}

function configurationKey(ownerId = getDataScope()) { return `jornal.v3.${ownerId}.tax.configuration.v1` }
function agendaKey(companyId?: string, ownerId = getDataScope()) { return `jornal.v3.${ownerId}.tax.agenda.${companyId || "all"}.v1` }
function inboxKey(ownerId = getDataScope()) { return `jornal.v3.${ownerId}.tax.inbox.v1` }
function taxCachePrefix(ownerId = getDataScope()) { return `jornal.v3.${ownerId}.tax.` }

async function send<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!pocketBaseConfigured || !taxComplianceEnabled) throw new Error("Modul agenda pajak belum tersedia pada server ini.")
  const result = await pb.send<T>(path, { ...options, headers: { "X-Jornal-Company": getCompanyScope().companyId, "X-Jornal-Protocol": "3" } })
  if (options.method && options.method !== "GET") await clearPersistentCachePrefix(taxCachePrefix())
  return result
}

export async function loadTaxConfiguration(): Promise<TaxConfiguration> {
  const ownerId = getDataScope()
  return staleWhileRevalidate("tax", configurationKey(ownerId), async () => {
    const result = await send<TaxConfiguration>(`/api/jornal/tax/configuration?companyId=${encodeURIComponent(getCompanyScope().companyId)}`)
    if (getDataScope() !== ownerId) throw new Error("Sesi berubah saat data pajak dimuat.")
    return result
  })
}

export async function loadTaxAgenda(companyId?: string): Promise<TaxAgenda> {
  const ownerId = getDataScope()
  const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""
  return staleWhileRevalidate("tax", agendaKey(companyId, ownerId), async () => {
    const wire = await send<{ obligations: Array<Record<string, unknown>>; filings: Array<Record<string, unknown>>; settlements?: Array<Record<string, unknown>>; allocations?: Array<Record<string, unknown>>; evidence?: Array<Record<string, unknown>> }>(`/api/jornal/tax/agenda${query}`)
    const result = {
      obligations: wire.obligations.map(parseObligation),
      filings: wire.filings.map(parseFiling),
      settlements: wire.settlements ?? [], allocations: wire.allocations ?? [], evidence: wire.evidence ?? [], taxCoverage: (wire as { taxCoverage?: TaxAgenda["taxCoverage"] }).taxCoverage,
    }
    if (getDataScope() !== ownerId) throw new Error("Sesi berubah saat agenda pajak dimuat.")
    return result
  })
}

export async function loadTaxInbox(): Promise<{ items: Array<Record<string, unknown>> }> {
  return staleWhileRevalidate("tax", inboxKey(), () => send<{ items: Array<Record<string, unknown>> }>("/api/jornal/tax/inbox"))
}

export function loadCachedTaxInbox(): Promise<{ items: Array<Record<string, unknown>> } | undefined> {
  return readPersistentCache(inboxKey())
}

export async function markTaxInboxRead(ids: string[]): Promise<{ updated: number }> {
  return send<{ updated: number }>("/api/jornal/tax/inbox/read", { method: "POST", body: { commandKey: `inbox-${crypto.randomUUID()}`, ids } })
}

function value(record: Record<string, unknown>, snake: string, camel: string) {
  return record[snake] ?? record[camel]
}

function textValue(record: Record<string, unknown>, snake: string, camel: string) {
  return String(value(record, snake, camel) ?? "")
}

function nullableText(record: Record<string, unknown>, snake: string, camel: string) {
  return textValue(record, snake, camel) || null
}

function parseObligation(record: Record<string, unknown>): TaxObligation {
  const nullableMoney = (snake: string, camel: string) => {
    const raw = value(record, snake, camel)
    return raw === null || raw === undefined || raw === "" ? null : Number(raw)
  }
  return {
    id: String(record.id), tenantId: textValue(record, "tenant_id", "tenantId"), subjectId: textValue(record, "subject_id", "subjectId"),
    registrationId: textValue(record, "registration_id", "registrationId"), kind: textValue(record, "kind", "kind") as TaxObligation["kind"],
    component: textValue(record, "component", "component"), period: textValue(record, "period", "period"), currency: "IDR",
    amountState: textValue(record, "amount_state", "amountState") as TaxObligation["amountState"], liabilityAmount: nullableMoney("liability_amount", "liabilityAmount"),
    proposedLiabilityAmount: nullableMoney("proposed_liability_amount", "proposedLiabilityAmount"),
    settledByThirdParty: Number(value(record, "settled_by_third_party", "settledByThirdParty") ?? 0), allocatedPayments: Number(value(record, "allocated_payments", "allocatedPayments") ?? 0),
    remainingPayable: nullableMoney("remaining_payable", "remainingPayable"), overpaidAmount: Number(value(record, "overpaid_amount", "overpaidAmount") ?? 0),
    paymentStatus: textValue(record, "payment_status", "paymentStatus") as TaxObligation["paymentStatus"],
    filingStatus: textValue(record, "filing_status", "filingStatus") as TaxObligation["filingStatus"],
    dataStatus: textValue(record, "data_status", "dataStatus") as TaxObligation["dataStatus"],
    statutoryDueDate: nullableText(record, "statutory_due_date", "statutoryDueDate"), effectiveDueDate: nullableText(record, "effective_due_date", "effectiveDueDate"),
    penaltyReliefUntil: nullableText(record, "penalty_relief_until", "penaltyReliefUntil"), snoozedUntil: nullableText(record, "snoozed_until", "snoozedUntil"),
    deadlineStatus: textValue(record, "deadline_status", "deadlineStatus") as TaxObligation["deadlineStatus"],
    deadlineSource: nullableText(record, "deadline_source", "deadlineSource"), deadlineReference: nullableText(record, "deadline_reference", "deadlineReference"),
    ruleId: textValue(record, "rule_id", "ruleId"), ruleVersion: textValue(record, "rule_version", "ruleVersion"),
    inputFingerprint: textValue(record, "input_fingerprint", "inputFingerprint"),
    amountSource: nullableText(record, "amount_source", "amountSource"), amountConfirmedAt: nullableText(record, "amount_confirmed_at", "amountConfirmedAt"),
    revision: Number(record.revision ?? 0),
    createdAt: textValue(record, "created", "createdAt"), updatedAt: textValue(record, "updated", "updatedAt"),
  }
}

function parseFiling(record: Record<string, unknown>): TaxFiling {
  return {
    id: String(record.id), tenantId: textValue(record, "tenant_id", "tenantId"), subjectId: textValue(record, "subject_id", "subjectId"),
    filingGroup: textValue(record, "filing_group", "filingGroup"), period: textValue(record, "period", "period"),
    obligationIds: (value(record, "obligation_ids", "obligationIds") as unknown[] | undefined)?.map(String) ?? [],
    status: textValue(record, "status", "status") as TaxFiling["status"],
    statutoryDueDate: nullableText(record, "statutory_due_date", "statutoryDueDate"), effectiveDueDate: nullableText(record, "effective_due_date", "effectiveDueDate"),
    deadlineStatus: textValue(record, "deadline_status", "deadlineStatus") as TaxFiling["deadlineStatus"], deadlineSource: nullableText(record, "deadline_source", "deadlineSource"),
    filedAt: nullableText(record, "filed_at", "filedAt"), reference: nullableText(record, "reference", "reference"),
    fulfilledBySettlementId: nullableText(record, "fulfilled_by_settlement_id", "fulfilledBySettlementId"),
    amendmentNumber: Number(value(record, "amendment_number", "amendmentNumber") ?? 0), amendmentReason: nullableText(record, "amendment_reason", "amendmentReason"),
    revision: Number(record.revision ?? 0), createdAt: textValue(record, "created", "createdAt"), updatedAt: textValue(record, "updated", "updatedAt"),
  }
}

export interface TaxSetupInput {
  commandKey: string
  label: string
  subjectType: "INDIVIDUAL" | "ENTITY"
  entityForm?: string
  maskedTaxId?: string
  fiscalYearStartMonth?: number
  fiscalYearStartDay?: number
  eligibilityAnswers?: Record<string, unknown>
  companyIds: string[]
  effectiveFrom: string
  umkmEligibility: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW"
  registrations: Array<{
    kind: string
    label?: string
    amountMode?: "MANUAL_CONFIRMED" | "DOCUMENT"
    defaultAmount?: number | null
    defaultDueDate?: string | null
    jurisdiction?: string
  }>
  inAppEnabled: boolean
  emailEnabled: boolean
  includeAmountInEmail?: boolean
  timezone?: string
}

export async function setupTaxSubject(input: TaxSetupInput): Promise<{ subject: TaxSubject; registrations: TaxRegistration[] }> {
  const result = await send<{ subject: TaxSubject; registrations: TaxRegistration[] }>("/api/jornal/tax/setup", { method: "POST", body: input })
  return result
}

export async function saveTaxPeriodInput(input: {
  commandKey: string
  subjectId: string
  companyId: string | null
  period: string
  taxableRevenue: number
  externalRevenue: number
  openingYtdRevenue?: number
  adjustments: number
  dataStatus: "COMPLETE" | "INCOMPLETE"
  sourceRevision: string
  reason?: string
}) {
  return send<Record<string, unknown>>("/api/jornal/tax/period-inputs", { method: "POST", body: input })
}

export async function generateTaxObligations(input: { commandKey: string; subjectId: string; period: string }) {
  return send<{ subjectId: string; period: string; obligations: TaxObligation[] }>("/api/jornal/tax/obligations/generate", { method: "POST", body: input })
}

export async function createTaxSettlement(input: {
  commandKey: string
  subjectId: string
  type: "SELF_PAYMENT" | "THIRD_PARTY_WITHHOLDING" | "COMPENSATION" | "TAX_DEPOSIT_USE" | "OUTSIDE_LEDGER"
  amount: number
  settlementDate: string
  reference?: string
  source?: string
  validatedPayment?: boolean
  allocations: Array<{ obligationId: string; amount: number }>
  ledgerTransaction?: { id: string; companyId: string; description: string; accountId: string | null; paymentMethod?: string; notes?: string }
}) {
  const result = await send<Record<string, unknown> & { ledgerTransaction?: Transaction; ledgerRevision?: number }>("/api/jornal/tax/settlements", { method: "POST", body: input })
  if (result.ledgerTransaction) {
    reconcileServerTransaction(result.ledgerTransaction)
    if (result.ledgerRevision) acceptServerTransactionRevision(result.ledgerTransaction.id, result.ledgerRevision)
  }
  return result
}

export async function completeTaxFiling(id: string, input: { commandKey: string; revision: number; filedAt: string; reference?: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/filings/${encodeURIComponent(id)}/complete`, { method: "POST", body: input })
}

export async function snoozeTaxObligation(id: string, input: { commandKey: string; revision: number; snoozedUntil: string; reason?: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/obligations/${encodeURIComponent(id)}/snooze`, { method: "POST", body: input })
}

export async function confirmTaxObligationAmount(id: string, input: { commandKey: string; revision: number; liabilityAmount: number; source: string; reason?: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/obligations/${encodeURIComponent(id)}/amount`, { method: "POST", body: input })
}

export async function linkCompanyToTaxSubject(subjectId: string, input: { commandKey: string; companyId: string; effectiveFrom: string; reason?: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}/companies`, { method: "POST", body: input })
}

export async function addTaxRegistration(subjectId: string, input: {
  commandKey: string; kind: TaxKind; label?: string; amountMode?: "MANUAL_CONFIRMED" | "DOCUMENT"
  defaultAmount?: number | null; defaultDueDate?: string | null; jurisdiction?: string; activeFrom: string; reason?: string
}) {
  return send<Record<string, unknown>>(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}/registrations`, { method: "POST", body: input })
}

export async function updateTaxSubject(subjectId: string, input: {
  commandKey: string; revision: number; label?: string; status?: "ACTIVE" | "INACTIVE"
  umkmEligibility?: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW"; umkmEligibilityEffectiveFrom?: string; reason?: string
}) {
  return send<TaxSubject>(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}`, { method: "PATCH", body: input })
}

export async function updateTaxNotificationPreference(preferenceId: string, input: {
  commandKey: string; revision: number; inAppEnabled?: boolean; emailEnabled?: boolean; includeAmountInEmail?: boolean; deliveryHour?: number; reason?: string
}) {
  return send<Record<string, unknown>>(`/api/jornal/tax/preferences/${encodeURIComponent(preferenceId)}`, { method: "PATCH", body: input })
}

export async function saveOwnTaxNotificationPreference(subjectId: string, input: {
  commandKey: string; inAppEnabled: boolean; emailEnabled: boolean; includeAmountInEmail?: boolean; deliveryHour?: number; timezone?: string; reason?: string
}) {
  return send<Record<string, unknown>>(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}/preferences/me`, { method: "PUT", body: input })
}

export async function endTaxMembership(membershipId: string, input: { commandKey: string; revision: number; effectiveUntil: string; reason: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/memberships/${encodeURIComponent(membershipId)}/end`, { method: "POST", body: input })
}

export async function endTaxRegistration(registrationId: string, input: { commandKey: string; revision: number; activeUntil: string; reason: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/registrations/${encodeURIComponent(registrationId)}/end`, { method: "POST", body: input })
}

export async function overrideTaxDeadline(obligationId: string, input: {
  commandKey: string; revision: number; effectiveDueDate: string; penaltyReliefUntil?: string; source: string; reference: string; reason?: string
}) {
  return send<Record<string, unknown>>(`/api/jornal/tax/obligations/${encodeURIComponent(obligationId)}/deadline`, { method: "POST", body: input })
}

export async function amendTaxFiling(filingId: string, input: { commandKey: string; revision: number; filedAt: string; reference?: string; reason: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/filings/${encodeURIComponent(filingId)}/amend`, { method: "POST", body: input })
}

export async function reverseTaxSettlement(settlementId: string, input: { commandKey: string; revision: number; reason: string }) {
  return send<Record<string, unknown>>(`/api/jornal/tax/settlements/${encodeURIComponent(settlementId)}/reverse`, { method: "POST", body: input })
}

export async function uploadTaxEvidence(input: {
  commandKey: string; subjectId: string; parentType: "obligation" | "filing" | "settlement" | "registration"; parentId: string; file: File; reason?: string
}) {
  if (!pocketBaseConfigured || !taxComplianceEnabled) throw new Error("Modul agenda pajak belum tersedia pada server ini.")
  if (input.file.size > 10_485_760) throw new Error("Ukuran bukti maksimal 10 MB.")
  if (!["application/pdf", "image/jpeg", "image/png"].includes(input.file.type)) throw new Error("Bukti harus berupa PDF, JPG, atau PNG.")
  const hash = await crypto.subtle.digest("SHA-256", await input.file.arrayBuffer())
  const sha256 = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  const form = new FormData(); form.append("commandKey", input.commandKey); form.append("subjectId", input.subjectId)
  form.append("parentType", input.parentType); form.append("parentId", input.parentId); form.append("sha256", sha256)
  form.append("reason", input.reason ?? ""); form.append("document", input.file, input.file.name)
  return pb.send<Record<string, unknown>>("/api/jornal/tax/evidence", { method: "POST", body: form, headers: { "X-Jornal-Company": getCompanyScope().companyId, "X-Jornal-Protocol": "3" } })
}

export async function loadTaxEvidence(subjectId: string) {
  return send<{ items: Array<Record<string, unknown>> }>(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}/evidence`)
}

export async function downloadTaxEvidence(evidenceId: string, filename: string) {
  await downloadAuthenticated(`/api/jornal/tax/evidence/${encodeURIComponent(evidenceId)}/download`, filename)
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a")
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
}

async function downloadAuthenticated(path: string, name: string) {
  if (!pocketBaseConfigured || !pb.authStore.token) throw new Error("Sesi login diperlukan untuk mengunduh data pajak.")
  const response = await fetch(`${pb.baseURL}${path}`, { headers: { Authorization: pb.authStore.token, "X-Jornal-Company": getCompanyScope().companyId, "X-Jornal-Protocol": "3" } })
  if (!response.ok) throw new Error(`Unduhan gagal (${response.status}).`)
  download(name, await response.blob())
}

export async function downloadTaxReport(subjectId: string, year: number) {
  await downloadAuthenticated(`/api/jornal/tax/subjects/${encodeURIComponent(subjectId)}/report/${year}`, `rekap-pajak-${year}.csv`)
}

export async function downloadTaxBackup(subjectId?: string) {
  const query = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ""
  await downloadAuthenticated(`/api/jornal/tax/export${query}`, `backup-pajak-${todayStamp()}.json`)
}

export async function previewTaxBackup(backup: unknown) {
  return send<{ valid: boolean; counts: Record<string, number>; subjects: Array<{ sourceId: string; label: string; action: "CREATE" | "MERGE" }>; warnings: string[] }>("/api/jornal/tax/import/preview", { method: "POST", body: { backup } })
}

export async function restoreTaxBackup(backup: unknown, commandKey: string) {
  return send<{ restored: boolean; counts: { created: number; merged: number; skipped: number }; notificationOptInsDisabled: boolean }>("/api/jornal/tax/import", { method: "POST", body: { commandKey, backup, confirm: true, reason: "Dipulihkan oleh pengguna" } })
}

function todayStamp() { return new Date().toISOString().slice(0, 10) }

export type { TaxNotificationPreference }

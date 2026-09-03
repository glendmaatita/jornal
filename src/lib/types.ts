// Domain types per prd.md §16–19, §31, §41, §47, §64

export const CURRENCY = "IDR" as const

export type TransactionDirection = "MONEY_IN" | "MONEY_OUT"

export type TransactionClassification =
  | "REVENUE"
  | "OPERATING_EXPENSE"
  | "CAPITAL_INJECTION"
  | "OWNER_WITHDRAWAL"
  | "ASSET_PURCHASE"
  | "LOAN_RECEIVED"
  | "LOAN_PAYMENT"
  | "TAX_PAYMENT"
  | "INTERNAL_TRANSFER"
  | "REFUND"
  | "OTHER_INCOME"
  | "OTHER_OUTFLOW"
  | "OPENING_BALANCE"
  | "UNKNOWN"

export type ClassificationSource =
  | "USER"
  | "RULE"
  | "AI"
  | "HISTORICAL_PATTERN"
  | "SYSTEM"

export type ReviewStatus = "AUTO_ACCEPTED" | "ACCEPTED" | "NEEDS_REVIEW"

export type BusinessRelevance = "BUSINESS" | "NON_BUSINESS" | "UNDETERMINED"

export type AccountType = "CASH" | "BANK" | "EWALLET" | "OTHER"

export interface Account {
  id: string
  name: string
  type: AccountType
  // Opening balance per prd.md §46.4 — never counted as revenue (classification OPENING_BALANCE)
  openingBalance: number
  includedInCash: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryKind = "income" | "expense"

export interface Category {
  id: string
  name: string
  kind: CategoryKind
  keywords: string[]
}

export interface Transaction {
  id: string
  businessId: string
  direction: TransactionDirection
  amount: number
  currency: string
  transactionDate: string // YYYY-MM-DD
  description: string
  notes: string
  categoryId: string | null
  paymentMethod: string
  supplierCustomer: string
  tags: string
  accountId: string | null
  transferAccountId: string | null // destination account for INTERNAL_TRANSFER (§32)
  attachmentName: string | null
  attachmentDataUrl: string | null
  classification: TransactionClassification
  taxClassification: TransactionClassification
  businessRelevance: BusinessRelevance
  classificationSource: ClassificationSource
  classificationConfidence: number | null
  reviewStatus: ReviewStatus
  createdAt: string
  updatedAt: string
}

export type NewTransaction = Omit<Transaction, "id" | "businessId" | "createdAt" | "updatedAt"> & {
  taxClassification?: TransactionClassification
  attachmentDataUrl?: string | null
}

export type ReserveStatus = "ACTIVE" | "USED" | "CANCELLED"

export interface Reserve {
  id: string
  name: string
  amount: number
  dueDate: string | null
  status: ReserveStatus
  createdAt: string
  updatedAt: string
}

export type BusinessType = "INDIVIDUAL" | "PT_PERORANGAN" | "PT" | "CV" | "OTHER"

export type TaxScheme = "UMKM_FINAL" | "PROGRESSIVE" | "CORPORATE" | "NOT_CALCULATED"

export interface BusinessProfile {
  businessId: string
  businessName: string
  businessType: BusinessType
  pkpStatus: boolean
  businessStartDate: string | null // YYYY-MM-DD
  fiscalYear: number
  taxScheme: TaxScheme
  // User-confirmed tax reserve amount (§46.6) — recommended comes from the tax engine
  taxReserveConfirmed: number
  openingBalance: number
  useAccountTracking: boolean
  // Phase 3 — read-only balance check-in (ROADMAP §6: bank "integration" is a manual
  // balance check-in for Cash Position accuracy, never a reconciliation engine)
  lastBalanceCheckIn: string | null // YYYY-MM-DD
  lastCheckedBalance: number | null
  lastCheckInDelta: number | null
  onboardingCompletedAt: string | null
  createdAt: string
  updatedAt: string
}

// Phase 3 — automatic recurring transaction creation (§30, ROADMAP §6).
// Auto-creation requires an explicit user confirmation (the enabling action)
// before the system ever creates a transaction on its own.
export interface RecurringRule {
  id: string
  direction: TransactionDirection
  description: string
  amount: number
  categoryId: string | null
  classification: TransactionClassification
  paymentMethod: string
  accountId: string | null
  dayOfMonth: number // 1–28, clamped
  nextRun: string // YYYY-MM-DD
  autoCreate: boolean // false = paused
  lastRun: string | null
  createdCount: number
  createdAt: string
  updatedAt: string
}

export interface AppSettings {
  // prd.md §22 — thresholds must be configurable
  autoAccept: number // >= 0.90 auto accept
  needsReview: number // < 0.70 needs review
}

export interface CorrectionPattern {
  id: string
  token: string // normalized description token
  categoryId: string | null
  classification: TransactionClassification
  direction: TransactionDirection
  occurrences: number
  createdAt: string
  updatedAt: string
}

// prd.md §57 — financial events that must trigger recalculation
export type FinancialEvent =
  | "TRANSACTION_CREATED"
  | "TRANSACTION_UPDATED"
  | "TRANSACTION_DELETED"
  | "TRANSACTION_RECLASSIFIED"
  | "TAX_RULE_UPDATED"
  | "TAX_PROFILE_UPDATED"
  | "RESERVE_CREATED"
  | "RESERVE_UPDATED"
  | "RESERVE_REMOVED"
  | "ACCOUNT_BALANCE_UPDATED"

export const FINANCIAL_EVENTS: FinancialEvent[] = [
  "TRANSACTION_CREATED",
  "TRANSACTION_UPDATED",
  "TRANSACTION_DELETED",
  "TRANSACTION_RECLASSIFIED",
  "TAX_RULE_UPDATED",
  "TAX_PROFILE_UPDATED",
  "RESERVE_CREATED",
  "RESERVE_UPDATED",
  "RESERVE_REMOVED",
  "ACCOUNT_BALANCE_UPDATED",
]

export const CHANGED_EVENT = "jornal:changed"

// prd.md §52
export type ConfidenceStatus = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE"

export const CLASSIFICATION_LABELS: Record<TransactionClassification, string> = {
  REVENUE: "Omzet",
  OPERATING_EXPENSE: "Pengeluaran Bisnis",
  CAPITAL_INJECTION: "Modal Masuk",
  OWNER_WITHDRAWAL: "Penarikan Pemilik",
  ASSET_PURCHASE: "Pembelian Aset",
  LOAN_RECEIVED: "Penerimaan Pinjaman",
  LOAN_PAYMENT: "Pembayaran Utang",
  TAX_PAYMENT: "Pembayaran Pajak",
  INTERNAL_TRANSFER: "Transfer Antar Rekening",
  REFUND: "Refund",
  OTHER_INCOME: "Pemasukan Lain",
  OTHER_OUTFLOW: "Pengeluaran Lain",
  OPENING_BALANCE: "Saldo Awal",
  UNKNOWN: "Belum Diketahui",
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  INDIVIDUAL: "Perorangan",
  PT_PERORANGAN: "PT Perorangan",
  PT: "PT",
  CV: "CV",
  OTHER: "Lainnya",
}

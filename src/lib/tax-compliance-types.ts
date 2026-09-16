export type TaxSubjectType = "INDIVIDUAL" | "ENTITY"
export type TaxSubjectStatus = "ACTIVE" | "INACTIVE"

export type TaxKind =
  | "PPH_FINAL_UMKM"
  | "PPH_21_26_PAYROLL"
  | "PPH_23_26"
  | "PPH_4_2_OTHER"
  | "PPH_15"
  | "PPH_22"
  | "PPH_25"
  | "PPN_PPNBM"
  | "PPN_SPECIAL"
  | "SPT_ANNUAL_INDIVIDUAL"
  | "SPT_ANNUAL_ENTITY"
  | "PPH_29"
  | "PBB"
  | "LOCAL_TAX"
  | "STAMP_DUTY"
  | "ASSESSMENT"
  | "OTHER"

export type TaxPeriodicity = "MONTHLY" | "ANNUAL" | "EVENT"
export type TaxAmountMode = "AUTOMATIC_UMKM" | "MANUAL_CONFIRMED" | "DOCUMENT"
export type TaxAmountState = "UNKNOWN" | "ESTIMATED" | "CONFIRMED" | "NEEDS_REVIEW"
export type TaxPaymentStatus = "UNKNOWN" | "NOT_DUE" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID" | "NOT_REQUIRED"
export type TaxFilingStatus = "NEEDS_REVIEW" | "NOT_REQUIRED" | "PENDING" | "FILED" | "FULFILLED_BY_PAYMENT"
export type TaxDataStatus = "COMPLETE" | "INCOMPLETE" | "STALE" | "NEEDS_RECONCILIATION"
export type TaxSettlementType = "SELF_PAYMENT" | "THIRD_PARTY_WITHHOLDING" | "COMPENSATION" | "TAX_DEPOSIT_USE" | "OUTSIDE_LEDGER"
export type TaxNotificationChannel = "IN_APP" | "EMAIL"
export type TaxDeliveryStatus = "PENDING" | "LEASED" | "SENT" | "RETRYABLE_FAILED" | "PERMANENTLY_FAILED" | "CANCELLED" | "UNKNOWN"

export interface TaxSubject {
  id: string
  tenantId: string
  label: string
  type: TaxSubjectType
  entityForm: string | null
  maskedTaxId: string | null
  fiscalYearStartMonth: number
  fiscalYearStartDay: number
  timezone: string
  status: TaxSubjectStatus
  umkmEligibility: "ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW"
  umkmEligibilityEffectiveFrom: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface TaxCompanyMembership {
  id: string
  tenantId: string
  subjectId: string
  companyId: string
  effectiveFrom: string
  effectiveUntil: string | null
  revision: number
}

export interface TaxRegistration {
  id: string
  tenantId: string
  subjectId: string
  kind: TaxKind
  label: string
  periodicity: TaxPeriodicity
  filingGroup: string
  amountMode: TaxAmountMode
  jurisdiction: string | null
  activeFrom: string
  activeUntil: string | null
  defaultAmount: number | null
  defaultDueDate: string | null
  ruleId: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface TaxPeriodInput {
  id: string
  tenantId: string
  subjectId: string
  companyId: string | null
  period: string
  taxableRevenue: number
  externalRevenue: number
  openingYtdRevenue: number
  adjustments: number
  dataStatus: TaxDataStatus
  sourceRevision: string
  dataEpoch: number | null
  fingerprint: string
  confirmedAt: string | null
  updatedAt: string
}

export interface TaxObligation {
  id: string
  tenantId: string
  subjectId: string
  registrationId: string
  kind: TaxKind
  component: string
  period: string
  currency: "IDR"
  amountState: TaxAmountState
  liabilityAmount: number | null
  proposedLiabilityAmount: number | null
  settledByThirdParty: number
  allocatedPayments: number
  remainingPayable: number | null
  overpaidAmount: number
  paymentStatus: TaxPaymentStatus
  filingStatus: TaxFilingStatus
  dataStatus: TaxDataStatus
  statutoryDueDate: string | null
  effectiveDueDate: string | null
  penaltyReliefUntil: string | null
  snoozedUntil: string | null
  deadlineStatus: "VERIFIED" | "PROVISIONAL" | "USER_CONFIRMED"
  deadlineSource: string | null
  deadlineReference: string | null
  ruleId: string
  ruleVersion: string
  inputFingerprint: string
  amountSource: string | null
  amountConfirmedAt: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface TaxFiling {
  id: string
  tenantId: string
  subjectId: string
  filingGroup: string
  period: string
  obligationIds: string[]
  status: TaxFilingStatus
  statutoryDueDate: string | null
  effectiveDueDate: string | null
  deadlineStatus: "VERIFIED" | "PROVISIONAL" | "USER_CONFIRMED"
  deadlineSource: string | null
  filedAt: string | null
  reference: string | null
  fulfilledBySettlementId: string | null
  amendmentNumber: number
  amendmentReason: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface TaxSettlement {
  id: string
  tenantId: string
  subjectId: string
  type: TaxSettlementType
  amount: number
  settlementDate: string
  ledgerCompanyId: string | null
  ledgerTransactionId: string | null
  reference: string | null
  source: string
  status: "ACTIVE" | "REVERSED"
  reversedAt: string | null
  reversalReason: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export interface TaxAllocation {
  id: string
  tenantId: string
  settlementId: string
  obligationId: string
  amount: number
  createdAt: string
}

export interface TaxNotificationPreference {
  id: string
  tenantId: string
  subjectId: string | null
  inAppEnabled: boolean
  emailEnabled: boolean
  includeAmountInEmail: boolean
  timezone: string
  deliveryHour: number
  monthlyOffsets: number[]
  annualOffsets: number[]
  overdueWeeklyLimit: number
  revision: number
}

export interface TaxNotification {
  id: string
  tenantId: string
  subjectId: string
  obligationId: string | null
  filingId: string | null
  action: "PREPARE" | "PAY" | "FILE" | "OVERDUE"
  channel: TaxNotificationChannel
  scheduledAt: string
  dedupeKey: string
  status: TaxDeliveryStatus
  attemptCount: number
  lastError: string | null
  sentAt: string | null
}

export interface TaxAgendaItem {
  id: string
  subjectId: string
  companyIds: string[]
  label: string
  kind: TaxKind
  period: string
  action: "PREPARE" | "PAY" | "FILE"
  dueDate: string | null
  amountState: TaxAmountState
  remainingPayable: number | null
  paymentStatus: TaxPaymentStatus
  filingStatus: TaxFilingStatus
  dataStatus: TaxDataStatus
}

import type {
  TaxAmountState,
  TaxDataStatus,
  TaxFilingStatus,
  TaxKind,
  TaxPaymentStatus,
} from "./tax-compliance-types"

export const UMKM_RATE = 0.005
export const UMKM_INDIVIDUAL_FREE_REVENUE = 500_000_000

export interface UmkmMonthInput {
  subjectType: "INDIVIDUAL" | "ENTITY"
  eligible: boolean
  dataComplete: boolean
  cumulativeRevenueBefore: number
  currentMonthRevenue: number
  adjustments?: number
  compatibleThirdPartySettlements?: number
  allocatedPayments?: number
}

export interface TaxAmountResult {
  amountState: TaxAmountState
  dataStatus: TaxDataStatus
  taxableBase: number | null
  liabilityAmount: number | null
  remainingPayable: number | null
  overpaidAmount: number
  paymentStatus: TaxPaymentStatus
  reason: string | null
}

function assertMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
}

export function computeUmkmMonthlyLiability(input: UmkmMonthInput): TaxAmountResult {
  assertMoney(input.cumulativeRevenueBefore, "cumulativeRevenueBefore")
  assertMoney(input.currentMonthRevenue, "currentMonthRevenue")
  const adjustments = input.adjustments ?? 0
  const thirdParty = input.compatibleThirdPartySettlements ?? 0
  const payments = input.allocatedPayments ?? 0
  if (!Number.isSafeInteger(adjustments)) throw new Error("adjustments must be a safe integer")
  assertMoney(thirdParty, "compatibleThirdPartySettlements")
  assertMoney(payments, "allocatedPayments")

  if (!input.eligible) {
    return {
      amountState: "NEEDS_REVIEW", dataStatus: "NEEDS_RECONCILIATION", taxableBase: null,
      liabilityAmount: null, remainingPayable: null, overpaidAmount: 0, paymentStatus: "UNKNOWN",
      reason: "Kelayakan PPh Final UMKM belum terpenuhi.",
    }
  }
  if (!input.dataComplete) {
    return {
      amountState: "UNKNOWN", dataStatus: "INCOMPLETE", taxableBase: null,
      liabilityAmount: null, remainingPayable: null, overpaidAmount: 0, paymentStatus: "UNKNOWN",
      reason: "Omzet seluruh usaha wajib pajak untuk masa ini belum lengkap.",
    }
  }

  const monthRevenue = Math.max(0, input.currentMonthRevenue + adjustments)
  const allowance = input.subjectType === "INDIVIDUAL" ? UMKM_INDIVIDUAL_FREE_REVENUE : 0
  const beforeTaxable = Math.max(0, input.cumulativeRevenueBefore - allowance)
  const afterTaxable = Math.max(0, input.cumulativeRevenueBefore + monthRevenue - allowance)
  const taxableBase = afterTaxable - beforeTaxable
  const liabilityAmount = Math.round(taxableBase * UMKM_RATE)
  const settlements = thirdParty + payments
  const remainingPayable = Math.max(0, liabilityAmount - settlements)
  const overpaidAmount = Math.max(0, settlements - liabilityAmount)
  const paymentStatus: TaxPaymentStatus = liabilityAmount === 0
    ? "NOT_REQUIRED"
    : settlements === 0
      ? "UNPAID"
      : settlements < liabilityAmount
        ? "PARTIAL"
        : settlements === liabilityAmount ? "PAID" : "OVERPAID"

  return {
    amountState: "CONFIRMED",
    dataStatus: "COMPLETE",
    taxableBase,
    liabilityAmount,
    remainingPayable,
    overpaidAmount,
    paymentStatus,
    reason: null,
  }
}

export function computeConfirmedBalance(
  liabilityAmount: number | null,
  compatibleSettlements: number,
): Pick<TaxAmountResult, "remainingPayable" | "overpaidAmount" | "paymentStatus"> {
  assertMoney(compatibleSettlements, "compatibleSettlements")
  if (liabilityAmount === null) return { remainingPayable: null, overpaidAmount: 0, paymentStatus: "UNKNOWN" }
  assertMoney(liabilityAmount, "liabilityAmount")
  const remainingPayable = Math.max(0, liabilityAmount - compatibleSettlements)
  const overpaidAmount = Math.max(0, compatibleSettlements - liabilityAmount)
  const paymentStatus: TaxPaymentStatus = liabilityAmount === 0
    ? "NOT_REQUIRED"
    : compatibleSettlements === 0
      ? "UNPAID"
      : compatibleSettlements < liabilityAmount
        ? "PARTIAL"
        : compatibleSettlements === liabilityAmount ? "PAID" : "OVERPAID"
  return { remainingPayable, overpaidAmount, paymentStatus }
}

export function mayFulfillFilingByValidatedPayment(kind: TaxKind, validated: boolean): TaxFilingStatus {
  if (!validated) return "PENDING"
  return kind === "PPH_FINAL_UMKM" || kind === "PPH_25" ? "FULFILLED_BY_PAYMENT" : "PENDING"
}

export function periodYear(period: string): number {
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(period)
  if (!match) throw new Error("Tax period must be YYYY or YYYY-MM")
  const year = Number(match[1])
  const month = match[2] ? Number(match[2]) : null
  if (month !== null && (month < 1 || month > 12)) throw new Error("Tax period month is invalid")
  return year
}

export function dueState(dueDate: string | null, today: string): "NO_DATE" | "UPCOMING" | "DUE_TODAY" | "OVERDUE" {
  if (!dueDate) return "NO_DATE"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Dates must be YYYY-MM-DD")
  return dueDate === today ? "DUE_TODAY" : dueDate < today ? "OVERDUE" : "UPCOMING"
}

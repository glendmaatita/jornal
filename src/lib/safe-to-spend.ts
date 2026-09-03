// Safe To Spend engine per prd.md §46, §50–54, §58.
// Derived metric — never stored as a static number (§58). Calculated from
// financial state: cash position, tax reserve, other reserves.

import { computeTaxOverview, revenueYTD, businessExpenseYTD, taxPaidYTD } from "./tax"
import type { Account, BusinessProfile, ConfidenceStatus, Reserve, Transaction } from "./types"
import { monthsElapsedThisYear, todayIsoDate } from "./format"

export interface SafeToSpendInput {
  transactions: Transaction[]
  accounts: Account[]
  profile: BusinessProfile
  reserves: Reserve[]
  now?: Date
}

export interface SafeToSpendBreakdownLine {
  label: string
  amount: number // negative = subtracted
  kind: "cash" | "tax" | "reserve"
  id?: string
}

export interface SafeToSpendResult {
  cashPosition: number
  recommendedTaxReserve: number
  otherReservedFunds: number
  safeToSpend: number
  breakdown: SafeToSpendBreakdownLine[]
  confidence: ConfidenceStatus
  confidenceReasons: string[]
}

function transactionsOnOrBefore(transactions: Transaction[], asOfIso: string): Transaction[] {
  return transactions.filter((transaction) => transaction.transactionDate <= asOfIso)
}

/** Opening balances are explicitly OPENING_BALANCE — never revenue (§46.4). */
export function openingBalanceTotal(accounts: Account[], profile: BusinessProfile): number {
  if (profile.useAccountTracking) {
    return accounts
      .filter((account) => account.includedInCash)
      .reduce((sum, account) => sum + account.openingBalance, 0)
  }
  return profile.openingBalance
}

export function computeCashPosition(
  transactions: Transaction[],
  accounts: Account[],
  profile: BusinessProfile,
  asOfIso?: string,
): number {
  let position = openingBalanceTotal(accounts, profile)
  const currentTransactions = asOfIso ? transactionsOnOrBefore(transactions, asOfIso) : transactions
  for (const transaction of currentTransactions) {
    switch (transaction.classification) {
      // Internal transfers move money between accounts — net zero on total position (§32, §46.3)
      case "INTERNAL_TRANSFER":
        break
      case "OPENING_BALANCE":
        break // already included via account/profile opening balances
      case "TAX_PAYMENT":
      case "OWNER_WITHDRAWAL":
      case "ASSET_PURCHASE":
      case "LOAN_PAYMENT":
      case "OTHER_OUTFLOW":
      case "OPERATING_EXPENSE":
        position -= transaction.amount
        break
      case "REVENUE":
      case "CAPITAL_INJECTION":
      case "LOAN_RECEIVED":
      case "REFUND":
      case "OTHER_INCOME":
        position += transaction.amount
        break
      case "UNKNOWN":
        // Unresolved direction still moves money; use recorded direction
        position += transaction.direction === "MONEY_IN" ? transaction.amount : -transaction.amount
        break
    }
  }
  return position
}

export function activeReservesTotal(reserves: Reserve[]): number {
  return reserves.filter((reserve) => reserve.status === "ACTIVE").reduce((sum, reserve) => sum + reserve.amount, 0)
}

// prd.md §50–52 — data confidence
const LARGE_UNRESOLVED_THRESHOLD = 10_000_000
const STALE_DAYS = 14

/**
 * prd.md §50–52 with Phase 1 §64 P1 "improved confidence scoring" (ROADMAP Phase 2 C):
 * more graded signals — unreviewed ratio, staleness, account tracking opt-in —
 * each contributing an explicit, explainable reason.
 */
export function computeConfidence(
  transactions: Transaction[],
  accounts: Account[],
  profile: BusinessProfile,
  reserves: Reserve[],
  now = new Date(),
): { status: ConfidenceStatus; reasons: string[] } {
  const reasons: string[] = []
  let status: ConfidenceStatus = "HIGH_CONFIDENCE"
  const today = todayIsoDate(now)
  const currentTransactions = transactionsOnOrBefore(transactions, today)

  const hasOpening =
    profile.useAccountTracking ? accounts.some((account) => account.includedInCash) : profile.onboardingCompletedAt !== null
  if (!hasOpening) {
    reasons.push("Saldo awal belum diatur")
    status = "LOW_CONFIDENCE"
  }

  const taxIncomplete = !profile.businessStartDate || profile.taxScheme === "NOT_CALCULATED"
  if (taxIncomplete) {
    reasons.push("Profil pajak belum lengkap")
    status = "LOW_CONFIDENCE"
  }

  const unreviewed = currentTransactions.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW")
  const largeUnresolved = unreviewed.filter((transaction) => transaction.amount >= LARGE_UNRESOLVED_THRESHOLD && transaction.classification === "UNKNOWN")
  if (largeUnresolved.length > 0) {
    reasons.push("Ada transaksi besar yang belum diketahui klasifikasinya")
    status = "LOW_CONFIDENCE"
  }

  if (unreviewed.length > 0) {
    reasons.push(`${unreviewed.length} transaksi menunggu konfirmasi`)
    if (status === "HIGH_CONFIDENCE") status = "MEDIUM_CONFIDENCE"
  }

  if (currentTransactions.length > 0) {
    const latest = currentTransactions
      .map((transaction) => transaction.transactionDate)
      .sort()
      .at(-1)
    if (latest) {
      const daysSince = Math.floor((now.getTime() - new Date(`${latest}T00:00:00`).getTime()) / 86_400_000)
      if (daysSince >= STALE_DAYS) {
        reasons.push("Tidak ada catatan transaksi dalam 14 hari terakhir")
        if (status === "HIGH_CONFIDENCE") status = "MEDIUM_CONFIDENCE"
      }
    }
  }

  // §31 / §51 — without account tracking the cash position is an estimate
  if (!profile.useAccountTracking && currentTransactions.length > 0 && status === "HIGH_CONFIDENCE") {
    reasons.push("Pelacakan rekening tidak aktif — posisi kas bersifat estimasi")
    status = "MEDIUM_CONFIDENCE"
  }

  // Phase 3 — balance check-in (§51 "balance not reconciled recently"). Only
  // meaningful once there is enough data to reconcile against.
  if (profile.useAccountTracking && currentTransactions.length >= 10 && status === "HIGH_CONFIDENCE") {
    const checkedIn = profile.lastBalanceCheckIn
    const daysSinceCheckIn = checkedIn
      ? Math.floor((now.getTime() - new Date(`${checkedIn}T00:00:00`).getTime()) / 86_400_000)
      : Number.POSITIVE_INFINITY
    if (daysSinceCheckIn > 30) {
      reasons.push("Saldo aktual belum dicek ulang dalam 30 hari terakhir")
      status = "MEDIUM_CONFIDENCE"
    }
  }

  return { status, reasons }
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { transactions, accounts, profile, reserves } = input
  const now = input.now ?? new Date()
  const today = todayIsoDate(now)
  const currentTransactions = transactionsOnOrBefore(transactions, today)

  const cashPosition = computeCashPosition(currentTransactions, accounts, profile, today)

  const overview = computeTaxOverview({
    scheme: profile.taxScheme,
    businessType: profile.businessType,
    onDate: today,
    revenueYTD: revenueYTD(currentTransactions, profile.fiscalYear),
    businessExpenseYTD: businessExpenseYTD(currentTransactions, profile.fiscalYear),
    taxPaid: taxPaidYTD(currentTransactions, profile.fiscalYear),
    monthsElapsed: monthsElapsedThisYear(now),
  })

  const activeReserves = reserves.filter((reserve) => reserve.status === "ACTIVE")
  const otherReservedFunds = activeReserves.reduce((sum, reserve) => sum + reserve.amount, 0)

  // §46.2 — Safe To Spend = Cash Position − Recommended Tax Reserve − Other Reserved Funds
  const safeToSpend = cashPosition - overview.recommendedTaxReserve - otherReservedFunds

  const breakdown: SafeToSpendBreakdownLine[] = [
    { label: "Posisi Kas", amount: cashPosition, kind: "cash" },
    { label: "Dana Pajak (disarankan)", amount: -overview.recommendedTaxReserve, kind: "tax" },
    ...activeReserves.map((reserve) => ({
      label: reserve.name,
      amount: -reserve.amount,
      kind: "reserve" as const,
      id: reserve.id,
    })),
  ]

  const confidence = computeConfidence(currentTransactions, accounts, profile, reserves, now)

  return {
    cashPosition,
    recommendedTaxReserve: overview.recommendedTaxReserve,
    otherReservedFunds,
    safeToSpend,
    breakdown,
    confidence: confidence.status,
    confidenceReasons: confidence.reasons,
  }
}

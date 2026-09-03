// Safe To Spend history (§59) and contextual insight (§55) — ROADMAP Phase 2 C.
// Snapshots are derived deterministically from financial state as of each date
// (§58: STS must always be recomputable from source data) rather than stored
// statically, so every number stays explainable.

import { computeCashPosition } from "./safe-to-spend"
import { computeTaxOverviewAsOf } from "./tax"
import { formatRupiah, toIsoDate } from "./format"
import {
  resolveAccountsAsOf,
  resolveProfileAsOf,
  resolveReservesAsOf,
  resolveTransactionsAsOf,
} from "./store"
import type { Account, BusinessProfile, Reserve, Transaction } from "./types"

export interface StsSnapshot {
  date: string // YYYY-MM-DD
  cashPosition: number
  recommendedTaxReserve: number
  otherReserve: number
  safeToSpend: number
}

export interface StsHistoryInput {
  transactions: Transaction[]
  accounts: Account[]
  profile: BusinessProfile
  reserves: Reserve[]
}

function activeReservesAsOf(reserves: Reserve[], date: string): Reserve[] {
  return reserves.filter((reserve) => {
    if (reserve.createdAt.slice(0, 10) > date) return false
    if (reserve.status === "ACTIVE") return true
    return reserve.updatedAt.slice(0, 10) > date
  })
}

export function computeSnapshotAsOf(input: StsHistoryInput, date: string, usePersistedHistory = false): StsSnapshot {
  const txnsUpTo = usePersistedHistory ? resolveTransactionsAsOf(date, input.transactions) : input.transactions.filter((transaction) => transaction.transactionDate <= date)
  const accountsAsOf = usePersistedHistory ? resolveAccountsAsOf(date, input.accounts) : input.accounts
  const profileAsOf = usePersistedHistory ? resolveProfileAsOf(date, input.profile) : input.profile
  const reservesActive = usePersistedHistory ? resolveReservesAsOf(date, input.reserves) : activeReservesAsOf(input.reserves, date)
  const otherReserve = reservesActive.reduce((sum, reserve) => sum + reserve.amount, 0)

  const cashPosition = computeCashPosition(txnsUpTo, accountsAsOf, profileAsOf, date)
  const overview = computeTaxOverviewAsOf(profileAsOf, txnsUpTo, date, usePersistedHistory)

  return {
    date,
    cashPosition,
    recommendedTaxReserve: overview.recommendedTaxReserve,
    otherReserve,
    safeToSpend: cashPosition - overview.recommendedTaxReserve - otherReserve,
  }
}

/** Daily snapshots for the trailing `days` days, oldest first (§59). */
export function stsHistory(input: StsHistoryInput, days = 30, now = new Date()): StsSnapshot[] {
  const snapshots: StsSnapshot[] = []
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    snapshots.push(computeSnapshotAsOf(input, toIsoDate(date), true))
  }
  return snapshots
}

export interface StsDeltaReason {
  label: string
  amount: number // positive = reduced Safe To Spend
}

export interface StsWeeklyChange {
  current: StsSnapshot
  previous: StsSnapshot
  delta: number // current.safeToSpend - previous.safeToSpend
  reasons: StsDeltaReason[]
}

/**
 * §55 — "Safe To Spend turun Rp12 juta dibanding minggu lalu" with an
 * explainable reason breakdown (cash flow, tax reserve, new reserves).
 */
export function stsWeeklyChange(input: StsHistoryInput, now = new Date()): StsWeeklyChange | null {
  const history = stsHistory(input, 8, now)
  const current = history[history.length - 1]
  const previous = history[0]
  if (!current || !previous) return null

  const delta = current.safeToSpend - previous.safeToSpend
  const reasons: StsDeltaReason[] = []

  const cashDelta = current.cashPosition - previous.cashPosition
  if (cashDelta !== 0) {
    reasons.push({ label: "Arus kas minggu ini", amount: -cashDelta })
  }

  const taxDelta = current.recommendedTaxReserve - previous.recommendedTaxReserve
  if (taxDelta !== 0) {
    reasons.push({ label: "Dana pajak berubah", amount: taxDelta })
  }

  const previousReserveIds = new Set(resolveReservesAsOf(previous.date, input.reserves).map((reserve) => reserve.id))
  for (const reserve of resolveReservesAsOf(current.date, input.reserves)) {
    if (!previousReserveIds.has(reserve.id)) {
      reasons.push({ label: `Reserve baru: ${reserve.name}`, amount: reserve.amount })
    }
  }

  return { current, previous, delta, reasons }
}

/** Human-readable one-liner for the Home / STS screens (§55). */
export function formatWeeklyChangeText(change: StsWeeklyChange): string {
  const direction = change.delta > 0 ? "naik" : "turun"
  return `Safe To Spend ${direction} ${formatRupiah(Math.abs(change.delta))} dibanding minggu lalu.`
}

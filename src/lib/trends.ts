// Financial intelligence layer (ROADMAP Phase 2): trend aggregation (§36–38),
// recurring transaction detection (§30 — detection only, no auto-creation),
// and automated narrative insights (§39) with a minimum-data guardrail
// (ROADMAP Phase 2 risk: don't show "naik 32%" from 2 thin data points).

import { ALL_CATEGORIES } from "./categories"
import { formatMonthYear, toIsoDate } from "./format"
import type { Transaction, TransactionDirection } from "./types"

export interface MonthlyPoint {
  key: string // YYYY-MM
  label: string // "Sep", "Okt", …
  moneyIn: number
  moneyOut: number
  net: number
  revenue: number
  businessExpense: number
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

/** Aggregated monthly data for the trailing N months, oldest first (§36–38). */
export function monthlyTrends(transactions: Transaction[], months = 6, now = new Date()): MonthlyPoint[] {
  const points: MonthlyPoint[] = []
  for (let offset = months - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
    points.push({
      key,
      label: MONTH_SHORT[date.getMonth()],
      moneyIn: 0,
      moneyOut: 0,
      net: 0,
      revenue: 0,
      businessExpense: 0,
    })
  }
  const byKey = new Map(points.map((point) => [point.key, point]))

  for (const transaction of transactions) {
    const point = byKey.get(transaction.transactionDate.slice(0, 7))
    if (!point || transaction.classification === "INTERNAL_TRANSFER" || transaction.classification === "OPENING_BALANCE") continue
    if (transaction.direction === "MONEY_IN") point.moneyIn += transaction.amount
    else point.moneyOut += transaction.amount
    if (transaction.classification === "REVENUE") point.revenue += transaction.amount
    if (transaction.classification === "OPERATING_EXPENSE") point.businessExpense += transaction.amount
  }
  for (const point of points) point.net = point.moneyIn - point.moneyOut
  return points
}

/** Per-category monthly expense totals for the trailing N months (oldest first). */
export function categoryMonthlyExpenses(transactions: Transaction[], months = 6, now = new Date()): Map<string, number[]> {
  const keys: string[] = []
  for (let offset = months - 1; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`)
  }
  const totals = new Map<string, number[]>()
  for (const transaction of transactions) {
    if (transaction.classification !== "OPERATING_EXPENSE") continue
    const index = keys.indexOf(transaction.transactionDate.slice(0, 7))
    if (index < 0) continue
    const id = transaction.categoryId ?? "uncategorized"
    const series = totals.get(id) ?? new Array(keys.length).fill(0)
    series[index] += transaction.amount
    totals.set(id, series)
  }
  return totals
}

// ── Recurring detection (§30 — detect & suggest, never auto-create) ──

export interface RecurringCandidate {
  description: string
  direction: TransactionDirection
  amount: number // median amount of the cluster
  occurrences: number
  months: string[] // distinct YYYY-MM
  lastDate: string // most recent occurrence (YYYY-MM-DD)
}

function recurringKey(description: string): string {
  return description
    .toLowerCase()
    .replace(/[0-9.,]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
}

/**
 * Detect recurring patterns: same normalized description & direction, similar
 * amounts (±15%), appearing in ≥3 distinct months. Phase 3 adds auto-creation.
 */
export function detectRecurring(transactions: Transaction[]): RecurringCandidate[] {
  const groups = new Map<string, Transaction[]>()
  for (const transaction of transactions) {
    if (transaction.classification === "INTERNAL_TRANSFER") continue
    const key = `${transaction.direction}|${recurringKey(transaction.description)}`
    const list = groups.get(key) ?? []
    list.push(transaction)
    groups.set(key, list)
  }

  const candidates: RecurringCandidate[] = []
  for (const [key, list] of groups) {
    if (list.length < 3) continue
    const amounts = list.map((transaction) => transaction.amount).sort((a, b) => a - b)
    const median = amounts[Math.floor(amounts.length / 2)]
    if (median <= 0) continue
    const cluster = list.filter((transaction) => Math.abs(transaction.amount - median) <= median * 0.15)
    const distinctMonths = [...new Set(cluster.map((transaction) => transaction.transactionDate.slice(0, 7)))]
    if (cluster.length >= 3 && distinctMonths.length >= 3) {
      const [direction] = key.split("|") as [TransactionDirection]
      candidates.push({
        description: cluster[0].description,
        direction,
        amount: median,
        occurrences: cluster.length,
        months: distinctMonths.sort(),
        lastDate: cluster.map((transaction) => transaction.transactionDate).sort().at(-1)!,
      })
    }
  }
  return candidates.sort((a, b) => b.occurrences - a.occurrences)
}

// ── Automated financial insights (§39) ──

export type InsightSeverity = "info" | "positive" | "warning"

export interface FinancialInsight {
  id: string
  severity: InsightSeverity
  text: string
}

export const MIN_MONTHS_FOR_INSIGHTS = 3
const CHANGE_PCT_THRESHOLD = 0.1
const EXPENSE_CHANGE_PCT = 0.2
const EXPENSE_MIN_DELTA = 500_000
const AVG_DEVIATION = 0.45
const AVG_MIN_BASE = 200_000

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return (current - previous) / previous
}

/**
 * Rule-based narrative insights comparing complete months. Returns
 * `sufficientData: false` until ≥3 months of history exist — per the ROADMAP
 * Phase 2 guardrail, thin data must not produce misleading narratives.
 */
export function generateInsights(transactions: Transaction[], months = 6, now = new Date()): { insights: FinancialInsight[]; sufficientData: boolean } {
  const series = monthlyTrends(transactions, months, now)
  const monthsWithData = series.filter((point) => point.moneyIn > 0 || point.moneyOut > 0).length
  if (monthsWithData < MIN_MONTHS_FOR_INSIGHTS) {
    return { insights: [], sufficientData: false }
  }

  const insights: FinancialInsight[] = []
  // Compare the last two complete months (index length-1 is the in-progress month).
  // monthsWithData >= 3 guarantees at least 3 series points, so both exist.
  const current = series[series.length - 2]
  const previous = series[series.length - 3]

  const currentLabel = monthLabel(current.key)
  const previousLabel = monthLabel(previous.key)

  // Revenue month-over-month (§39 example: "Revenue September naik 18%")
  const revenueChange = percentChange(current.revenue, previous.revenue)
  if (revenueChange !== null && Math.abs(revenueChange) >= CHANGE_PCT_THRESHOLD) {
    const up = revenueChange > 0
    insights.push({
      id: "revenue-mom",
      severity: up ? "positive" : "warning",
      text: `Omzet ${currentLabel} ${up ? "naik" : "turun"} ${Math.abs(Math.round(revenueChange * 100))}% dibanding ${previousLabel}.`,
    })
  }

  // Expense category movers (§39 example: marketing +32%)
  const categoryTotals = categoryMonthlyExpenses(transactions, months, now)
  const currentIdx = series.indexOf(current)
  for (const [categoryId, values] of categoryTotals) {
    const change = percentChange(values[currentIdx] ?? 0, values[currentIdx - 1] ?? 0)
    const delta = (values[currentIdx] ?? 0) - (values[currentIdx - 1] ?? 0)
    if (change !== null && Math.abs(change) >= EXPENSE_CHANGE_PCT && Math.abs(delta) >= EXPENSE_MIN_DELTA) {
      const name = ALL_CATEGORIES.find((category) => category.id === categoryId)?.name ?? "Tanpa Kategori"
      const up = change > 0
      insights.push({
        id: `expense-${categoryId}`,
        severity: up ? "warning" : "positive",
        text: `Pengeluaran ${name} ${currentLabel} ${up ? "naik" : "turun"} ${Math.abs(Math.round(change * 100))}% dibanding ${previousLabel}.`,
      })
    }
    // vs 6-month average (§39: "45% di atas rata-rata 6 bulan terakhir")
    const prior = values.slice(0, currentIdx)
    if (prior.length >= 3) {
      const avg = prior.reduce((sum, value) => sum + value, 0) / prior.length
      const value = values[currentIdx] ?? 0
      if (avg >= AVG_MIN_BASE && value >= avg * (1 + AVG_DEVIATION)) {
        const name = ALL_CATEGORIES.find((category) => category.id === categoryId)?.name ?? "Tanpa Kategori"
        insights.push({
          id: `expense-avg-${categoryId}`,
          severity: "warning",
          text: `Pengeluaran ${name} berada ${Math.round(((value - avg) / avg) * 100)}% di atas rata-rata ${prior.length} bulan terakhir.`,
        })
      }
    }
  }

  // Consecutive positive net cashflow (§39 example)
  let consecutive = 0
  for (let index = series.length - 1; index >= 0; index--) {
    if (series[index].net > 0) consecutive++
    else break
  }
  if (consecutive >= 3) {
    insights.push({
      id: "net-positive-streak",
      severity: "positive",
      text: `Net cashflow positif selama ${consecutive} bulan berturut-turut.`,
    })
  }

  return { insights, sufficientData: true }
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number)
  return formatMonthYear(toIsoDate(new Date(year, month - 1, 1))).split(" ")[0]
}

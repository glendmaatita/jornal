// Phase 3 — Safe To Spend Forecast (§61) & expected cashflow modeling (§64 P2).
//
// ROADMAP guardrails applied here:
// - Forecast is explicitly a projection ("estimasi"), never a guarantee (§62–63).
// - Conservative by construction: expected income is taxed before being counted,
//   unknown obligations remain reserved.
// - Every number is explainable via a flow list + assumptions.
//
// Bank "integration" is intentionally NOT implemented as reconciliation —
// it is a manual, read-only balance check-in (see safe-to-spend confidence).

import { computeSafeToSpend, type SafeToSpendInput } from "./safe-to-spend"
import { detectRecurring, categoryMonthlyExpenses, monthlyTrends } from "./trends"
import { computeTaxOverviewAsOf } from "./tax"
import { ALL_CATEGORIES } from "./categories"
import { formatRupiah, toIsoDate, todayIsoDate } from "./format"

export type ExpectedFlowSource = "recurring" | "reserve" | "scenario"

export interface ExpectedFlow {
  id: string
  source: ExpectedFlowSource
  label: string
  direction: "MONEY_IN" | "MONEY_OUT"
  amount: number
  expectedDate: string
}

function addMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(year, month - 1 + months, 1)
  const daysInTarget = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(Math.max(day, 1), Math.min(28, daysInTarget)))
  return toIsoDate(date)
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toIsoDate(date)
}

/** Next monthly occurrence strictly after `fromIso`, assuming monthly cadence. */
export function nextOccurrenceAfter(lastDate: string, fromIso: string): string {
  let next = addMonths(lastDate, 1)
  let guard = 0
  while (next <= fromIso && guard < 36) {
    next = addMonths(next, 1)
    guard += 1
  }
  return next
}

/**
 * Expected cash flows within the horizon: next occurrences of detected
 * recurring transactions + reserves that will come due. Assumption: recurring
 * patterns repeat monthly (documented, conservative for outflows).
 */
export function collectExpectedFlows(
  input: SafeToSpendInput,
  horizonEnd: string,
  todayIso = todayIsoDate(),
): ExpectedFlow[] {
  const flows: ExpectedFlow[] = []

  for (const candidate of detectRecurring(input.transactions)) {
    let next = nextOccurrenceAfter(candidate.lastDate, todayIso)
    while (next <= horizonEnd) {
      flows.push({
        id: `recurring-${candidate.description}-${next}`,
        source: "recurring",
        label: candidate.description || "Transaksi berulang",
        direction: candidate.direction,
        amount: candidate.amount,
        expectedDate: next,
      })
      next = nextOccurrenceAfter(next, next)
    }
  }

  for (const reserve of input.reserves) {
    if (reserve.status !== "ACTIVE" || !reserve.dueDate) continue
    if (reserve.dueDate > horizonEnd) continue
    flows.push({
      id: `reserve-${reserve.id}`,
      source: "reserve",
      label: reserve.name,
      direction: "MONEY_OUT",
      amount: reserve.amount,
      expectedDate: reserve.dueDate < todayIso ? todayIso : reserve.dueDate,
    })
  }

  return flows.sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
}

export interface ScenarioInput {
  /** Hypothetical additional income within the horizon (Rp) */
  extraIncome: number
  /** Hypothetical additional expense/obligation within the horizon (Rp) */
  extraExpense: number
  /** Hypothetical new reserve kept aside (Rp) */
  extraReserve: number
}

export const EMPTY_SCENARIO: ScenarioInput = { extraIncome: 0, extraExpense: 0, extraReserve: 0 }

/** Marginal tax rate used to conservatively tax expected income before counting it. */
function marginalRate(scheme: string, projectedAnnualRevenue: number): number {
  switch (scheme) {
    case "UMKM_FINAL":
      return 0.005
    case "CORPORATE":
      if (projectedAnnualRevenue <= 4_800_000_000) return 0.11
      if (projectedAnnualRevenue > 50_000_000_000) return 0.22
      return 0.22 - (0.11 * 4_800_000_000) / projectedAnnualRevenue
    case "PROGRESSIVE": {
      // Progressive bracket lookup: first ceiling >= revenue wins
      if (projectedAnnualRevenue <= 60_000_000) return 0.05
      if (projectedAnnualRevenue <= 250_000_000) return 0.15
      if (projectedAnnualRevenue <= 500_000_000) return 0.25
      if (projectedAnnualRevenue <= 5_000_000_000) return 0.3
      return 0.35
    }
    default:
      return 0
  }
}

export interface ForecastResult {
  horizonDays: number
  horizonEnd: string
  cashPosition: number
  currentSafeToSpend: number
  expectedIn: number
  expectedOut: number
  projectedTaxReserve: number
  currentTaxReserve: number
  reservedObligations: number
  projectedSafeToSpend: number
  flows: ExpectedFlow[]
  assumptions: string[]
}

/**
 * §61 — Projected Safe To Spend:
 *   Current Cash + Expected Cash In − Expected Cash Out − Tax Reserve − Reserved Obligations
 * with expected income taxed first (conservative, §63) and obligations still
 * outstanding at horizon end kept fully reserved.
 */
export function computeForecast(
  input: SafeToSpendInput,
  options: { horizonDays?: number; scenario?: ScenarioInput } = {},
  now = new Date(),
): ForecastResult {
  const horizonDays = options.horizonDays ?? 30
  const scenario = options.scenario ?? EMPTY_SCENARIO
  const todayIso = todayIsoDate(now)
  const horizonEnd = addDays(todayIso, horizonDays)

  const sts = computeSafeToSpend({ ...input, now })
  const flows = collectExpectedFlows(input, horizonEnd, todayIso)

  if (scenario.extraIncome > 0) {
    flows.push({
      id: "scenario-income",
      source: "scenario",
      label: "Skenario: pemasukan tambahan",
      direction: "MONEY_IN",
      amount: scenario.extraIncome,
      expectedDate: todayIso,
    })
  }
  if (scenario.extraExpense > 0) {
    flows.push({
      id: "scenario-expense",
      source: "scenario",
      label: "Skenario: pengeluaran tambahan",
      direction: "MONEY_OUT",
      amount: scenario.extraExpense,
      expectedDate: todayIso,
    })
  }

  const expectedIn = flows.filter((flow) => flow.direction === "MONEY_IN").reduce((sum, flow) => sum + flow.amount, 0)
  const expectedOut = flows.filter((flow) => flow.direction === "MONEY_OUT").reduce((sum, flow) => sum + flow.amount, 0)

  // Reserves not due within the horizon remain fully reserved at horizon end,
  // plus the hypothetical scenario reserve.
  const reservedObligations =
    input.reserves
      .filter((reserve) => reserve.status === "ACTIVE" && (!reserve.dueDate || reserve.dueDate > horizonEnd))
      .reduce((sum, reserve) => sum + reserve.amount, 0) + scenario.extraReserve

  // Conservatively tax expected income before counting it toward Safe To Spend.
  const overviewToday = computeTaxOverviewAsOf(input.profile, input.transactions, todayIso)
  const rate = marginalRate(overviewToday.rule?.scheme ?? input.profile.taxScheme, overviewToday.projectedAnnualRevenue)
  const projectedTaxReserve = sts.recommendedTaxReserve + Math.round(expectedIn * rate)

  const projectedSafeToSpend = sts.cashPosition + expectedIn - expectedOut - projectedTaxReserve - reservedObligations

  const assumptions: string[] = [
    `Horizon proyeksi ${horizonDays} hari (sampai ${horizonEnd}).`,
    "Transaksi berulang diasumsikan terjadi bulanan dengan nominal serupa.",
    expectedIn > 0
      ? `Pemasukan yang diharapkan dipotong pajak ${Math.round(rate * 100)}% lebih dulu (konservatif).`
      : "Tidak ada pemasukan yang diharapkan dalam horizon.",
    "Kewajiban yang belum jatuh tempo tetap dihitung penuh sebagai reserve.",
    "Proyeksi adalah estimasi — bukan jaminan, dan tidak memperhitungkan tagihan yang belum dicatat.",
  ]

  return {
    horizonDays,
    horizonEnd,
    cashPosition: sts.cashPosition,
    currentSafeToSpend: sts.safeToSpend,
    expectedIn,
    expectedOut,
    projectedTaxReserve,
    currentTaxReserve: sts.recommendedTaxReserve,
    reservedObligations,
    projectedSafeToSpend,
    flows,
    assumptions,
  }
}

// ── Automatic upcoming obligation detection (§64 P2) ──

export interface UpcomingObligation {
  id: string
  label: string
  amount: number
  date: string
  source: "recurring" | "reserve"
}

export function detectUpcomingObligations(input: SafeToSpendInput, withinDays = 30, now = new Date()): UpcomingObligation[] {
  const todayIso = todayIsoDate(now)
  const horizonEnd = addDays(todayIso, withinDays)
  return collectExpectedFlows(input, horizonEnd, todayIso)
    .filter((flow) => flow.direction === "MONEY_OUT")
    .map((flow) => ({
      id: flow.id,
      label: flow.label,
      amount: flow.amount,
      date: flow.expectedDate,
      source: flow.source === "reserve" ? ("reserve" as const) : ("recurring" as const),
    }))
}

// ── AI reserve recommendations (§64 P2 — heuristic, conservative) ──

export interface ReserveRecommendation {
  id: string
  name: string
  amount: number
  reason: string
}

/**
 * Heuristic "AI" recommendation: average each expense category over the last
 * 3 complete months; if meaningful and not already covered by an active
 * reserve, suggest a rounded monthly reserve. Runs entirely on-device.
 */
export function recommendReserves(input: SafeToSpendInput, now = new Date()): ReserveRecommendation[] {
  const months = 4 // trailing 3 complete months + the in-progress month (dropped)
  const series = monthlyTrends(input.transactions, months, now)
  const complete = series.slice(0, -1)
  if (complete.length < 3) return []
  // Data guardrail: don't recommend from thin history
  const monthsWithData = series.filter((point) => point.moneyIn > 0 || point.moneyOut > 0).length
  if (monthsWithData < 3) return []
  const categoryTotals = categoryMonthlyExpenses(input.transactions, months, now)

  const activeNames = input.reserves
    .filter((reserve) => reserve.status === "ACTIVE")
    .map((reserve) => reserve.name.toLowerCase())

  const recommendations: ReserveRecommendation[] = []
  for (const [categoryId, values] of categoryTotals) {
    const completeValues = values.slice(0, complete.length)
    if (completeValues.length < 3) continue
    const avg = completeValues.reduce((sum, value) => sum + value, 0) / completeValues.length
    if (avg < 500_000) continue
    const name = ALL_CATEGORIES.find((category) => category.id === categoryId)?.name ?? "Tanpa Kategori"
    if (activeNames.some((activeName) => activeName.includes(name.toLowerCase()) || name.toLowerCase().includes(activeName))) continue
    const amount = Math.ceil(avg / 100_000) * 100_000
    recommendations.push({
      id: categoryId,
      name,
      amount,
      reason: `Rata-rata pengeluaran ${name} 3 bulan terakhir ${formatRupiah(Math.round(avg))}.`,
    })
  }
  return recommendations.sort((a, b) => b.amount - a.amount).slice(0, 3)
}

import { describe, expect, test } from "bun:test"

import { computeSnapshotAsOf, stsHistory, stsWeeklyChange } from "./history"
import { detectRecurring, generateInsights, monthlyTrends, MIN_MONTHS_FOR_INSIGHTS } from "./trends"
import { computeTaxOverviewAsOf, taxAlerts } from "./tax"
import type { Account, BusinessProfile, Reserve, Transaction } from "./types"

function makeTransaction(partial: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(),
    businessId: "local",
    direction: "MONEY_IN",
    amount: 0,
    currency: "IDR",
    transactionDate: "2026-09-03",
    description: "",
    notes: "",
    categoryId: null,
    paymentMethod: "",
    supplierCustomer: "",
    tags: "",
    accountId: null,
    transferAccountId: null,
    attachmentName: null,
    attachmentDataUrl: null,
    classification: "REVENUE",
    taxClassification: "REVENUE",
    businessRelevance: "BUSINESS",
    classificationSource: "USER",
    classificationConfidence: 1,
    reviewStatus: "ACCEPTED",
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
    ...partial,
  }
}

function makeProfile(partial: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    businessId: "local",
    businessName: "Test",
    businessType: "INDIVIDUAL",
    pkpStatus: false,
    businessStartDate: "2026-01-01",
    fiscalYear: 2026,
    taxScheme: "UMKM_FINAL",
    taxReserveConfirmed: 0,
    openingBalance: 100_000_000,
    useAccountTracking: false,
    lastBalanceCheckIn: null,
    lastCheckedBalance: null,
    lastCheckInDelta: null,
    onboardingCompletedAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  }
}

// ── monthly trends (§36–38) ──

describe("monthly trends", () => {
  test("aggregates by month and excludes transfers/opening balance", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-07-05", amount: 10_000_000, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-07-10", amount: 4_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT" }),
      makeTransaction({ transactionDate: "2026-08-01", amount: 20_000_000, classification: "INTERNAL_TRANSFER" }),
      makeTransaction({ transactionDate: "2026-08-15", amount: 12_000_000, classification: "REVENUE" }),
    ]
    const series = monthlyTrends(transactions, 3, new Date("2026-09-15T00:00:00"))
    expect(series.map((point) => point.label)).toEqual(["Jul", "Agu", "Sep"])
    expect(series[0].revenue).toBe(10_000_000)
    expect(series[0].businessExpense).toBe(4_000_000)
    expect(series[0].net).toBe(6_000_000)
    expect(series[1].revenue).toBe(12_000_000)
    expect(series[1].moneyIn).toBe(12_000_000) // transfer excluded
    expect(series[2].revenue).toBe(0)
  })
})

// ── recurring detection (§30) ──

describe("recurring detection", () => {
  test("detects monthly payments", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-06-01", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace" }),
      makeTransaction({ transactionDate: "2026-07-02", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace" }),
      makeTransaction({ transactionDate: "2026-08-03", amount: 1_600_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace" }),
      makeTransaction({ transactionDate: "2026-08-04", amount: 900_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Random buy" }),
    ]
    const candidates = detectRecurring(transactions)
    expect(candidates.length).toBe(1)
    expect(candidates[0].description.toLowerCase()).toContain("google workspace")
    expect(candidates[0].occurrences).toBe(3)
    expect(candidates[0].months.length).toBe(3)
  })

  test("ignores two occurrences", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-07-01", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Sewa Kantor" }),
      makeTransaction({ transactionDate: "2026-08-01", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Sewa Kantor" }),
    ]
    expect(detectRecurring(transactions)).toHaveLength(0)
  })
})

// ── automated insights (§39) ──

function monthSeries(): Transaction[] {
  // Jul: 100M revenue, 40M expense; Aug: 90M revenue, 55M expense (+37% marketing-ish);
  // Sep (current, partial): 95M revenue, 30M expense
  const out: Transaction[] = []
  const months = [
    { m: "07", revenue: 100_000_000, expense: 40_000_000 },
    { m: "08", revenue: 90_000_000, expense: 55_000_000 },
    { m: "09", revenue: 95_000_000, expense: 30_000_000 },
  ]
  for (const { m, revenue, expense } of months) {
    out.push(makeTransaction({ transactionDate: `2026-${m}-10`, amount: revenue, classification: "REVENUE", categoryId: "inc-sales" }))
    out.push(
      makeTransaction({
        transactionDate: `2026-${m}-10`,
        amount: expense,
        classification: "OPERATING_EXPENSE",
        direction: "MONEY_OUT",
        categoryId: "exp-marketing",
      }),
    )
  }
  return out
}

describe("automated insights", () => {
  test("insufficient data below threshold", () => {
    const result = generateInsights([makeTransaction({ amount: 1_000_000 })], 6, new Date("2026-09-15T00:00:00"))
    expect(result.sufficientData).toBe(false)
    expect(result.insights).toHaveLength(0)
    expect(MIN_MONTHS_FOR_INSIGHTS).toBe(3)
  })

  test("generates narratives with 3 months of data", () => {
    const result = generateInsights(monthSeries(), 6, new Date("2026-09-15T00:00:00"))
    expect(result.sufficientData).toBe(true)
    const texts = result.insights.map((insight) => insight.text)
    // Aug vs Jul: expense +37.5% (40M → 55M) should trigger a warning
    expect(texts.some((text) => text.includes("naik 37") || text.includes("naik 38"))).toBe(true)
    // Aug vs Jul: revenue −10% should trigger
    expect(texts.some((text) => text.includes("turun 10%"))).toBe(true)
  })

  test("consecutive positive net cashflow insight", () => {
    const transactions = monthSeries().map((transaction) =>
      transaction.direction === "MONEY_OUT"
        ? { ...transaction, amount: transaction.amount === 55_000_000 ? 40_000_000 : transaction.amount }
        : transaction,
    )
    const result = generateInsights(transactions, 6, new Date("2026-09-15T00:00:00"))
    expect(result.insights.some((insight) => insight.text.includes("berturut-turut"))).toBe(true)
  })
})

// ── STS history (§59) & weekly change (§55) ──

describe("sts history", () => {
  const input = () => {
    const profile = makeProfile({ openingBalance: 0, useAccountTracking: false })
    const transactions = [
      makeTransaction({ transactionDate: "2026-09-01", amount: 50_000_000, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-09-05", amount: 10_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT" }),
    ]
    const reserves: Reserve[] = [
      {
        id: "r1",
        name: "Payroll",
        amount: 5_000_000,
        dueDate: null,
        status: "ACTIVE",
        createdAt: "2026-09-04T00:00:00Z",
        updatedAt: "2026-09-04T00:00:00Z",
      },
    ]
    return { transactions, accounts: [] as Account[], profile, reserves }
  }

  test("snapshot as of date includes only past transactions/reserves", () => {
    const beforeReserve = computeSnapshotAsOf(input(), "2026-09-03")
    expect(beforeReserve.cashPosition).toBe(50_000_000)
    expect(beforeReserve.otherReserve).toBe(0)

    const afterReserve = computeSnapshotAsOf(input(), "2026-09-10")
    expect(afterReserve.cashPosition).toBe(40_000_000)
    expect(afterReserve.otherReserve).toBe(5_000_000)
    expect(afterReserve.recommendedTaxReserve).toBe(0)
    expect(afterReserve.safeToSpend).toBe(35_000_000)
  })

  test("history is chronological with today last", () => {
    const history = stsHistory(input(), 10, new Date("2026-09-10T00:00:00"))
    expect(history).toHaveLength(10)
    expect(history[0].date).toBe("2026-09-01")
    expect(history[9].date).toBe("2026-09-10")
    expect(history[8].safeToSpend).toBeLessThan(history[2].safeToSpend)
  })

  test("weekly change reports reserve reason (§55)", () => {
    const change = stsWeeklyChange(input(), new Date("2026-09-10T00:00:00"))
    expect(change).not.toBeNull()
    expect(change!.delta).toBeLessThan(0)
    expect(change!.reasons.some((reason) => reason.label.includes("Payroll"))).toBe(true)
  })
})

// ── tax alerts (§5.1 #9) ──

describe("tax alerts", () => {
  test("no alerts without data or scheme", () => {
    expect(taxAlerts(makeProfile({ taxScheme: "NOT_CALCULATED" }), [])).toHaveLength(0)
    expect(taxAlerts(makeProfile(), [])).toHaveLength(0)
  })

  test("warns when UMKM limit exceeded", () => {
    const transactions = [makeTransaction({ transactionDate: "2026-05-01", amount: 5_000_000_000, classification: "REVENUE" })]
    const alerts = taxAlerts(makeProfile({ pkpStatus: true }), transactions, new Date("2026-09-15T00:00:00"))
    expect(alerts.some((alert) => alert.id === "umkm-limit-exceeded")).toBe(true)
  })

  test("info when approaching UMKM limit and PKP threshold", () => {
    const transactions = [makeTransaction({ transactionDate: "2026-05-01", amount: 4_200_000_000, classification: "REVENUE" })]
    const alerts = taxAlerts(makeProfile(), transactions, new Date("2026-09-15T00:00:00"))
    // projected = 4.2B/9*12 = 5.6B → PKP threshold crossed
    expect(alerts.some((alert) => alert.id === "pkp-threshold")).toBe(true)
    // YTD 4.2B is 87.5% of 4.8B → approaching
    expect(alerts.some((alert) => alert.id === "umkm-limit-approaching")).toBe(true)
  })

  test("progressive bracket transition info", () => {
    const transactions = [makeTransaction({ transactionDate: "2026-05-01", amount: 43_000_000, classification: "REVENUE" })]
    const alerts = taxAlerts(makeProfile({ taxScheme: "PROGRESSIVE" }), transactions, new Date("2026-09-15T00:00:00"))
    // projected = 43M/9*12 ≈ 57.3M ≥ 90% of 60M
    expect(alerts.some((alert) => alert.text.includes("tarif 15%"))).toBe(true)
  })
})

// ── tax overview as-of (§59 support) ──

describe("tax overview as-of", () => {
  test("only counts transactions up to the date", () => {
    const profile = makeProfile()
    const transactions = [
      makeTransaction({ transactionDate: "2026-02-01", amount: 100_000_000, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-08-01", amount: 200_000_000, classification: "REVENUE" }),
    ]
    const asOfFeb = computeTaxOverviewAsOf(profile, transactions, "2026-02-15")
    expect(asOfFeb.revenueYTD).toBe(100_000_000)
    const asOfAug = computeTaxOverviewAsOf(profile, transactions, "2026-08-15")
    expect(asOfAug.revenueYTD).toBe(300_000_000)
    expect(asOfAug.estimatedTax).toBe(0)
  })
})

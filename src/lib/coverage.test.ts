// Coverage completion tests: remaining branches across store, tax,
// safe-to-spend, history, forecast, classification, trends, pocketbase-sync.

import { describe, expect, test, beforeEach } from "bun:test"

import "./test-setup"
import { resetStorage, localStorageShim } from "./test-setup"
import {
  KEYS,
  createReserve,
  createTransaction,
  loadAccountHistory,
  loadReserveHistory,
  loadTransactionHistory,
  loadProfileHistory,
  loadAccounts as loadAccountsFromStore,
  upsertAccount,
  saveProfile,
  resetAllData,
  resolveAccountsAsOf,
} from "./store"
import { computeTaxOverview, computeTaxOverviewAsOf, taxAlerts, allowedTaxSchemes, resolveTaxRule, TAX_RULES } from "./tax"
import { computeSafeToSpend, computeCashPosition, computeConfidence, openingBalanceTotal, activeReservesTotal } from "./safe-to-spend"
import { stsWeeklyChange, formatWeeklyChangeText } from "./history"
import { computeForecast, collectExpectedFlows, nextOccurrenceAfter } from "./forecast"
import { classifyTransaction, detectDirection, reviewStatusFor, patternToken } from "./classification"
import { categoryMonthlyExpenses, detectRecurring } from "./trends"
import type { BusinessProfile, Reserve, Transaction } from "./types"

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

beforeEach(() => {
  resetStorage()
})

// ── store: history seeders ──

describe("store history seeders", () => {
  test("loadAccountHistory seeds from existing accounts", () => {
    upsertAccount({ name: "Cash", type: "CASH", openingBalance: 10, includedInCash: true })
    const history = loadAccountHistory()
    expect(history.length).toBeGreaterThan(0)
    expect(loadAccountHistory()).toEqual(history)
  })

  test("loadAccountHistory with no accounts returns empty", () => {
    expect(loadAccountHistory()).toEqual([])
  })

  test("loadTransactionHistory seeds from existing transactions", () => {
    createTransaction(makeInputHelper())
    const history = loadTransactionHistory()
    expect(history.length).toBeGreaterThan(0)
  })

  test("loadTransactionHistory falls back to empty", () => {
    expect(loadTransactionHistory()).toEqual([])
  })

  test("loadReserveHistory seeds from existing reserves", () => {
    createReserve({ name: "X", amount: 1, dueDate: null })
    const history = loadReserveHistory()
    expect(history.length).toBeGreaterThan(0)
  })

  test("loadReserveHistory falls back to empty", () => {
    expect(loadReserveHistory()).toEqual([])
  })

  test("loadProfileHistory seeds from current profile", () => {
    expect(loadProfileHistory().length).toBeGreaterThan(0)
  })

  test("resetAllData removes history keys", () => {
    upsertAccount({ name: "A", type: "CASH", openingBalance: 1, includedInCash: true })
    createTransaction(makeInputHelper())
    loadAccountHistory()
    loadTransactionHistory()
    resetAllData()
    expect(localStorageShim.getItem(KEYS.accountHistory)).toBeNull()
    expect(localStorageShim.getItem(KEYS.transactionHistory)).toBeNull()
  })

  test("resolveAccountsAsOf uses seeded history", () => {
    upsertAccount({ name: "B", type: "BANK", openingBalance: 5, includedInCash: true })
    const accounts = loadAccountsFromStore()
    expect(resolveAccountsAsOf("2099-01-01", accounts)).toHaveLength(1)
    expect(resolveAccountsAsOf("2020-01-01", accounts)).toHaveLength(0)
  })
})

function makeInputHelper() {
  return {
    direction: "MONEY_IN" as const,
    amount: 1000,
    currency: "IDR",
    transactionDate: "2026-09-03",
    description: "penjualan test",
    notes: "",
    categoryId: "inc-sales",
    paymentMethod: "",
    supplierCustomer: "",
    tags: "",
    accountId: null,
    transferAccountId: null,
    attachmentName: null,
    attachmentDataUrl: null,
    classification: "REVENUE" as const,
    taxClassification: "REVENUE" as const,
    businessRelevance: "BUSINESS" as const,
    classificationSource: "RULE" as const,
    classificationConfidence: 0.9,
    reviewStatus: "AUTO_ACCEPTED" as const,
  }
}

// ── tax: scheme fallbacks + corporate tiers + alerts ──

describe("tax scheme gating", () => {
  test("allowedTaxSchemes per business type", () => {
    expect(allowedTaxSchemes("INDIVIDUAL")).toContain("PROGRESSIVE")
    expect(allowedTaxSchemes("PT")).toEqual(["CORPORATE", "NOT_CALCULATED"])
    expect(allowedTaxSchemes("CV")).toEqual(["CORPORATE", "NOT_CALCULATED"])
    expect(allowedTaxSchemes("OTHER")).toContain("CORPORATE")
  })

  test("disallowed scheme falls back with note", () => {
    const overview = computeTaxOverview({
      scheme: "CORPORATE",
      businessType: "INDIVIDUAL", // corporate not allowed for individual
      onDate: "2026-09-03",
      revenueYTD: 90_000_000,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.appliedScheme).toBe("PROGRESSIVE")
    expect(overview.explanation).toContain("tidak tersedia")
  })

  test("UMKM over limit falls back", () => {
    const overview = computeTaxOverview({
      scheme: "UMKM_FINAL",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 4_000_000_000, // projected 5.33B > 4.8B
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.appliedScheme).not.toBe("UMKM_FINAL")
    expect(overview.explanation).toContain("4,8")
  })

  test("corporate tax tiers: reduced / proportional / full", () => {
    const base = { scheme: "CORPORATE" as const, businessType: "PT" as const, onDate: "2026-09-03", revenueYTD: 0, businessExpenseYTD: 0, taxPaid: 0, monthsElapsed: 9 }

    // Reduced 11% when projected revenue ≤ 4.8B
    const small = computeTaxOverview({ ...base, revenueYTD: 30_000_000, businessExpenseYTD: 10_000_000 })
    // profit YTD 20M → annual 26.67M; revenue ≤ 4.8B → 11%
    expect(small.estimatedTax).toBe(Math.round(((20_000_000 / 9) * 12 * 11) / 100))

    // Proportional when 4.8B < projected ≤ 50B
    const mid = computeTaxOverview({ ...base, revenueYTD: 3_600_000_000, businessExpenseYTD: 900_000_000 })
    expect(mid.appliedScheme).toBe("CORPORATE")
    expect(mid.estimatedTax).toBeGreaterThan(0)

    const big = computeTaxOverview({ ...base, revenueYTD: 36_000_000_000, businessExpenseYTD: 9_000_000_000 })
    expect(big.estimatedTax).toBeGreaterThan(0)
  })

  test("resolveTaxRule respects effectiveUntil window", () => {
    expect(resolveTaxRule("UMKM_FINAL", "2021-01-01")).toBeNull()
    expect(TAX_RULES.every((rule) => rule.effectiveUntil === null)).toBe(true)
  })

  test("progressive with profit below PTKP yields zero", () => {
    const overview = computeTaxOverview({
      scheme: "PROGRESSIVE",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 36_000_000, // annual 48M < PTKP+expense
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.estimatedTax).toBe(0)
  })

  test("computeTaxOverviewAsOf with persisted history path", () => {
    const profile = makeProfile()
    const transactions = [makeTransaction({ transactionDate: "2026-02-01", amount: 120_000_000, classification: "REVENUE" })]
    const overview = computeTaxOverviewAsOf(profile, transactions, "2026-02-15", true)
    expect(overview.revenueYTD).toBe(120_000_000)
  })

  test("tax alerts: PKP already registered skips threshold alert", () => {
    const transactions = [makeTransaction({ transactionDate: "2026-05-01", amount: 5_000_000_000, classification: "REVENUE" })]
    const alerts = taxAlerts(makeProfile({ pkpStatus: true, taxScheme: "PROGRESSIVE" }), transactions, new Date("2026-09-15T00:00:00"))
    expect(alerts.some((alert) => alert.id === "pkp-threshold")).toBe(false)
  })

  test("progressive alert skips when far from bracket boundary", () => {
    const transactions = [makeTransaction({ transactionDate: "2026-05-01", amount: 22_500_000, classification: "REVENUE" })]
    const alerts = taxAlerts(makeProfile({ taxScheme: "PROGRESSIVE" }), transactions, new Date("2026-09-15T00:00:00"))
    expect(alerts).toHaveLength(0)
  })
})

// ── safe-to-spend: residual branches ──

describe("safe-to-spend branches", () => {
  test("account-tracking opening balance filtered by includedInCash", () => {
    const profile = makeProfile({ useAccountTracking: true, openingBalance: 0 })
    const accounts = [
      { id: "a", name: "In", type: "BANK" as const, openingBalance: 100, includedInCash: true, createdAt: "", updatedAt: "" },
      { id: "b", name: "Out", type: "BANK" as const, openingBalance: 999, includedInCash: false, createdAt: "", updatedAt: "" },
    ]
    expect(openingBalanceTotal(accounts, profile)).toBe(100)
    expect(computeCashPosition([], accounts, profile)).toBe(100)
  })

  test("every classification moves cash correctly", () => {
    const profile = makeProfile({ openingBalance: 0 })
    const transactions = [
      makeTransaction({ amount: 100, classification: "REVENUE" }),
      makeTransaction({ amount: 10, classification: "CAPITAL_INJECTION" }),
      makeTransaction({ amount: 5, classification: "LOAN_RECEIVED" }),
      makeTransaction({ amount: 3, classification: "REFUND" }),
      makeTransaction({ amount: 2, classification: "OTHER_INCOME" }),
      makeTransaction({ amount: 20, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 5, classification: "TAX_PAYMENT", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 4, classification: "OWNER_WITHDRAWAL", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 6, classification: "ASSET_PURCHASE", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 2, classification: "LOAN_PAYMENT", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 1, classification: "OTHER_OUTFLOW", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 50, classification: "INTERNAL_TRANSFER", direction: "MONEY_OUT" }),
      makeTransaction({ amount: 8, classification: "OPENING_BALANCE" }),
      makeTransaction({ amount: 7, classification: "UNKNOWN", direction: "MONEY_OUT" }),
    ]
    // in: 100+10+5+3+2 = 120; out: 20+5+4+6+2+1+7(unknown-out) = 45 → 75
    expect(computeCashPosition(transactions, [], profile)).toBe(100 + 10 + 5 + 3 + 2 - 20 - 5 - 4 - 6 - 2 - 1 - 7)
  })

  test("activeReservesTotal ignores non-active", () => {
    const reserves: Reserve[] = [
      { id: "1", name: "A", amount: 10, dueDate: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
      { id: "2", name: "B", amount: 5, dueDate: null, status: "USED", createdAt: "", updatedAt: "" },
    ]
    expect(activeReservesTotal(reserves)).toBe(10)
  })

  test("balance check-in stale (>30 days) caps confidence at MEDIUM", () => {
    const accounts = [{ id: "a", name: "BCA", type: "BANK" as const, openingBalance: 50_000_000, includedInCash: true, createdAt: "", updatedAt: "" }]
    const transactions = Array.from({ length: 12 }, (_, index) =>
      makeTransaction({ transactionDate: `2026-09-${String(index + 1).padStart(2, "0")}`, amount: 100_000, classification: "REVENUE" }),
    )
    const profile = makeProfile({ useAccountTracking: true, openingBalance: 0, lastBalanceCheckIn: "2026-01-01" })
    const result = computeConfidence(transactions, accounts, profile, [], new Date("2026-09-20T00:00:00"))
    expect(result.status).toBe("MEDIUM_CONFIDENCE")
    expect(result.reasons.some((reason) => reason.includes("30 hari"))).toBe(true)
  })

  test("recent check-in keeps HIGH confidence", () => {
    const accounts = [{ id: "a", name: "BCA", type: "BANK" as const, openingBalance: 50_000_000, includedInCash: true, createdAt: "", updatedAt: "" }]
    const transactions = Array.from({ length: 12 }, (_, index) =>
      makeTransaction({ transactionDate: `2026-09-${String(index + 1).padStart(2, "0")}`, amount: 100_000, classification: "REVENUE" }),
    )
    const profile = makeProfile({ useAccountTracking: true, openingBalance: 0, lastBalanceCheckIn: "2026-09-01" })
    const result = computeConfidence(transactions, accounts, profile, [], new Date("2026-09-03T00:00:00"))
    expect(result.status).toBe("HIGH_CONFIDENCE")
  })

  test("unreviewed ratio duplicate reason is not added twice", () => {
    const profile = makeProfile()
    const transactions = [
      ...Array.from({ length: 5 }, (_, index) =>
        makeTransaction({ transactionDate: "2026-09-01", amount: 1000, classification: "REVENUE", reviewStatus: index < 4 ? "NEEDS_REVIEW" : "ACCEPTED" }),
      ),
    ]
    const result = computeConfidence(transactions, [], profile, [], new Date("2026-09-03T00:00:00"))
    const confirmationReasons = result.reasons.filter((reason) => reason.includes("konfirmasi"))
    expect(confirmationReasons.length).toBe(1)
  })

  test("transactions dated after `now` are excluded", () => {
    const profile = makeProfile()
    const transactions = [
      makeTransaction({ transactionDate: "2026-09-10", amount: 999, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-09-01", amount: 100, classification: "REVENUE" }),
    ]
    const result = computeSafeToSpend({ transactions, accounts: [], profile, reserves: [], now: new Date("2026-09-03T00:00:00") })
    expect(result.cashPosition).toBe(100_000_000 + 100)
  })
})

// ── history: weekly-change branches ──

describe("history branches", () => {
  test("weekly change with no reasons when nothing moved", () => {
    const profile = makeProfile({ openingBalance: 100_000_000 })
    const change = stsWeeklyChange({ transactions: [], accounts: [], profile, reserves: [] }, new Date("2026-09-10T00:00:00"))
    expect(change).not.toBeNull()
    expect(change!.delta).toBe(0)
    expect(change!.reasons).toHaveLength(0)
  })

  test("formatWeeklyChangeText picks direction", () => {
    const profile = makeProfile({ openingBalance: 100_000_000 })
    const up = stsWeeklyChange({ transactions: [makeTransaction({ transactionDate: "2026-09-09", amount: 1_000_000, classification: "REVENUE" })], accounts: [], profile, reserves: [] }, new Date("2026-09-10T00:00:00"))
    expect(formatWeeklyChangeText(up!)).toContain("naik")
  })
})

// ── forecast: marginal rate branches via scenario income ──

describe("forecast marginal rate (via scenario income)", () => {
  const base = (profile: BusinessProfile) => ({ transactions: [] as Transaction[], accounts: [], profile, reserves: [] as Reserve[], now: new Date("2026-09-10T00:00:00") })
  const scenario = { extraIncome: 10_000_000, extraExpense: 0, extraReserve: 0 }

  test("corporate ≤ 4.8B → 11%", () => {
    const forecast = computeForecast(base(makeProfile({ taxScheme: "CORPORATE", businessType: "PT" })), { scenario }, new Date("2026-09-10T00:00:00"))
    expect(forecast.projectedTaxReserve).toBe(1_100_000) // 10M × 11%
  })

  test("progressive brackets by projected revenue", () => {
    // projected = 0 revenue YTD → marginal rate falls to first bracket (5%)
    const result = computeForecast(base(makeProfile({ taxScheme: "PROGRESSIVE" })), { scenario }, new Date("2026-09-10T00:00:00"))
    expect(result.projectedTaxReserve).toBe(500_000)
  })

  test("default scheme (NOT_CALCULATED) → rate 0", () => {
    const result = computeForecast(base(makeProfile({ taxScheme: "NOT_CALCULATED" })), { scenario }, new Date("2026-09-10T00:00:00"))
    expect(result.projectedTaxReserve).toBe(0)
  })

  test("scenario expense + reserve subtract", () => {
    const s = { extraIncome: 0, extraExpense: 4_000_000, extraReserve: 2_000_000 }
    const result = computeForecast(base(makeProfile()), { scenario: s }, new Date("2026-09-10T00:00:00"))
    expect(result.projectedSafeToSpend).toBe(100_000_000 - 4_000_000 - 2_000_000)
    expect(result.reservedObligations).toBe(2_000_000)
  })

  test("collectExpectedFlows without horizon matches", () => {
    const profile = makeProfile()
    const input = {
      transactions: [makeTransaction({ transactionDate: "2026-08-05", amount: 1_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Sewa kantor" })],
      accounts: [],
      profile,
      reserves: [],
    }
    // Single occurrence — not recurring; no flows
    expect(collectExpectedFlows(input, "2026-10-10", "2026-09-10")).toHaveLength(0)
    // nextOccurrenceAfter clamping
    expect(nextOccurrenceAfter("2026-02-30" as string, "2026-03-01")).toBe("2026-03-28")
  })
})

// ── classification/trends residuals ──

describe("classification residuals", () => {
  test("empty description classified UNKNOWN low confidence", () => {
    const result = classifyTransaction("", "MONEY_OUT")
    expect(result.classification).toBe("UNKNOWN")
    expect(result.confidence).toBeLessThan(0.7)
  })

  test("money-in without match → OTHER_INCOME", () => {
    const result = classifyTransaction("xyz", "MONEY_IN")
    expect(result.classification).toBe("OTHER_INCOME")
  })

  test("detectDirection and patternToken", () => {
    expect(detectDirection("bayar gojek")).toBe("MONEY_OUT")
    expect(detectDirection("terima fee project")).toBe("MONEY_IN")
    expect(patternToken("Beli 3 buah, Rp10.000")).not.toContain("10")
  })

  test("reviewStatusFor custom thresholds", () => {
    expect(reviewStatusFor(0.8, { autoAccept: 0.75, needsReview: 0.5 })).toBe("AUTO_ACCEPTED")
  })

  test("detectRecurring filters internal transfers", () => {
    const transactions = [
      makeTransaction({ description: "transfer", classification: "INTERNAL_TRANSFER", direction: "MONEY_OUT", transactionDate: "2026-06-01" }),
      makeTransaction({ description: "transfer", classification: "INTERNAL_TRANSFER", direction: "MONEY_OUT", transactionDate: "2026-07-01" }),
      makeTransaction({ description: "transfer", classification: "INTERNAL_TRANSFER", direction: "MONEY_OUT", transactionDate: "2026-08-01" }),
    ]
    expect(detectRecurring(transactions)).toHaveLength(0)
  })

  test("categoryMonthlyExpenses tracks uncategorized", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-07-01", amount: 100, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: null }),
      makeTransaction({ transactionDate: "2026-08-01", amount: 200, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: null }),
      makeTransaction({ transactionDate: "2026-09-01", amount: 300, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: null }),
    ]
    const totals = categoryMonthlyExpenses(transactions, 3, new Date("2026-09-15T00:00:00"))
    expect(totals.get("uncategorized")?.at(-1)).toBe(300)
  })
})

// ── pocketbase residual: entityAppId non-object payload ──

describe("store error branches", () => {
  test("localStorage write failure keeps session working", () => {
    const originalSetItem = localStorageShim.setItem
    localStorageShim.setItem = () => {
      throw new Error("quota")
    }
    try {
      const created = createTransaction(makeInputHelper())
      expect(created.amount).toBe(1000)
      createReserve({ name: "R", amount: 1, dueDate: null })
      saveProfileSafe()
    } finally {
      localStorageShim.setItem = originalSetItem
    }
  })
})

function saveProfileSafe() {
  saveProfile(makeProfile())
}

// tax: TAX_RULES integrity for alerts coverage
void TAX_RULES
void resolveTaxRule

import { describe, expect, test } from "bun:test"

import { classifyTransaction, confidenceLevel, reviewStatusFor, suggestFromPatterns, detectDirection, type LearnedPattern } from "./classification"
import { parseTransactionInput, parseAmount } from "./nlp"
import { computeTaxOverview, resolveTaxRule } from "./tax"
import { computeSafeToSpend, computeCashPosition } from "./safe-to-spend"
import { formatRupiah, formatSignedRupiah, formatCompactRupiah, formatGroupLabel } from "./format"
import type { Account, BusinessProfile, Reserve, Transaction } from "./types"

// ── format ──

describe("format", () => {
  test("rupiah", () => {
    expect(formatRupiah(150000000)).toBe("Rp150.000.000")
    expect(formatSignedRupiah(40000000)).toBe("+Rp40.000.000")
    expect(formatSignedRupiah(-3000000)).toBe("-Rp3.000.000")
    expect(formatCompactRupiah(45000000)).toBe("Rp45 jt")
    expect(formatCompactRupiah(-3000000)).toBe("-Rp3 jt")
  })
  test("group label", () => {
    expect(formatGroupLabel("2026-09-03", "2026-09-03")).toBe("Hari ini")
    expect(formatGroupLabel("2026-09-02", "2026-09-03")).toBe("Kemarin")
  })
})

// ── classification ──

describe("classification", () => {
  test("marketing keywords", () => {
    const result = classifyTransaction("iklan meta ads", "MONEY_OUT")
    expect(result.classification).toBe("OPERATING_EXPENSE")
    expect(result.categoryId).toBe("exp-marketing")
    expect(result.confidence).toBeGreaterThanOrEqual(0.9)
  })
  test("two hits boosts confidence", () => {
    const single = classifyTransaction("iklan", "MONEY_OUT")
    const double = classifyTransaction("iklan meta ads marketing", "MONEY_OUT")
    expect(double.confidence).toBeGreaterThan(single.confidence)
  })
  test("no match needs review", () => {
    const result = classifyTransaction("halo dunia", "MONEY_OUT")
    expect(result.confidence).toBeLessThan(0.7)
    expect(reviewStatusFor(result.confidence)).toBe("NEEDS_REVIEW")
  })
  test("non-operational: modal masuk", () => {
    const result = classifyTransaction("setoran modal pemilik", "MONEY_IN")
    expect(result.classification).toBe("CAPITAL_INJECTION")
    expect(result.businessRelevance).toBe("BUSINESS")
  })
  test("internal transfer", () => {
    const result = classifyTransaction("transfer bca ke cash", "MONEY_OUT")
    expect(result.classification).toBe("INTERNAL_TRANSFER")
  })
  test("owner withdrawal", () => {
    const result = classifyTransaction("uang pribadi", "MONEY_OUT")
    expect(result.classification).toBe("OWNER_WITHDRAWAL")
  })
  test("loan payment stays an outflow", () => {
    const result = classifyTransaction("cicilan pinjaman bank", "MONEY_OUT")
    expect(result.classification).toBe("LOAN_PAYMENT")
  })
  test("confidence thresholds", () => {
    expect(confidenceLevel(0.95)).toBe("auto_accept")
    expect(confidenceLevel(0.8)).toBe("accept_with_suggestion")
    expect(confidenceLevel(0.5)).toBe("needs_review")
    expect(reviewStatusFor(0.92)).toBe("AUTO_ACCEPTED")
    expect(reviewStatusFor(0.75)).toBe("ACCEPTED")
  })
  test("learned pattern suggestion", () => {
    const patterns: LearnedPattern[] = [
      { token: "facebook ads", categoryId: "exp-marketing", classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", occurrences: 3 },
    ]
    const suggestion = suggestFromPatterns("facebook ads campaign agustus", "MONEY_OUT", patterns)
    expect(suggestion?.source).toBe("HISTORICAL_PATTERN")
    expect(suggestion?.categoryId).toBe("exp-marketing")
    expect(suggestion?.confidence).toBeGreaterThanOrEqual(0.9)
  })
  test("direction hints", () => {
    expect(detectDirection("bayar iklan meta")).toBe("MONEY_OUT")
    expect(detectDirection("penjualan hari ini")).toBe("MONEY_IN")
    expect(detectDirection("transaksi aneh")).toBeNull()
  })
})

// ── nlp ──

describe("nlp", () => {
  test("bayar iklan meta 3jt", () => {
    const parsed = parseTransactionInput("bayar iklan meta 3jt")
    expect(parsed.direction).toBe("MONEY_OUT")
    expect(parsed.amount).toBe(3_000_000)
    expect(parsed.description).toContain("iklan meta")
  })
  test("penjualan 12.5jt", () => {
    const parsed = parseTransactionInput("penjualan hari ini 12.5jt")
    expect(parsed.direction).toBe("MONEY_IN")
    expect(parsed.amount).toBe(12_500_000)
  })
  test("500rb", () => {
    expect(parseAmount("bensin 500rb")).toBe(500_000)
    expect(parseAmount("2 juta")).toBe(2_000_000)
    expect(parseAmount("150000")).toBe(150_000)
  })
  test("kemarin", () => {
    const now = new Date("2026-09-03T10:00:00")
    const parsed = parseTransactionInput("bayar listrik kemarin 300rb", now)
    expect(parsed.transactionDate).toBe("2026-09-02")
  })
})

// ── tax engine ──

describe("tax engine", () => {
  test("rule versioning picks effective rule", () => {
    const rule = resolveTaxRule("UMKM_FINAL", "2026-09-03")
    expect(rule?.id).toBe("UMKM_FINAL_05_P55_2022")
    expect(rule?.effectiveFrom).toBe("2022-01-01")
    expect(resolveTaxRule("UMKM_FINAL", "2021-12-31")).toBeNull()
  })

  test("UMKM final 0.5% of revenue", () => {
    const overview = computeTaxOverview({
      scheme: "UMKM_FINAL",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 846_500_000,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.estimatedTax).toBe(3_143_333)
    expect(overview.projectedAnnualRevenue).toBe(Math.round((846_500_000 / 9) * 12))
  })

  test("reserve = estimated − paid (§46.5)", () => {
    const overview = computeTaxOverview({
      scheme: "UMKM_FINAL",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 3_000_000_000,
      businessExpenseYTD: 0,
      taxPaid: 5_000_000,
      monthsElapsed: 9,
    })
    expect(overview.estimatedTax).toBe(17_500_000)
    expect(overview.recommendedTaxReserve).toBe(12_500_000)
  })

  test("progressive brackets", () => {
    const overview = computeTaxOverview({
      scheme: "PROGRESSIVE",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 90_000_000,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    // Annualized profit 120M - PTKP 54M = 66M → 5% × 60M + 15% × 6M
    expect(overview.estimatedTax).toBe(3_900_000)
  })

  test("corporate on profit", () => {
    const overview = computeTaxOverview({
      scheme: "CORPORATE",
      businessType: "PT",
      onDate: "2026-09-03",
      revenueYTD: 100_000_000,
      businessExpenseYTD: 40_000_000,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.estimatedTax).toBe(8_800_000)
  })

  test("missing scheme yields explanation", () => {
    const overview = computeTaxOverview({
      scheme: "NOT_CALCULATED",
      businessType: "INDIVIDUAL",
      onDate: "2026-09-03",
      revenueYTD: 100,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.rule).toBeNull()
    expect(overview.estimatedTax).toBe(0)
  })

  test("resolveRule works for corporate", () => {
    expect(resolveTaxRule("CORPORATE", "2026-01-01")?.ratePercent).toBe(22)
  })
})

// ── safe to spend ──

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

describe("safe to spend", () => {
  test("cash position excludes internal transfer", () => {
    const transactions = [
      makeTransaction({ direction: "MONEY_IN", amount: 10_000_000, classification: "REVENUE" }),
      makeTransaction({ direction: "MONEY_OUT", amount: 20_000_000, classification: "INTERNAL_TRANSFER" }),
      makeTransaction({ direction: "MONEY_OUT", amount: 3_000_000, classification: "OPERATING_EXPENSE" }),
    ]
    const profile = makeProfile()
    const position = computeCashPosition(transactions, [], profile)
    expect(position).toBe(100_000_000 + 10_000_000 - 3_000_000)
  })

  test("future-dated transactions do not affect current STS", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-09-10", direction: "MONEY_OUT", amount: 25_000_000, classification: "OPERATING_EXPENSE" }),
    ]
    const result = computeSafeToSpend({
      transactions,
      accounts: [],
      profile: makeProfile({ openingBalance: 100_000_000 }),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.cashPosition).toBe(100_000_000)
    expect(result.safeToSpend).toBe(100_000_000)
  })

  test("basic formula §46.2", () => {
    const transactions = [
      makeTransaction({ direction: "MONEY_IN", amount: 10_000_000, classification: "REVENUE" }),
    ]
    const reserves: Reserve[] = [
      { id: "1", name: "Payroll", amount: 12_000_000, dueDate: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
    ]
    const result = computeSafeToSpend({
      transactions,
      accounts: [],
      profile: makeProfile({ openingBalance: 90_000_000 }),
      reserves,
      now: new Date("2026-09-03T00:00:00"),
    })
    // cash = 100M, projected UMKM tax reserve = 0, other = 12M
    expect(result.cashPosition).toBe(100_000_000)
    expect(result.recommendedTaxReserve).toBe(0)
    expect(result.otherReservedFunds).toBe(12_000_000)
    expect(result.safeToSpend).toBe(88_000_000)
  })

  test("negative safe to spend is not floored (§54)", () => {
    const result = computeSafeToSpend({
      transactions: [],
      accounts: [],
      profile: makeProfile({ openingBalance: 20_000_000 }),
      reserves: [{ id: "1", name: "Payroll", amount: 25_000_000, dueDate: null, status: "ACTIVE", createdAt: "", updatedAt: "" }],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.safeToSpend).toBe(-5_000_000)
  })

  test("confidence stays high when a zero opening balance is intentional", () => {
    const result = computeSafeToSpend({
      transactions: [],
      accounts: [],
      profile: makeProfile({ openingBalance: 0 }),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("HIGH_CONFIDENCE")
    expect(result.confidenceReasons).toHaveLength(0)
  })

  test("confidence LOW when tax profile incomplete", () => {
    const result = computeSafeToSpend({
      transactions: [],
      accounts: [],
      profile: makeProfile({ taxScheme: "NOT_CALCULATED" }),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("LOW_CONFIDENCE")
  })

  test("confidence MEDIUM with unreviewed transactions", () => {
    const result = computeSafeToSpend({
      transactions: [makeTransaction({ amount: 5_000_000, classification: "UNKNOWN", reviewStatus: "NEEDS_REVIEW", classificationSource: "RULE", classificationConfidence: 0.4 })],
      accounts: [],
      profile: makeProfile(),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("MEDIUM_CONFIDENCE")
  })

  test("confidence LOW with large unresolved transaction", () => {
    const result = computeSafeToSpend({
      transactions: [makeTransaction({ amount: 50_000_000, classification: "UNKNOWN", reviewStatus: "NEEDS_REVIEW", classificationSource: "RULE", classificationConfidence: 0.4 })],
      accounts: [],
      profile: makeProfile(),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("LOW_CONFIDENCE")
  })

  test("HIGH confidence with complete data (account tracking on)", () => {
    const accounts: Account[] = [
      { id: "bca", name: "BCA", type: "BANK", openingBalance: 50_000_000, includedInCash: true, createdAt: "", updatedAt: "" },
    ]
    const result = computeSafeToSpend({
      transactions: [makeTransaction({ amount: 1_000_000, classification: "REVENUE" })],
      accounts,
      profile: makeProfile({ useAccountTracking: true, openingBalance: 0 }),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("HIGH_CONFIDENCE")
  })

  test("MEDIUM confidence without account tracking (improved scoring, §64 P1)", () => {
    const result = computeSafeToSpend({
      transactions: [makeTransaction({ amount: 1_000_000, classification: "REVENUE" })],
      accounts: [],
      profile: makeProfile({ useAccountTracking: false }),
      reserves: [],
      now: new Date("2026-09-03T00:00:00"),
    })
    expect(result.confidence).toBe("MEDIUM_CONFIDENCE")
    expect(result.confidenceReasons.some((reason) => reason.includes("Pelacakan rekening"))).toBe(true)
  })

  test("account tracking opening balances", () => {
    const accounts: Account[] = [
      { id: "bca", name: "BCA", type: "BANK", openingBalance: 70_000_000, includedInCash: true, createdAt: "", updatedAt: "" },
      { id: "cash", name: "Cash", type: "CASH", openingBalance: 10_000_000, includedInCash: true, createdAt: "", updatedAt: "" },
      { id: "gopay", name: "GoPay", type: "EWALLET", openingBalance: 2_000_000, includedInCash: true, createdAt: "", updatedAt: "" },
    ]
    const profile = makeProfile({ useAccountTracking: true, openingBalance: 999 })
    const position = computeCashPosition([], accounts, profile)
    expect(position).toBe(82_000_000)
  })
})

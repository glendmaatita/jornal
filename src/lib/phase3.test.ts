import { describe, expect, test, beforeEach } from "bun:test"

// Store shim: bun tests run without a DOM — provide in-memory localStorage via
// the shared test setup so the store functions can be exercised.
import "./test-setup"
import { resetStorage } from "./test-setup"

import {
  collectExpectedFlows,
  computeForecast,
  detectUpcomingObligations,
  nextOccurrenceAfter,
  recommendReserves,
  EMPTY_SCENARIO,
} from "./forecast"
import {
  createRecurringRule,
  createTransaction,
  deleteRecurringRule,
  loadCorrections,
  loadTransactions,
  loadRecurringRules,
  processRecurringRules,
  updateTransaction,
} from "./store"
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

beforeEach(() => {
  resetStorage()
})

// ── next occurrence ──

describe("nextOccurrenceAfter", () => {
  test("steps forward month by month", () => {
    expect(nextOccurrenceAfter("2026-08-20", "2026-09-03")).toBe("2026-09-20")
    expect(nextOccurrenceAfter("2026-09-20", "2026-09-25")).toBe("2026-10-20")
    expect(nextOccurrenceAfter("2026-01-31", "2026-03-01")).toBe("2026-03-28") // day clamped to 28
  })
})

// ── expected flows & forecast (§61) ──

function forecastInput() {
  const profile = makeProfile({ openingBalance: 50_000_000, taxScheme: "UMKM_FINAL" })
  const transactions = [
    // Recurring monthly expense: Google Workspace, 3 months
    makeTransaction({ transactionDate: "2026-06-05", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace", categoryId: "exp-software" }),
    makeTransaction({ transactionDate: "2026-07-05", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace", categoryId: "exp-software" }),
    makeTransaction({ transactionDate: "2026-08-05", amount: 1_500_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", description: "Google Workspace", categoryId: "exp-software" }),
  ]
  const reserves: Reserve[] = [
    { id: "r1", name: "Payroll", amount: 10_000_000, dueDate: "2026-09-25", status: "ACTIVE", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" },
    { id: "r2", name: "Deposite gedung", amount: 20_000_000, dueDate: "2027-01-10", status: "ACTIVE", createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z" },
  ]
  return { transactions, accounts: [] as Account[], profile, reserves, now: new Date("2026-09-10T00:00:00") }
}

describe("collectExpectedFlows", () => {
  test("includes recurring next occurrence and reserves due within horizon", () => {
    const flows = collectExpectedFlows(forecastInput(), "2026-10-10", "2026-09-10")
    const labels = flows.map((flow) => flow.label)
    expect(labels).toContain("Google Workspace")
    expect(labels).toContain("Payroll")
    expect(labels).not.toContain("Deposite gedung") // due beyond horizon → stays reserved
    const recurring = flows.find((flow) => flow.label === "Google Workspace")!
    expect(recurring.expectedDate).toBe("2026-10-05") // next monthly occurrence after 2026-09-10
    expect(recurring.direction).toBe("MONEY_OUT")
    expect(recurring.amount).toBe(1_500_000)
  })

  test("includes every recurring occurrence inside a longer horizon", () => {
    const flows = collectExpectedFlows(forecastInput(), "2026-12-10", "2026-09-10")
    const recurringDates = flows.filter((flow) => flow.label === "Google Workspace").map((flow) => flow.expectedDate)
    expect(recurringDates).toEqual(["2026-10-05", "2026-11-05", "2026-12-05"])
  })
})

describe("computeForecast (§61)", () => {
  test("formula: cash + in − out − tax − reserved obligations", () => {
    const forecast = computeForecast(forecastInput(), { horizonDays: 30 }, new Date("2026-09-10T00:00:00"))
    // cash = 50M opening − 3×1.5M past workspace months = 45.5M
    expect(forecast.cashPosition).toBe(45_500_000)
    expect(forecast.expectedIn).toBe(0)
    expect(forecast.expectedOut).toBe(11_500_000) // 1.5M workspace + 10M payroll
    // projected tax reserve = current (0.5% × revenue YTD=0 → 0) + 0 = 0
    expect(forecast.projectedTaxReserve).toBe(0)
    // reserved obligations = Deposite gedung 20M (due beyond horizon)
    expect(forecast.reservedObligations).toBe(20_000_000)
    expect(forecast.projectedSafeToSpend).toBe(45_500_000 + 0 - 11_500_000 - 0 - 20_000_000)
  })

  test("scenario inputs change the projection and are explainable", () => {
    const scenario = { extraIncome: 20_000_000, extraExpense: 5_000_000, extraReserve: 2_000_000 }
    const forecast = computeForecast(forecastInput(), { horizonDays: 30, scenario }, new Date("2026-09-10T00:00:00"))
    // extra income taxed at UMKM 0.5% → +20M − 100k
    expect(forecast.projectedSafeToSpend).toBe(45_500_000 + 20_000_000 - 100_000 - 16_500_000 - 22_000_000)
    expect(forecast.assumptions.some((assumption) => assumption.includes("konservatif"))).toBe(true)
  })

  test("empty scenario object is the default", () => {
    expect(EMPTY_SCENARIO).toEqual({ extraIncome: 0, extraExpense: 0, extraReserve: 0 })
  })
})

// ── upcoming obligations (§64 P2) ──

describe("detectUpcomingObligations", () => {
  test("lists only outflows sorted by date", () => {
    const obligations = detectUpcomingObligations(forecastInput(), 30, new Date("2026-09-10T00:00:00"))
    expect(obligations.every((obligation) => obligation.source === "reserve" || obligation.source === "recurring")).toBe(true)
    const dates = obligations.map((obligation) => obligation.date)
    expect([...dates].sort()).toEqual(dates)
    expect(obligations.some((obligation) => obligation.label === "Payroll")).toBe(true)
  })
})

// ── AI reserve recommendations (§64 P2) ──

describe("recommendReserves", () => {
  test("recommends meaningful categories not already reserved", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-06-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
      makeTransaction({ transactionDate: "2026-07-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
      makeTransaction({ transactionDate: "2026-08-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
      makeTransaction({ transactionDate: "2026-08-11", amount: 100_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-office" }),
    ]
    const input = { transactions, accounts: [] as Account[], profile: makeProfile(), reserves: [], now: new Date("2026-09-15T00:00:00") }
    const recommendations = recommendReserves(input)
    expect(recommendations.length).toBe(1)
    expect(recommendations[0].name).toBe("Gaji & Upah")
    expect(recommendations[0].amount).toBe(20_000_000)
    expect(recommendations[0].reason).toContain("3 bulan")
  })

  test("skips categories already covered by an active reserve", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-06-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
      makeTransaction({ transactionDate: "2026-07-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
      makeTransaction({ transactionDate: "2026-08-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
    ]
    const reserves: Reserve[] = [
      { id: "r1", name: "Gaji & Upah", amount: 20_000_000, dueDate: null, status: "ACTIVE", createdAt: "", updatedAt: "" },
    ]
    const recommendations = recommendReserves({ transactions, accounts: [], profile: makeProfile(), reserves })
    expect(recommendations).toHaveLength(0)
  })

  test("needs 3 complete months", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-08-10", amount: 20_000_000, classification: "OPERATING_EXPENSE", direction: "MONEY_OUT", categoryId: "exp-payroll" }),
    ]
    const recommendations = recommendReserves({ transactions, accounts: [], profile: makeProfile(), reserves: [], now: new Date("2026-09-15T00:00:00") })
    expect(recommendations).toHaveLength(0)
  })
})

// ── recurring rule auto-creation (§30 Phase 3) ──

describe("processRecurringRules", () => {
  test("creates transactions only for autoCreate rules and advances nextRun", () => {
    const rule = createRecurringRule({
      direction: "MONEY_OUT",
      description: "Google Workspace",
      amount: 1_500_000,
      categoryId: "exp-software",
      classification: "OPERATING_EXPENSE",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 5,
      nextRun: "2026-09-05",
      autoCreate: true,
    })
    const created = processRecurringRules("2026-09-10")
    expect(created.length).toBe(1)
    expect(created[0].description).toBe("Google Workspace")
    expect(created[0].transactionDate).toBe("2026-09-05")
    expect(created[0].classificationSource).toBe("SYSTEM")
    const updated = loadRecurringRules().find((candidate) => candidate.id === rule.id)!
    expect(updated.nextRun).toBe("2026-10-05")
    expect(updated.createdCount).toBe(1)

    // Paused rules are skipped
    const paused = createRecurringRule({
      direction: "MONEY_IN",
      description: "Sewa kios",
      amount: 500_000,
      categoryId: "inc-sales",
      classification: "REVENUE",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 1,
      nextRun: "2026-09-01",
      autoCreate: false,
    })
    const createdAgain = processRecurringRules("2026-09-10")
    expect(createdAgain).toHaveLength(0)

    // cleanup
    deleteRecurringRule(rule.id)
    deleteRecurringRule(paused.id)
    for (const transaction of loadTransactions()) {
      if (transaction.description === "Google Workspace" || transaction.description === "Sewa kios") {
        // leave cleanup to resetAllData in real usage; transactions are harmless here
      }
    }
  })

  test("catches up at most 3 months", () => {
    const rule = createRecurringRule({
      direction: "MONEY_OUT",
      description: "Catch-up test",
      amount: 100_000,
      categoryId: null,
      classification: "OTHER_OUTFLOW",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 1,
      nextRun: "2026-05-01",
      autoCreate: true,
    })
    const created = processRecurringRules("2026-09-10")
    expect(created.length).toBe(3)
    const updated = loadRecurringRules().find((candidate) => candidate.id === rule.id)!
    expect(updated.nextRun).toBe("2026-08-01")
    deleteRecurringRule(rule.id)
  })
})

describe("correction capture", () => {
  test("records user edits on update", () => {
    resetStorage()
    const transaction = createTransaction({
      direction: "MONEY_OUT",
      amount: 500_000,
      currency: "IDR",
      transactionDate: "2026-09-03",
      description: "Langganan aplikasi",
      notes: "",
      categoryId: null,
      paymentMethod: "",
      supplierCustomer: "",
      tags: "",
      accountId: null,
      transferAccountId: null,
      attachmentName: null,
      attachmentDataUrl: null,
      classification: "UNKNOWN",
      taxClassification: "UNKNOWN",
      businessRelevance: "UNDETERMINED",
      classificationSource: "RULE",
      classificationConfidence: 0.4,
      reviewStatus: "NEEDS_REVIEW",
    })

    updateTransaction(transaction.id, {
      classification: "OPERATING_EXPENSE",
      categoryId: "exp-software",
      classificationSource: "USER",
      classificationConfidence: 1,
      reviewStatus: "ACCEPTED",
    })

    const corrections = loadCorrections()
    expect(corrections).toHaveLength(1)
    expect(corrections[0].classification).toBe("OPERATING_EXPENSE")
    expect(corrections[0].token).toContain("langganan aplikasi")
  })
})

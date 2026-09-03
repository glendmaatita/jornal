import { describe, expect, test, beforeEach } from "bun:test"

import "./test-setup"
import { resetStorage, localStorageShim } from "./test-setup"
import {
  clearCorrections,
  createRecurringRule,
  createReserve,
  createTransaction,
  deleteAccount,
  deleteCorrection,
  deleteRecurringRule,
  deleteTransaction,
  duplicateTransaction,
  emptyProfile,
  isOnboarded,
  loadAccountHistory,
  loadAccounts,
  loadCorrections,
  loadProfile,
  loadProfileHistory,
  loadRecurringRules,
  loadReserveHistory,
  loadReserves,
  loadSettings,
  loadTransactionHistory,
  loadTransactions,
  processRecurringRules,
  recordCorrection,
  removeReserve,
  resetAllData,
  resolveAccountsAsOf,
  resolveProfileAsOf,
  resolveReservesAsOf,
  resolveReview,
  resolveTransactionsAsOf,
  saveAccounts,
  saveProfile,
  saveSettings,
  subscribeFinancialEvents,
  updateRecurringRule,
  updateReserve,
  updateTransaction,
  upsertAccount,
  needsReviewTransactions,
  KEYS,
  updateReserve as patchReserve,
} from "./store"
import type { NewTransaction, Transaction } from "./types"

function makeInput(partial: Partial<NewTransaction> = {}): NewTransaction {
  return {
    direction: "MONEY_IN",
    amount: 100_000,
    currency: "IDR",
    transactionDate: "2026-09-03",
    description: "penjualan",
    notes: "",
    categoryId: "inc-sales",
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
    classificationSource: "RULE",
    classificationConfidence: 0.9,
    reviewStatus: "AUTO_ACCEPTED",
    ...partial,
  }
}

beforeEach(() => {
  resetStorage()
})

describe("profile", () => {
  test("empty profile defaults", () => {
    const profile = emptyProfile()
    expect(profile.businessId).toBe("local")
    expect(profile.taxScheme).toBe("NOT_CALCULATED")
    expect(profile.onboardingCompletedAt).toBeNull()
  })

  test("load/save roundtrip + history seeding", () => {
    const profile = { ...emptyProfile(), businessName: "Kedai", onboardingCompletedAt: "2026-01-01T00:00:00Z" }
    saveProfile(profile)
    expect(loadProfile().businessName).toBe("Kedai")
    expect(loadProfile().updatedAt >= profile.updatedAt).toBe(true)
    // First save seeded the history
    expect(loadProfileHistory().length).toBe(1)
    // Save again appends a second record
    saveProfile({ ...profile, businessName: "Kedai 2" })
    expect(loadProfileHistory().length).toBe(2)
  })

  test("resolveProfileAsOf returns historical version or fallback", () => {
    const profile = { ...emptyProfile(), businessName: "v1" }
    saveProfile(profile)
    saveProfile({ ...profile, businessName: "v2" })
    expect(resolveProfileAsOf("2099-01-01").businessName).toBe("v2")
    // Before any record → fallback to current
    expect(resolveProfileAsOf("2020-01-01", loadProfile()).businessName).toBe(loadProfile().businessName)
  })
})

describe("accounts", () => {
  test("upsert create + update, saveAccounts, deleteAccount", () => {
    const created = upsertAccount({ name: "BCA", type: "BANK", openingBalance: 1000, includedInCash: true })
    expect(created.id).toBeTruthy()
    const updated = upsertAccount({ id: created.id, name: "BCA Utama", type: "BANK", openingBalance: 2000, includedInCash: true })
    expect(updated.name).toBe("BCA Utama")
    expect(loadAccounts()).toHaveLength(1)

    saveAccounts([updated])
    expect(loadAccounts()[0].openingBalance).toBe(2000)
    expect(loadAccountHistory().length).toBeGreaterThan(0)

    deleteAccount(created.id)
    expect(loadAccounts()).toHaveLength(0)
  })

  test("deleteAccount of missing id is a no-op on history", () => {
    deleteAccount("missing")
    expect(loadAccounts()).toHaveLength(0)
  })

  test("account history seeding and as-of resolution", () => {
    const account = upsertAccount({ name: "Cash", type: "CASH", openingBalance: 100, includedInCash: true })
    const history = loadAccountHistory()
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(resolveAccountsAsOf("2099-01-01", loadAccounts())).toHaveLength(1)
    expect(resolveAccountsAsOf("2020-01-01", loadAccounts())).toHaveLength(0)
    void account
  })
})

describe("transactions", () => {
  test("create normalizes tax fields and records USER corrections", () => {
    const created = createTransaction(makeInput({ classificationSource: "USER", description: "facebook ads campaign" }))
    expect(created.taxClassification).toBe("REVENUE")
    expect(created.attachmentDataUrl).toBeNull()
    expect(loadCorrections()).toHaveLength(1)
  })

  test("SYSTEM-sourced transactions do not create corrections", () => {
    createTransaction(makeInput({ classificationSource: "SYSTEM" }))
    expect(loadCorrections()).toHaveLength(0)
  })

  test("create with empty description does not record correction", () => {
    createTransaction(makeInput({ description: "   ", classificationSource: "USER" }))
    expect(loadCorrections()).toHaveLength(0)
  })

  test("update returns null for missing id, emits reclassified event", () => {
    const created = createTransaction(makeInput())
    expect(updateTransaction("missing", { amount: 1 })).toBeNull()
    const events: string[] = []
    const unsubscribe = subscribeFinancialEvents((event) => events.push(event))
    updateTransaction(created.id, { classification: "OTHER_INCOME", categoryId: null })
    unsubscribe()
    expect(events).toContain("TRANSACTION_RECLASSIFIED")
  })

  test("update with USER source records correction", () => {
    const created = createTransaction(makeInput({ classificationSource: "RULE" }))
    updateTransaction(created.id, { classificationSource: "USER", description: "bensin sales" })
    expect(loadCorrections().some((pattern) => pattern.token.includes("bensin"))).toBe(true)
  })

  test("delete appends tombstone and filters as-of", () => {
    const created = createTransaction(makeInput())
    deleteTransaction(created.id)
    expect(loadTransactions()).toHaveLength(0)
    expect(resolveTransactionsAsOf("2020-01-01", loadTransactions())).toHaveLength(0)
    expect(loadTransactionHistory().some((record) => record.deletedAt !== null)).toBe(true)
  })

  test("loadTransactionHistory seeds from existing transactions", () => {
    createTransaction(makeInput())
    expect(loadTransactionHistory().length).toBeGreaterThan(0)
  })

  test("duplicateTransaction copies with (salinan) suffix; null for missing", () => {
    const created = createTransaction(makeInput({ description: "Langganan" }))
    const copy = duplicateTransaction(created.id)
    expect(copy?.description).toBe("Langganan (salinan)")
    expect(duplicateTransaction("missing")).toBeNull()
  })

  test("needsReviewTransactions + resolveReview", () => {
    const created = createTransaction(makeInput({ reviewStatus: "NEEDS_REVIEW", classificationSource: "RULE", classificationConfidence: 0.4 }))
    expect(needsReviewTransactions()).toHaveLength(1)
    resolveReview(created.id, "OPERATING_EXPENSE", "exp-other")
    const resolved = loadTransactions().find((transaction) => transaction.id === created.id)!
    expect(resolved.reviewStatus).toBe("ACCEPTED")
    expect(resolved.classificationSource).toBe("USER")
    expect(resolved.classificationConfidence).toBe(1)
  })
})

describe("corrections", () => {
  test("recordCorrection increments occurrences for same token", () => {
    recordCorrection("facebook ads", "exp-marketing", "OPERATING_EXPENSE", "MONEY_OUT")
    recordCorrection("facebook ads", "exp-marketing", "OPERATING_EXPENSE", "MONEY_OUT")
    expect(loadCorrections()[0].occurrences).toBe(2)
  })

  test("recordCorrection ignores blank tokens", () => {
    recordCorrection("123", null, "REVENUE", "MONEY_IN")
    expect(loadCorrections()).toHaveLength(0)
  })

  test("deleteCorrection and clearCorrections", () => {
    recordCorrection("bensin", "exp-transport", "OPERATING_EXPENSE", "MONEY_OUT")
    const pattern = loadCorrections()[0]
    deleteCorrection("wrong-id")
    expect(loadCorrections()).toHaveLength(1)
    deleteCorrection(pattern.id)
    expect(loadCorrections()).toHaveLength(0)
    recordCorrection("bensin", "exp-transport", "OPERATING_EXPENSE", "MONEY_OUT")
    clearCorrections()
    expect(loadCorrections()).toHaveLength(0)
  })
})

describe("reserves", () => {
  test("create/update/remove + history", () => {
    const reserve = createReserve({ name: "Payroll", amount: 5_000_000, dueDate: "2026-09-30" })
    expect(reserve.status).toBe("ACTIVE")
    expect(updateReserve("missing", { amount: 1 })).toBeNull()

    updateReserve(reserve.id, { amount: 6_000_000 })
    expect(loadReserves()[0].amount).toBe(6_000_000)
    expect(loadReserveHistory().length).toBeGreaterThanOrEqual(2)

    updateReserve(reserve.id, { status: "CANCELLED" })
    expect(removeReserve(reserve.id)).toBeUndefined()
    expect(loadReserves()).toHaveLength(0)

    expect(resolveReservesAsOf("2020-01-01", loadReserves())).toHaveLength(0)
  })
})

describe("recurring rules", () => {
  test("CRUD + updateRecurringRule null for missing", () => {
    const rule = createRecurringRule({
      direction: "MONEY_OUT",
      description: "Sewa",
      amount: 1_000_000,
      categoryId: "exp-rent",
      classification: "OPERATING_EXPENSE",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 5,
      nextRun: "2026-10-05",
      autoCreate: true,
    })
    expect(rule.createdCount).toBe(0)
    updateRecurringRule(rule.id, { autoCreate: false })
    expect(loadRecurringRules()[0].autoCreate).toBe(false)
    expect(updateRecurringRule("missing", { autoCreate: true })).toBeNull()
    deleteRecurringRule(rule.id)
    expect(loadRecurringRules()).toHaveLength(0)
  })

  test("processRecurringRules creates catch-up transactions and advances nextRun", () => {
    const rule = createRecurringRule({
      direction: "MONEY_OUT",
      description: "Sewa kantor",
      amount: 2_000_000,
      categoryId: "exp-rent",
      classification: "OPERATING_EXPENSE",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 5,
      nextRun: "2026-08-05",
      autoCreate: true,
    })
    const created = processRecurringRules("2026-09-10")
    expect(created).toHaveLength(2) // Aug + Sep, capped at 3
    const updated = loadRecurringRules().find((candidate) => candidate.id === rule.id)!
    expect(updated.nextRun).toBe("2026-10-05")
    expect(updated.createdCount).toBe(2)
    expect(updated.lastRun).toBe("2026-09-05")
  })

  test("processRecurringRules skips paused rules", () => {
    createRecurringRule({
      direction: "MONEY_OUT",
      description: "Paused",
      amount: 1,
      categoryId: null,
      classification: "OTHER_OUTFLOW",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 1,
      nextRun: "2026-01-01",
      autoCreate: false,
    })
    expect(processRecurringRules("2026-09-10")).toHaveLength(0)
  })

  test("updateRecurringRule and deleteRecurringRule", () => {
    const rule = createRecurringRule({
      direction: "MONEY_IN",
      description: "Langganan",
      amount: 100_000,
      categoryId: "inc-sales",
      classification: "REVENUE",
      paymentMethod: "",
      accountId: null,
      dayOfMonth: 1,
      nextRun: "2026-10-01",
      autoCreate: false,
    })
    updateRecurringRule(rule.id, { description: "Langganan baru" })
    expect(loadRecurringRules()[0].description).toBe("Langganan baru")
    deleteRecurringRule(rule.id)
    expect(loadRecurringRules()).toHaveLength(0)
  })
})

describe("settings & misc", () => {
  test("loadSettings defaults + saveSettings", () => {
    expect(loadSettings().autoAccept).toBe(0.9)
    saveSettings({ autoAccept: 0.85, needsReview: 0.6 })
    expect(loadSettings().autoAccept).toBe(0.85)
  })

  test("isOnboarded", () => {
    expect(isOnboarded()).toBe(false)
    saveProfile({ ...emptyProfile(), onboardingCompletedAt: "2026-01-01T00:00:00Z" })
    expect(isOnboarded()).toBe(true)
  })

  test("read with corrupt JSON falls back", () => {
    localStorageShim.setItem("jornal.transactions.v1", "{not json")
    expect(loadTransactions()).toEqual([])
  })

  test("resetAllData clears everything", () => {
    saveProfile({ ...emptyProfile(), businessName: "x" })
    createTransaction(makeInput())
    resetAllData()
    expect(loadProfile().businessName).toBe("")
    expect(loadTransactions()).toHaveLength(0)
  })

  test("loadProfileHistory seeds once from current profile", () => {
    saveProfile({ ...emptyProfile(), businessName: "seed" })
    const first = loadProfileHistory()
    const second = loadProfileHistory()
    expect(first.length).toBe(second.length)
  })

  test("resolveTransactionsAsOf with history resolves superseded versions", () => {
    const created = createTransaction(makeInput({ amount: 100 }))
    updateTransaction(created.id, { amount: 200 })
    const asOfFuture = resolveTransactionsAsOf("2099-01-01", loadTransactions())
    expect(asOfFuture.find((transaction) => transaction.id === created.id)?.amount).toBe(200)
  })

  test("resolveReservesAsOf with history resolves deletions", () => {
    const reserve = createReserve({ name: "X", amount: 1, dueDate: null })
    removeReserve(reserve.id)
    expect(resolveReservesAsOf("2099-01-01", loadReserves())).toHaveLength(0)
    expect(resolveReservesAsOf("2020-01-01", loadReserves())).toHaveLength(0)
  })

  test("resolveAccountsAsOf falls back to current when history empty", () => {
    const accounts = [upsertAccount({ name: "A", type: "CASH", openingBalance: 0, includedInCash: true })]
    resetStorage()
    expect(resolveAccountsAsOf("2099-01-01", accounts)).toEqual(accounts)
  })

  test("resolveAsOf fallback branches use provided current data when history keys are empty", () => {
    resetStorage()
    localStorageShim.removeItem(KEYS.profileHistory)
    localStorageShim.removeItem(KEYS.accountHistory)
    localStorageShim.removeItem(KEYS.transactionHistory)
    localStorageShim.removeItem(KEYS.reserveHistory)

    const currentProfile = { ...emptyProfile(), businessName: "Fallback" }
    const currentAccounts = [
      {
        id: "a1",
        name: "Cash",
        type: "CASH" as const,
        openingBalance: 1,
        includedInCash: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]
    const currentTransactions: Transaction[] = [
      {
        ...makeInput({ transactionDate: "2026-01-02", classification: "REVENUE" }),
        id: "t1",
        businessId: "b1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]
    const currentReserves = [
      {
        id: "r1",
        name: "Reserve",
        amount: 1,
        dueDate: null,
        status: "ACTIVE" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]

    expect(resolveProfileAsOf("2026-01-01", currentProfile).businessName).toBe("Fallback")
    expect(resolveAccountsAsOf("2026-01-01", currentAccounts)).toEqual(currentAccounts)
    expect(resolveTransactionsAsOf("2026-01-03", currentTransactions)).toEqual(currentTransactions)
    expect(resolveReservesAsOf("2026-01-01", currentReserves)).toEqual(currentReserves)
  })

  test("resolveReservesAsOf fallback uses current reserves when history is empty", () => {
    resetStorage()
    localStorageShim.removeItem(KEYS.reserveHistory)
    const currentReserves = [
      {
        id: "r-fallback",
        name: "Reserve",
        amount: 5,
        dueDate: null,
        status: "ACTIVE" as const,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]
    expect(resolveReservesAsOf("2026-01-02", currentReserves)).toEqual(currentReserves)
  })

  test("duplicate transaction helper alias", () => {
    const created = createTransaction(makeInput())
    const copy = duplicateTransaction(created.id)
    expect(copy?.description).toContain("(salinan)")
  })

  test("void alias for updateReserve import", () => {
    const reserve = createReserve({ name: "R", amount: 1, dueDate: null })
    expect(patchReserve(reserve.id, { amount: 2 })).not.toBeNull()
    void duplicateTransaction
  })
})

describe("event subscription", () => {
  test("unsubscribe stops delivery", () => {
    const events: string[] = []
    const unsubscribe = subscribeFinancialEvents((event) => events.push(event))
    unsubscribe()
    createTransaction(makeInput())
    expect(events).toHaveLength(0)
  })
})

describe("store direct API touchpoints", () => {
  test("calls the remaining store entry points directly", () => {
    resetStorage()

    const profile = emptyProfile()
    expect(loadProfile().businessId).toBe(profile.businessId)
    saveProfile({ ...profile, businessName: "Direct" })
    expect(loadProfile().businessName).toBe("Direct")

    saveAccounts([])
    expect(loadAccounts()).toEqual([])

    expect(loadTransactions()).toEqual([])
    expect(loadReserves()).toEqual([])
    expect(loadCorrections()).toEqual([])
    expect(loadRecurringRules()).toEqual([])
    expect(loadSettings().autoAccept).toBeGreaterThan(0)

    expect(loadProfileHistory().length).toBeGreaterThan(0)
    expect(loadAccountHistory()).toEqual([])
    expect(loadTransactionHistory()).toEqual([])
    expect(loadReserveHistory()).toEqual([])

    expect(resolveProfileAsOf("2099-01-01")).toBeDefined()
    expect(resolveAccountsAsOf("2099-01-01", [])).toEqual([])
    expect(resolveTransactionsAsOf("2099-01-01", [])).toEqual([])
    expect(resolveReservesAsOf("2099-01-01", [])).toEqual([])

    const events: string[] = []
    const unsubscribe = subscribeFinancialEvents((event) => events.push(event))
    unsubscribe()
    clearCorrections()
    resetAllData()
    expect(events).toHaveLength(0)
  })
})

void makeInput

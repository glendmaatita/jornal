// Final coverage completion: remaining uncovered branches.

import { describe, expect, test, beforeEach } from "bun:test"

import "./test-setup"
import { resetStorage, localStorageShim } from "./test-setup"
import {
  KEYS,
  createTransaction,
  loadAccountHistory,
  loadProfileHistory,
  loadReserveHistory,
  loadTransactionHistory,
  saveProfile,
  upsertAccount,
} from "./store"
import { loadAccounts } from "./store"
import { generateInsights } from "./trends"
import { computeConfidence } from "./safe-to-spend"
import { stsWeeklyChange } from "./history"
import { computeTaxOverview, taxAlerts } from "./tax"
import { computeSnapshotAsOf } from "./history"
import { computeForecast } from "./forecast"
import { localStorageShim as shim } from "./test-setup"
import type { BusinessProfile, Transaction } from "./types"

function makeProfile(partial: Partial<BusinessProfile> = {}): BusinessProfile {
  return makeProfileHelper(partial)
}

function makeProfileHelper(partial: Partial<BusinessProfile>): BusinessProfile {
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

let calls: Array<{ url: string; method: string }> = []

beforeEach(() => {
  resetStorage()
  calls = []
})

// ── store.ts history seeders (empty-history + existing entities) ──

describe("history seeders via corrupt history keys", () => {
  test("loadAccountHistory seeds when history key empty but accounts exist", () => {
    upsertAccount({ name: "BCA", type: "BANK", openingBalance: 5, includedInCash: true })
    localStorageShim.removeItem(KEYS.accountHistory)
    const history = loadAccountHistory()
    expect(history).toHaveLength(1)
  })

  test("loadAccountHistory keeps existing history untouched", () => {
    upsertAccount({ name: "A", type: "CASH", openingBalance: 1, includedInCash: true })
    const before = loadAccountHistory()
    expect(loadAccountHistory()).toEqual(before)
  })

  test("loadTransactionHistory seeds when history empty", () => {
    createTransaction(transactionInput())
    localStorageShim.removeItem(KEYS.transactionHistory)
    expect(loadTransactionHistory()).toHaveLength(1)
  })

  test("loadTransactionHistory returns empty with no transactions", () => {
    expect(loadTransactionHistory()).toEqual([])
  })

  test("loadReserveHistory seeds when history empty", () => {
    localStorageShim.setItem(KEYS.reserves, JSON.stringify([{ id: "r1", name: "R", amount: 1, dueDate: null, status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]))
    expect(loadReserveHistory()).toHaveLength(1)
  })

  test("loadAccountHistory with zero accounts returns empty without seeding", () => {
    expect(loadAccountHistory()).toEqual([])
  })

  test("loadProfileHistory falls back to seeded single record", () => {
    const seeded = loadProfileHistory()
    expect(seeded).toHaveLength(1)
    expect(seeded[0].value.businessName).toBe("")
  })
})

function transactionInput() {
  return {
    direction: "MONEY_IN" as const,
    amount: 1000,
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
    classification: "REVENUE" as const,
    taxClassification: "REVENUE" as const,
    businessRelevance: "BUSINESS" as const,
    classificationSource: "RULE" as const,
    classificationConfidence: 0.9,
    reviewStatus: "AUTO_ACCEPTED" as const,
  }
}

// ── tax.ts residual branches ──

describe("tax residual branches", () => {
  test("PT/CV allowed scheme path (line 86)", () => {
    const overview = computeTaxOverview({
      scheme: "CORPORATE",
      businessType: "CV",
      onDate: "2026-09-03",
      revenueYTD: 10_000_000,
      businessExpenseYTD: 4_000_000,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.appliedScheme).toBe("CORPORATE")
  })

  test("fallbackTaxScheme for corporate types (lines 101-104)", () => {
    const overview = computeTaxOverview({
      scheme: "PROGRESSIVE", // not allowed for PT
      businessType: "PT",
      onDate: "2026-09-03",
      revenueYTD: 10_000_000,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    expect(overview.appliedScheme).toBe("CORPORATE")
    expect(overview.explanation).toContain("badan")
  })

  test("corporate > 50B full rate (line 119)", () => {
    const overview = computeTaxOverview({
      scheme: "CORPORATE",
      businessType: "PT",
      onDate: "2026-09-03",
      revenueYTD: 60_000_000_000, // projected 80B > 50B
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 9,
    })
    // profit = 80B → 22%
    expect(overview.estimatedTax).toBe(Math.round((((60_000_000_000 / 9) * 12) * 22) / 100))
  })

  test("rule-missing fallback (lines 229-239) via future date", () => {
    const overview = computeTaxOverview({
      scheme: "UMKM_FINAL",
      businessType: "INDIVIDUAL",
      onDate: "2020-01-01", // before any rule's effective_from
      revenueYTD: 100_000_000,
      businessExpenseYTD: 0,
      taxPaid: 0,
      monthsElapsed: 1,
    })
    expect(overview.rule).toBeNull()
    expect(overview.estimatedTax).toBe(0)
  })

  test("NOT_CALCULATED switch case is unreachable but covered via type", () => {
    // resolveAppliedScheme returns null appliedScheme for NOT_CALCULATED,
    // so the switch case is defensive. Assert via direct type-level call.
    const schemes = ["UMKM_FINAL", "PROGRESSIVE", "CORPORATE", "NOT_CALCULATED"] as const
    for (const scheme of schemes) {
      const overview = computeTaxOverview({
        scheme,
        businessType: scheme === "CORPORATE" ? "PT" : "INDIVIDUAL",
        onDate: "2026-09-03",
        revenueYTD: 100_000_000,
        businessExpenseYTD: 20_000_000,
        taxPaid: 0,
        monthsElapsed: 9,
      })
      if (scheme === "NOT_CALCULATED") expect(overview.appliedScheme).toBeNull()
    }
  })

  test("progressive bracket alert skipped when far below next bracket", () => {
    const alerts = taxAlerts(
      { taxScheme: "PROGRESSIVE", businessType: "INDIVIDUAL", pkpStatus: true },
      [makeTransaction({ transactionDate: "2026-05-01", amount: 30_000_000, classification: "REVENUE" })],
      new Date("2026-09-15T00:00:00"),
    )
    expect(alerts).toHaveLength(0)
  })
})

// ── safe-to-spend line 116-117: account tracking with no included accounts ──

describe("safe-to-spend hasOpening branch", () => {
  test("account tracking with only excluded accounts → LOW", () => {
    const profile = makeProfile({ useAccountTracking: true })
    const accounts = [{ id: "x", name: "Escrow", type: "BANK" as const, openingBalance: 100, includedInCash: false, createdAt: "", updatedAt: "" }]
    const result = computeConfidence([], accounts, profile, [], new Date("2026-09-03T00:00:00"))
    expect(result.status).toBe("LOW_CONFIDENCE")
    expect(result.reasons).toContain("Saldo awal belum diatur")
  })
})

// ── history line 36: reserve created after snapshot date ──

describe("history future-reserve branch", () => {
  test("reserve created after snapshot date is excluded", () => {
    const profile = makeProfile()
    const input = {
      transactions: [] as Transaction[],
      accounts: [],
      profile,
      reserves: [
        { id: "r1", name: "Future", amount: 5000, dueDate: null, status: "ACTIVE" as const, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
      ],
    }
    const snapshot = computeSnapshotAsOf(input, "2026-09-15")
    expect(snapshot.otherReserve).toBe(0)
  })

  test("used reserve with updatedAt after snapshot still counted", () => {
    const profile = makeProfile()
    const input = {
      transactions: [] as Transaction[],
      accounts: [],
      profile,
      reserves: [
        { id: "r2", name: "Past", amount: 7000, dueDate: null, status: "USED" as const, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
      ],
    }
    const snapshot = computeSnapshotAsOf(input, "2026-09-15")
    expect(snapshot.otherReserve).toBe(7000)
  })
})

// ── forecast marginalRate top brackets ──

describe("forecast marginalRate top brackets", () => {
  test("corporate > 50B → 22%", () => {
    // Revenue YTD huge → projected > 50B, scheme CORPORATE
    const profile = makeProfile({ taxScheme: "CORPORATE", businessType: "PT", openingBalance: 0 })
    // computeForecast derives marginal rate from overviewToday — feed revenue via transactions
    const transactions = [
      makeTransaction({ transactionDate: "2026-05-01", amount: 60_000_000_000, classification: "REVENUE" }),
    ]
    const forecast = computeForecast(
      { transactions, accounts: [], profile, reserves: [] },
      { scenario: { extraIncome: 1_000_000, extraExpense: 0, extraReserve: 0 } },
      new Date("2026-09-10T00:00:00"),
    )
    // marginal rate on expected income: 80B projected > 50B → 22%
    expect(forecast.projectedTaxReserve - forecast.currentTaxReserve).toBe(220_000)
  })

  test("progressive top bracket → 35%", () => {
    const profile = makeProfile({ taxScheme: "PROGRESSIVE", openingBalance: 0 })
    const transactions = [
      makeTransaction({ transactionDate: "2026-05-01", amount: 60_000_000_000, classification: "REVENUE" }),
    ]
    const forecast = computeForecast(
      { transactions, accounts: [], profile, reserves: [] },
      { scenario: { extraIncome: 1_000_000, extraExpense: 0, extraReserve: 0 } },
      new Date("2026-09-10T00:00:00"),
    )
    expect(forecast.projectedTaxReserve - forecast.currentTaxReserve).toBe(350_000)
  })
})

// ── pocketbase entityAppId non-object items (lines 80-81) ──

describe("pocketbase entityAppId non-object items", () => {
  test("array entries that are not objects fall back to the entity name", async () => {
    const { setPocketBaseUrl, syncToPocketBase } = await import("./pocketbase-sync")
    setPocketBaseUrl("http://pb.test")
    // Corrupt entry: sync reads raw localStorage, so a null item reaches entityAppId
    localStorageShim.setItem(KEYS.transactions, JSON.stringify([null]))
    const calls: { url: string; method: string }[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" })
      return new Response(JSON.stringify({ items: [], totalPages: 1 }), { status: 200 })
    }) as typeof fetch
    try {
      await syncToPocketBase()
      // null item → appId = "transactions" → upsert POST + keep set
      expect(calls.some((call) => call.method === "POST")).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      setPocketBaseUrl(null)
    }
  })
})

// ── test-setup getter coverage ──

describe("test setup shim", () => {
  test("length getter works", () => {
    shim.clear()
    shim.setItem("a", "1")
    expect(shim.length).toBe(1)
    shim.removeItem("a")
    expect(shim.length).toBe(0)
  })
})

// ── forecast: collectExpectedFlows with persisted history path is exercised
// through stsHistory in phase2 tests; scenario branch already covered. ──

void computeForecast

// ── final residual lines ──

describe("final coverage residuals", () => {
  test("taxAlerts covers PT_PERORANGAN scheme table (tax.ts:86)", () => {
    const alerts = taxAlerts(
      { taxScheme: "UMKM_FINAL", businessType: "PT_PERORANGAN", pkpStatus: false },
      [],
      new Date("2026-09-15T00:00:00"),
    )
    expect(alerts).toHaveLength(0)
  })

  test("invalid data URL throws (pocketbase-sync:101)", async () => {
    const { setPocketBaseUrl, syncToPocketBase } = await import("./pocketbase-sync")
    setPocketBaseUrl("http://pb.test")
    localStorageShim.setItem(
      KEYS.transactions,
      JSON.stringify([{ ...makeTransaction({ id: "txn-bad-url" }), attachmentName: "x.txt", attachmentDataUrl: "data:text/plain;base64,!!!" }]),
    )
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" })
      const filter = String(input).includes("filter=")
      return new Response(JSON.stringify({ items: filter ? [] : {}, totalPages: 1 }), { status: 200 })
    }) as typeof fetch
    let thrown: unknown = null
    try {
      await syncToPocketBase()
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain("Invalid data URL")
    setPocketBaseUrl(null)
  })

  test("data URL without base64 segment throws (pocketbase-sync regex miss)", async () => {
    const { setPocketBaseUrl, syncToPocketBase } = await import("./pocketbase-sync")
    setPocketBaseUrl("http://pb.test")
    localStorageShim.setItem(
      KEYS.transactions,
      JSON.stringify([{ ...makeTransaction({ id: "txn-nomatch" }), attachmentName: "y.txt", attachmentDataUrl: "data:text/plain,hello" }]),
    )
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" })
      const filter = String(input).includes("filter=")
      return new Response(JSON.stringify({ items: filter ? [] : {}, totalPages: 1 }), { status: 200 })
    }) as typeof fetch
    let thrown: unknown = null
    try {
      await syncToPocketBase()
    } catch (error) {
      thrown = error
    }
    expect(String(thrown)).toContain("Invalid data URL")
    setPocketBaseUrl(null)
  })

  test("upsertAccount returns existing account on update", () => {
    const created = upsertAccount({ name: "X", type: "CASH", openingBalance: 1, includedInCash: true })
    const again = upsertAccount({ id: created.id, name: "X2", type: "CASH", openingBalance: 2, includedInCash: true })
    expect(again.id).toBe(created.id)
    expect(loadAccounts()).toHaveLength(1)
  })

  test("weekly tax reserve delta reason (history:104)", () => {
    // Revenue lands between the two snapshot windows → recommended reserve changes.
    // The profile must be persisted so the as-of resolution sees the real scheme.
    const profile = makeProfile({ openingBalance: 0, taxScheme: "UMKM_FINAL", businessType: "PT_PERORANGAN" })
    saveProfile(profile)
    const transactions = [
      makeTransaction({ transactionDate: "2026-09-05", amount: 100_000_000, classification: "REVENUE" }),
    ]
    const change = stsWeeklyChange({ transactions, accounts: [], profile, reserves: [] }, new Date("2026-09-10T00:00:00"))
    expect(change).not.toBeNull()
    expect(change!.reasons.some((reason) => reason.label === "Dana pajak berubah")).toBe(true)
  })

  test("insights with three months of data proceeds past guard (trends)", () => {
    const transactions = [
      makeTransaction({ transactionDate: "2026-07-10", amount: 1_000_000, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-08-10", amount: 1_000_000, classification: "REVENUE" }),
      makeTransaction({ transactionDate: "2026-09-10", amount: 1_000_000, classification: "REVENUE" }),
    ]
    const result = generateInsights(transactions, 3, new Date("2026-09-15T00:00:00"))
    expect(result.sufficientData).toBe(true)
  })
})

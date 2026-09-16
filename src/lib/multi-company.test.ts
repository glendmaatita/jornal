import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import "./test-setup"
import { localStorageShim, resetStorage } from "./test-setup"
import { computeCashPosition } from "./safe-to-spend"
import { processRecurringRulesForScope } from "./recurring-scheduler"
import { hydrateFromPocketBase, resetPocketBaseSyncState, setPocketBaseUrl } from "./pocketbase-sync"
import { migrateLegacyCompanyData } from "./companies"
import {
  createTransaction,
  createRecurringRule,
  emptyProfile,
  exportLocalData,
  importLocalData,
  loadAccounts,
  loadTransactions,
  saveAccounts,
  saveProfile,
  setCompanyDisplayName,
  setCompanyLegacyDefault,
  setCompanyScope,
  setCompanyWritable,
  setTenantScope,
  setDataScope,
  getCompanyScope,
  KEYS,
  RESET_PENDING_KEY,
  storageKeyForScope,
} from "./store"
import type { Company, NewTransaction } from "./types"

function transaction(description: string, accountId: string | null = null): NewTransaction {
  return {
    companyId: undefined,
    direction: "MONEY_IN",
    amount: 100_000,
    currency: "IDR",
    transactionDate: "2026-09-16",
    description,
    notes: "",
    categoryId: null,
    paymentMethod: "Transfer",
    supplierCustomer: "",
    tags: "",
    accountId,
    transferAccountId: null,
    attachmentName: null,
    attachmentDataUrl: null,
    receivableTransactionId: null,
    receivableDueDate: null,
    classification: "REVENUE",
    taxClassification: "REVENUE",
    businessRelevance: "BUSINESS",
    classificationSource: "USER",
    classificationConfidence: 1,
    reviewStatus: "ACCEPTED",
  }
}

function activate(companyId: string, writable = true, legacy = false) {
  setTenantScope("tenant-1")
  setCompanyScope(companyId, 1)
  setCompanyDisplayName(companyId)
  setCompanyWritable(writable)
  setCompanyLegacyDefault(legacy)
}

describe("multi-company local isolation", () => {
  beforeEach(() => {
    resetStorage()
    setPocketBaseUrl("")
    activate("company-a", true, true)
  })

  afterEach(() => {
    setPocketBaseUrl("")
    setDataScope("local")
    setCompanyWritable(true)
    resetStorage()
  })

  test("keeps accounts and transactions in independent namespaces", () => {
    saveAccounts([{ id: "account-a", name: "A", type: "BANK", openingBalance: 1_000_000, includedInCash: true, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z" }])
    const a = createTransaction(transaction("A", "account-a"))

    activate("company-b")
    expect(loadAccounts()).toEqual([])
    expect(loadTransactions()).toEqual([])
    const b = createTransaction(transaction("B"))

    activate("company-a", true, true)
    expect(loadTransactions().map((item) => item.id)).toEqual([a.id])
    expect(loadTransactions()[0]?.companyId).toBe("company-a")
    expect(b.companyId).toBe("company-b")
  })

  test("blocks every store mutation while archived", () => {
    activate("company-a", false, true)
    expect(() => createTransaction(transaction("blocked"))).toThrow("diarsipkan")
    expect(() => saveProfile(emptyProfile())).toThrow("diarsipkan")
  })

  test("rejects mixed-company financial input", () => {
    const profileA = { ...emptyProfile(), companyId: "company-a", useAccountTracking: false }
    const a = createTransaction(transaction("A"))
    activate("company-b")
    const b = createTransaction(transaction("B"))
    expect(() => computeCashPosition([a, b], [], profileA)).toThrow("beberapa company")
  })

  test("backup restore rejects foreign references and v1 on non-legacy company", () => {
    saveAccounts([{ id: "account-a", name: "A", type: "BANK", openingBalance: 0, includedInCash: true, createdAt: "2026-09-16T00:00:00Z", updatedAt: "2026-09-16T00:00:00Z" }])
    createTransaction(transaction("A", "account-a"))
    const backup = exportLocalData()
    const broken = structuredClone(backup)
    broken.data["jornal.accounts.v1"] = []
    expect(() => importLocalData(broken)).toThrow("accountId")

    activate("company-b", true, false)
    expect(() => importLocalData({ ...backup, version: 1, scope: "tenant-1" })).toThrow("ruang data lain")
  })

  test("legacy migration is repeatable and preserves its recovery source", async () => {
    const company: Company = {
      id: "company-a", tenantId: "tenant-1", name: "Legacy", status: "ACTIVE",
      onboardingCompletedAt: "2026-09-16T00:00:00.000Z", legacyDefault: true,
      dataEpoch: 1, revision: 1, archivedAt: null, createdAt: "", updatedAt: "",
    }
    const oldTransactionsKey = `jornal.tenant-1.${KEYS.transactions}`
    const oldDraftKey = "jornal.tenant-1.jornal.transaction-draft.add"
    const oldPreferenceKey = "jornal.tenant-1.jornal.entry-default.MONEY_IN.v1"
    const oldResetKey = `jornal.tenant-1.${RESET_PENDING_KEY}`
    localStorageShim.setItem(oldTransactionsKey, JSON.stringify([{ id: "legacy-txn" }]))
    localStorageShim.setItem(oldDraftKey, JSON.stringify({ description: "belum selesai" }))
    localStorageShim.setItem(oldPreferenceKey, "account-a")
    localStorageShim.setItem(oldResetKey, "2026-09-16T00:00:00.000Z")

    await migrateLegacyCompanyData(company)
    await migrateLegacyCompanyData(company)

    expect(JSON.parse(localStorageShim.getItem(storageKeyForScope(getCompanyScope(), KEYS.transactions)) ?? "[]")).toEqual([{ id: "legacy-txn" }])
    expect(JSON.parse(localStorageShim.getItem("jornal.v2.tenant-1.company-a.jornal.transaction-draft.add") ?? "{}").description).toBe("belum selesai")
    expect(localStorageShim.getItem("jornal.v2.tenant-1.company-a.jornal.entry-default.MONEY_IN.v1")).toBe("account-a")
    expect(localStorageShim.getItem(storageKeyForScope(getCompanyScope(), RESET_PENDING_KEY))).toBe("2026-09-16T00:00:00.000Z")
    expect(localStorageShim.getItem(oldTransactionsKey)).not.toBeNull()
    expect(localStorageShim.getItem(oldDraftKey)).not.toBeNull()
  })

  test("recurring occurrence is deterministic per company and date", async () => {
    createRecurringRule({
      direction: "MONEY_OUT", description: "Sewa", amount: 200_000, categoryId: null,
      classification: "OPERATING_EXPENSE", paymentMethod: "Transfer", accountId: null,
      dayOfMonth: 16, nextRun: "2026-09-16", autoCreate: true,
    })
    const scope = getCompanyScope()
    await processRecurringRulesForScope(scope, "2026-09-16")
    await processRecurringRulesForScope(scope, "2026-09-16")
    expect(loadTransactions()).toHaveLength(1)
    expect(loadTransactions()[0]?.id).toContain("recurring-")
    expect(loadTransactions()[0]?.companyId).toBe("company-a")
  })

  test("a delayed response keeps writing to its captured company", async () => {
    const scopeA = getCompanyScope()
    const scopeB = { tenantId: "tenant-1", companyId: "company-b", dataEpoch: 1 }
    const profileB = { ...emptyProfile(), companyId: "company-b", businessName: "B" }
    localStorageShim.setItem(storageKeyForScope(scopeB, KEYS.profile), JSON.stringify(profileB))
    setPocketBaseUrl("http://pb.test")
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    let returnedProfile = false
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (!returnedProfile && url.includes("/jornal_records/records?")) {
        returnedProfile = true
        await gate
        return new Response(JSON.stringify({ items: [{ id: "remote-a", entity: "profile", app_id: "profile", business_id: "tenant-1", company_id: "company-a", data_epoch: 1, payload: { ...emptyProfile(), companyId: "company-a", businessName: "A remote" }, created: "", updated: "", revision: 1 }], totalPages: 1 }), { status: 200 })
      }
      if (url.includes("/api/files/token")) return new Response(JSON.stringify({ token: "" }), { status: 200 })
      return new Response(JSON.stringify({ items: [], totalPages: 1 }), { status: 200 })
    }) as typeof fetch
    try {
      const hydration = hydrateFromPocketBase(scopeA)
      await Promise.resolve()
      activate("company-b")
      release?.()
      await hydration
      expect(JSON.parse(localStorageShim.getItem(storageKeyForScope(scopeA, KEYS.profile)) ?? "{}").businessName).toBe("A remote")
      expect(JSON.parse(localStorageShim.getItem(storageKeyForScope(scopeB, KEYS.profile)) ?? "{}").businessName).toBe("B")
    } finally {
      globalThis.fetch = originalFetch
      setPocketBaseUrl("")
    }
  })

  test("logout cancels delayed hydration before it can write local state", async () => {
    const scopeA = getCompanyScope()
    setPocketBaseUrl("http://pb.test")
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/api/files/token")) return new Response(JSON.stringify({ token: "" }), { status: 200 })
      await gate
      return new Response(JSON.stringify({
        items: [{ id: "remote-a", entity: "profile", app_id: "profile", business_id: "tenant-1", company_id: "company-a", data_epoch: 1, payload: { ...emptyProfile(), companyId: "company-a", businessName: "Must not persist" }, created: "", updated: "", revision: 1 }],
        totalPages: 1,
      }), { status: 200 })
    }) as typeof fetch
    try {
      const hydration = hydrateFromPocketBase(scopeA)
      await Promise.resolve()
      resetPocketBaseSyncState()
      release?.()
      await expect(hydration).rejects.toThrow("Hydration cancelled")
      expect(localStorageShim.getItem(storageKeyForScope(scopeA, KEYS.profile))).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
      setPocketBaseUrl("")
    }
  })
})

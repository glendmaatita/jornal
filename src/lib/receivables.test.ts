import { describe, expect, test } from "bun:test"

import "./test-setup"
import { receivablesFromTransactions } from "./receivables"
import { computeCashPosition } from "./safe-to-spend"
import { emptyProfile } from "./store"
import { computeTaxOverviewAsOf } from "./tax"
import type { Transaction } from "./types"

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: "loan-1", businessId: "business", direction: "MONEY_OUT", amount: 1_000_000, currency: "IDR",
    transactionDate: "2026-09-01", description: "Pinjaman", notes: "", categoryId: null, paymentMethod: "Transfer",
    supplierCustomer: "Dina", tags: "", accountId: null, transferAccountId: null, attachmentName: null,
    attachmentDataUrl: null, classification: "RECEIVABLE_CREATED", taxClassification: "RECEIVABLE_CREATED",
    businessRelevance: "NON_BUSINESS", classificationSource: "USER", classificationConfidence: 1,
    reviewStatus: "AUTO_ACCEPTED", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    receivableTransactionId: null, receivableDueDate: null, ...overrides,
  }
}

describe("receivablesFromTransactions", () => {
  test("derives the remaining balance from linked repayments", () => {
    const result = receivablesFromTransactions([
      transaction({ receivableDueDate: "2026-09-15" }),
      transaction({ id: "repayment-1", direction: "MONEY_IN", amount: 400_000, classification: "RECEIVABLE_PAYMENT", taxClassification: "RECEIVABLE_PAYMENT", receivableTransactionId: "loan-1" }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ paid: 400_000, outstanding: 600_000 })
  })

  test("moves cash but never turns principal into revenue or expense", () => {
    const profile = { ...emptyProfile(), businessId: "business", companyId: "company-a", openingBalance: 2_000_000, taxScheme: "UMKM_FINAL" as const }
    const transactions = [
      transaction({ companyId: "company-a" }),
      transaction({ id: "repayment-1", companyId: "company-a", direction: "MONEY_IN", amount: 400_000, classification: "RECEIVABLE_PAYMENT", taxClassification: "RECEIVABLE_PAYMENT", receivableTransactionId: "loan-1" }),
    ]
    expect(computeCashPosition(transactions, [], profile)).toBe(1_400_000)
    const tax = computeTaxOverviewAsOf(profile, transactions, "2026-09-30")
    expect(tax.revenueYTD).toBe(0)
    expect(tax.estimatedTax).toBe(0)
  })
})

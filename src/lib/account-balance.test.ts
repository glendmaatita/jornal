import { describe, expect, test } from "bun:test"

import { currentAccountBalance } from "./account-balance"
import type { Account, Transaction } from "./types"

const account: Account = {
  id: "bca", name: "BCA", type: "BANK", openingBalance: 1_000, includedInCash: true, createdAt: "", updatedAt: "",
}

function transaction(patch: Partial<Transaction>): Transaction {
  return {
    id: crypto.randomUUID(), businessId: "business", direction: "MONEY_IN", amount: 0, currency: "IDR", transactionDate: "2026-09-16",
    description: "", notes: "", categoryId: null, paymentMethod: "", supplierCustomer: "", tags: "", accountId: "bca", transferAccountId: null,
    attachmentName: null, attachmentDataUrl: null, classification: "OTHER_INCOME", taxClassification: "OTHER_INCOME", businessRelevance: "BUSINESS",
    classificationSource: "USER", classificationConfidence: null, reviewStatus: "ACCEPTED", createdAt: "", updatedAt: "", ...patch,
  }
}

describe("currentAccountBalance", () => {
  test("excludes scheduled future entries while retaining completed transfers", () => {
    const transactions = [
      transaction({ amount: 500 }),
      transaction({ direction: "MONEY_OUT", amount: 200 }),
      transaction({ direction: "MONEY_OUT", amount: 300, accountId: "cash", transferAccountId: "bca" }),
      transaction({ amount: 9_999, transactionDate: "2026-09-17" }),
    ]

    expect(currentAccountBalance(account, transactions, "2026-09-16")).toBe(1_600)
  })
})

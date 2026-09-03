import type { Transaction } from "./types"

export function makeRecurringTransactions(description: string, amounts: number[]): Transaction[] {
  return amounts.map((amount, index) => ({
    id: crypto.randomUUID(),
    businessId: "local",
    direction: "MONEY_OUT",
    amount,
    currency: "IDR",
    transactionDate: `2026-${String(index + 6).padStart(2, "0")}-05`,
    description,
    notes: "",
    categoryId: "exp-software",
    paymentMethod: "",
    supplierCustomer: "",
    tags: "",
    accountId: null,
    transferAccountId: null,
    attachmentName: null,
    attachmentDataUrl: null,
    classification: "OPERATING_EXPENSE",
    taxClassification: "OPERATING_EXPENSE",
    businessRelevance: "BUSINESS",
    classificationSource: "RULE",
    classificationConfidence: 1,
    reviewStatus: "ACCEPTED",
    createdAt: "2026-09-03T00:00:00Z",
    updatedAt: "2026-09-03T00:00:00Z",
  }))
}

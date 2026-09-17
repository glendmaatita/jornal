import { describe, expect, test } from "bun:test"
import { transactionRevenueAmount } from "./transaction-revenue"

describe("transactionRevenueAmount", () => {
  test("keeps gross cash but excludes separately collected invoice tax from revenue", () => {
    expect(transactionRevenueAmount({ amount: 110_000, classification: "REVENUE", invoiceRevenueAmount: 100_000 })).toBe(100_000)
  })
  test("preserves legacy revenue and excludes non-revenue", () => {
    expect(transactionRevenueAmount({ amount: 75_000, classification: "REVENUE" })).toBe(75_000)
    expect(transactionRevenueAmount({ amount: 75_000, classification: "OPERATING_EXPENSE" })).toBe(0)
  })
})

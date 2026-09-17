import { describe, expect, test } from "bun:test"
import { InvoiceValidationError, calculateInvoiceTotals, divideRoundHalfUp } from "./invoice-math"

const item = (overrides: Partial<{ quantityScaled: number; unitPrice: number; unitLabel: string; description: string; sortOrder: number }> = {}) => ({
  description: "Jasa desain",
  quantityScaled: 1_000,
  unitLabel: "pcs",
  unitPrice: 100_000,
  sortOrder: 0,
  ...overrides,
})

describe("invoice math", () => {
  test("does not convert commercial units", () => {
    const result = calculateInvoiceTotals([item({ quantityScaled: 2_000, unitLabel: "Lusin" })], 0, 0, 0)
    expect(result.items[0].lineTotal).toBe(200_000)
    expect(result.totals.grandTotal).toBe(200_000)
  })

  test("rounds item and tax values half-up with integer arithmetic", () => {
    expect(divideRoundHalfUp(1_500, 1_000)).toBe(2)
    const result = calculateInvoiceTotals([item({ quantityScaled: 1, unitPrice: 1_500 })], 0, 0, 1_000)
    expect(result.items[0].lineTotal).toBe(2)
    expect(result.totals.taxAmount).toBe(0)
    expect(result.totals.grandTotal).toBe(2)
  })

  test("calculates discount, shipping, and tax consistently", () => {
    const result = calculateInvoiceTotals([item({ unitPrice: 100_000 })], 10_000, 5_000, 1_000)
    expect(result.totals).toEqual({ subtotal: 100_000, baseAmount: 95_000, taxAmount: 9_500, grandTotal: 104_500 })
  })

  test("rejects invalid or overflowing values", () => {
    expect(() => calculateInvoiceTotals([], 0, 0, 0)).toThrow(InvoiceValidationError)
    expect(() => calculateInvoiceTotals([item({ quantityScaled: 0 })], 0, 0, 0)).toThrow(InvoiceValidationError)
    expect(() => calculateInvoiceTotals([item()], 100_001, 0, 0)).toThrow(InvoiceValidationError)
    expect(() => calculateInvoiceTotals([item()], 0, 0, 10_001)).toThrow(InvoiceValidationError)
  })
})

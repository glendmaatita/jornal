import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

const sandbox = { module: { exports: {} }, ApiError: class extends Error { constructor(_status: number, message: string) { super(message) } } }
runInNewContext(readFileSync(new URL("../pb_hooks/invoice_helpers.js", import.meta.url), "utf8"), sandbox)
const helpers = sandbox.module.exports as {
  proportionalAmount: (a: number, b: number, divisor: number) => number
  calculateInvoice: (body: unknown) => { grandTotal: number }
}
const taxSandbox = { module: { exports: {} }, ApiError: sandbox.ApiError }
runInNewContext(readFileSync(new URL("../pb_hooks/tax_helpers.js", import.meta.url), "utf8"), taxSandbox)
const taxHelpers = taxSandbox.module.exports as { nonNegativeMoney: (value: unknown, label: string, nullable?: boolean) => number | null }

describe("invoice numeric accuracy", () => {
  test("tax money distinguishes an unknown amount from a confirmed zero", () => {
    expect(taxHelpers.nonNegativeMoney(null, "amount", true)).toBeNull()
    expect(taxHelpers.nonNegativeMoney(0, "amount")).toBe(0)
    for (const value of [null, false, "", NaN]) expect(() => taxHelpers.nonNegativeMoney(value, "amount")).toThrow("non-negative integer")
  })
  test("large partial payment tax rounds exactly at the half-rupiah boundary", () => {
    expect(helpers.proportionalAmount(30_046_546_950, 78_972_351_128, 717_930_464_800)).toBe(3_305_120_165)
  })
  test("proportions match independent BigInt arithmetic across the invoice range", () => {
    let seed = 123456789
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
    for (let index = 0; index < 1000; index++) {
      const total = 1 + random() * 200
      const tax = Math.floor(total * 0.11)
      const paid = Math.floor(random() / 4294967296 * total)
      const expected = Number((BigInt(paid) * BigInt(tax) + BigInt(Math.floor(total / 2))) / BigInt(total))
      expect(helpers.proportionalAmount(paid, tax, total)).toBe(expected)
      expect(helpers.proportionalAmount(total, tax, total)).toBe(tax)
    }
  })
  test("rejects null and boolean invoice amounts instead of coercing them to zero", () => {
    const body = { items: [{ id: "item", description: "Service", unitLabel: "pcs", quantityScaled: 1000, unitPrice: 1000, sortOrder: 0 }], discountAmount: 0, shippingAmount: 0, taxRateBps: 0 }
    expect(helpers.calculateInvoice(body).grandTotal).toBe(1000)
    for (const field of ["discountAmount", "shippingAmount", "taxRateBps"]) {
      for (const value of [null, false, NaN, ""]) expect(() => helpers.calculateInvoice({ ...body, [field]: value })).toThrow("tidak valid")
    }
  })
})

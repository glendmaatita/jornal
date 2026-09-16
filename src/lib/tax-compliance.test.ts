import { describe, expect, test } from "bun:test"
import {
  computeConfirmedBalance,
  computeUmkmMonthlyLiability,
  dueState,
  mayFulfillFilingByValidatedPayment,
  periodYear,
} from "./tax-compliance"

describe("tax compliance amounts", () => {
  test("individual allowance is applied cumulatively across the threshold month", () => {
    expect(computeUmkmMonthlyLiability({
      subjectType: "INDIVIDUAL", eligible: true, dataComplete: true,
      cumulativeRevenueBefore: 490_000_000, currentMonthRevenue: 30_000_000,
    })).toMatchObject({ taxableBase: 20_000_000, liabilityAmount: 100_000, remainingPayable: 100_000, paymentStatus: "UNPAID" })
  })

  test("entity has no individual allowance", () => {
    expect(computeUmkmMonthlyLiability({
      subjectType: "ENTITY", eligible: true, dataComplete: true,
      cumulativeRevenueBefore: 0, currentMonthRevenue: 80_000_000,
    })).toMatchObject({ taxableBase: 80_000_000, liabilityAmount: 400_000 })
  })

  test("missing data is unknown rather than zero", () => {
    expect(computeUmkmMonthlyLiability({
      subjectType: "INDIVIDUAL", eligible: true, dataComplete: false,
      cumulativeRevenueBefore: 0, currentMonthRevenue: 0,
    })).toMatchObject({ amountState: "UNKNOWN", liabilityAmount: null, remainingPayable: null, paymentStatus: "UNKNOWN" })
  })

  test("partial and annual confirmed balances are exact", () => {
    expect(computeConfirmedBalance(100_000, 40_000)).toEqual({ remainingPayable: 60_000, overpaidAmount: 0, paymentStatus: "PARTIAL" })
    expect(computeConfirmedBalance(20_000_000, 17_000_000)).toEqual({ remainingPayable: 3_000_000, overpaidAmount: 0, paymentStatus: "PARTIAL" })
  })

  test("validated payment fulfills filing only for supported kinds", () => {
    expect(mayFulfillFilingByValidatedPayment("PPH_FINAL_UMKM", true)).toBe("FULFILLED_BY_PAYMENT")
    expect(mayFulfillFilingByValidatedPayment("PPH_25", true)).toBe("FULFILLED_BY_PAYMENT")
    expect(mayFulfillFilingByValidatedPayment("PPH_21_26_PAYROLL", true)).toBe("PENDING")
  })
})

describe("tax period helpers", () => {
  test("validate periods and due state", () => {
    expect(periodYear("2026-09")).toBe(2026)
    expect(periodYear("2026")).toBe(2026)
    expect(() => periodYear("2026-13")).toThrow()
    expect(dueState("2026-09-15", "2026-09-15")).toBe("DUE_TODAY")
    expect(dueState("2026-09-15", "2026-09-16")).toBe("OVERDUE")
  })
})

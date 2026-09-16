import { describe, expect, test } from "bun:test"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rules = require("../pb_hooks/tax_rules.js") as {
  ruleByKindAt: (kind: string, date: string) => { id: string; version: string } | null
  computeUmkm: (input: Record<string, unknown>) => { taxableBase: number | null; liabilityAmount: number | null; amountState: string }
  dueDate: (code: string, period: string, fiscalYearEnd: string, linkedFilingDueDate?: string) => string | null
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const jobs = require("../pb_hooks/tax_jobs.js") as {
  taxScheduledAt: (date: string, hour: number, timezone: string) => string
}

describe("canonical backend tax rules", () => {
  test("snapshots the UMKM rule version around the 2026 transition", () => {
    expect(rules.ruleByKindAt("PPH_FINAL_UMKM", "2026-04-21")?.id).toBe("PPH_FINAL_UMKM_PP55_2022")
    expect(rules.ruleByKindAt("PPH_FINAL_UMKM", "2026-04-22")?.id).toBe("PPH_FINAL_UMKM_PP20_2026")
  })

  test("applies the individual allowance once to cumulative actual revenue", () => {
    expect(rules.computeUmkm({ subjectType: "INDIVIDUAL", eligible: true, dataComplete: true, cumulativeRevenueBefore: 490_000_000, currentMonthRevenue: 30_000_000 }))
      .toMatchObject({ taxableBase: 20_000_000, liabilityAmount: 100_000, amountState: "CONFIRMED" })
    expect(rules.computeUmkm({ subjectType: "ENTITY", eligible: true, dataComplete: true, cumulativeRevenueBefore: 0, currentMonthRevenue: 80_000_000 }))
      .toMatchObject({ taxableBase: 80_000_000, liabilityAmount: 400_000 })
  })

  test("handles leap years, year boundaries, and non-calendar fiscal years", () => {
    expect(rules.dueDate("END_NEXT_MONTH", "2028-01", "2028-12-31")).toBe("2028-02-29")
    expect(rules.dueDate("DAY_15", "2026-12", "2026-12-31")).toBe("2027-01-15")
    expect(rules.dueDate("FY_PLUS_3", "2026", "2026-06-30")).toBe("2026-09-30")
    expect(rules.dueDate("FY_PLUS_4", "2026", "2026-06-30")).toBe("2026-10-30")
  })

  test("schedules the same local hour correctly in WIB, WITA, and WIT", () => {
    expect(jobs.taxScheduledAt("2026-03-31", 9, "Asia/Jakarta")).toBe("2026-03-31T02:00:00.000Z")
    expect(jobs.taxScheduledAt("2026-03-31", 9, "Asia/Makassar")).toBe("2026-03-31T01:00:00.000Z")
    expect(jobs.taxScheduledAt("2026-03-31", 9, "Asia/Jayapura")).toBe("2026-03-31T00:00:00.000Z")
  })
})

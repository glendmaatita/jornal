import { describe, expect, test } from "bun:test"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adjustDueDate, CALENDARS } = require("../pb_hooks/tax_calendar.js") as {
  adjustDueDate: (date: string) => { date: string | null; status: string; source: string }
  CALENDARS: Record<number, { dates: string[]; source: string }>
}

describe("official Indonesian tax deadline calendar", () => {
  test("moves deadlines over national holidays, collective leave, and weekends", () => {
    expect(adjustDueDate("2026-03-20")).toMatchObject({ date: "2026-03-25", status: "VERIFIED" })
    expect(adjustDueDate("2025-08-17")).toMatchObject({ date: "2025-08-19", status: "VERIFIED" })
    expect(adjustDueDate("2027-03-12")).toMatchObject({ date: "2027-03-16", status: "VERIFIED" })
  })

  test("marks an uninstalled official calendar as provisional", () => {
    expect(adjustDueDate("2028-01-15")).toMatchObject({ date: "2028-01-17", status: "PROVISIONAL" })
  })

  test("contains reviewed 2025 through 2027 sources", () => {
    expect(Object.keys(CALENDARS)).toEqual(["2025", "2026", "2027"])
    for (const calendar of Object.values(CALENDARS)) {
      expect(calendar.dates.length).toBeGreaterThan(20)
      expect(calendar.source).toBeTruthy()
    }
  })
})

import { describe, expect, test } from "bun:test"

import {
  formatRupiah,
  formatSignedRupiah,
  formatCompactRupiah,
  formatNumberInput,
  parseAmountInput,
  formatDateLong,
  formatDateShort,
  formatMonthYear,
  formatShortDateLabel,
  formatGroupLabel,
  todayIsoDate,
  toIsoDate,
  parseIsoDate,
  monthRange,
  monthsElapsedThisYear,
} from "./format"

describe("format", () => {
  test("formatRupiah", () => {
    expect(formatRupiah(150_000_000)).toContain("150.000.000")
expect(formatRupiah(0)).toContain("0")
  })

  test("formatSignedRupiah", () => {
    expect(formatSignedRupiah(40_000_000)).toContain("+")
    expect(formatSignedRupiah(0)).not.toContain("+") // zero is unsigned
  })

  test("formatCompactRupiah across magnitudes", () => {
    expect(formatCompactRupiah(1_500_000_000)).toContain("M")
    expect(formatCompactRupiah(45_000_000)).toContain("jt")
    expect(formatCompactRupiah(500_000)).toContain("rb")
    expect(formatCompactRupiah(250)).toContain("Rp250")
    expect(formatCompactRupiah(-3_000_000)).toContain("-Rp3")
    expect(formatCompactRupiah(-500)).toContain("-Rp500")
  })

  test("parseAmountInput edge cases", () => {
    expect(parseAmountInput("")).toBe(0)
    expect(parseAmountInput("   ")).toBe(0)
    expect(parseAmountInput("Rp1.500.000")).toBe(1_500_000)
    expect(parseAmountInput("abc")).toBe(0)
  })

  test("formatNumberInput", () => {
    expect(formatNumberInput(0)).toBe("")
    expect(formatNumberInput("0")).toBe("")
    expect(formatNumberInput(1_500_000)).toBe("1.500.000")
    expect(formatNumberInput("2500000")).toBe("2.500.000")
  })

  test("date formatters", () => {
    expect(formatDateLong("2026-09-02")).toBe("2 September 2026")
    expect(formatDateShort("2026-09-02")).toBe("2 Sep 2026")
    expect(formatMonthYear("2026-09-02")).toBe("September 2026")
    expect(formatShortDateLabel("2026-09-02")).toBe("2 Sep")
  })

  test("todayIsoDate/toIsoDate/parseIsoDate roundtrip", () => {
    const date = new Date(2026, 8, 3) // Sep 3
    expect(todayIsoDate(date)).toBe("2026-09-03")
    expect(toIsoDate(new Date(2026, 0, 5))).toBe("2026-01-05")
    const parsed = parseIsoDate("2026-09-03")
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getDate()).toBe(3)
  })

  test("formatGroupLabel", () => {
    expect(formatGroupLabel("2026-09-03", "2026-09-03")).toBe("Hari ini")
    expect(formatGroupLabel("2026-09-02", "2026-09-03")).toBe("Kemarin")
    expect(formatGroupLabel("2026-09-01", "2026-09-03")).toContain("Selasa")
  })

  test("monthRange", () => {
    const range = monthRange(2026, 8) // September (0-based 8)
    expect(range.start).toBe("2026-09-01")
    expect(range.end).toBe("2026-09-30")
  })

  test("monthsElapsedThisYear", () => {
    expect(monthsElapsedThisYear(new Date(2026, 0, 1))).toBe(1)
    expect(monthsElapsedThisYear(new Date(2026, 11, 31))).toBe(12)
  })
})

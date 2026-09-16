import { describe, expect, test } from "bun:test"
import { calculateStatutoryDueDate, resolveTaxComplianceRule, TAX_COMPLIANCE_RULES } from "./tax-compliance-rules"

describe("tax compliance rule registry", () => {
  test("every kind has explicit date and provenance behavior", () => {
    expect(TAX_COMPLIANCE_RULES.length).toBeGreaterThanOrEqual(16)
    for (const rule of TAX_COMPLIANCE_RULES) {
      expect(rule.id).toBeTruthy()
      expect(rule.version).toBeTruthy()
      expect(rule.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (rule.sourceUrls.length === 0) expect(rule.manualDateRequired).toBe(true)
      if (rule.manualDateRequired) expect(["DOCUMENT", "MANUAL"]).toContain(rule.filingMethod)
    }
  })

  test("uses distinct monthly, PPN, and annual due rules", () => {
    const pph = resolveTaxComplianceRule("PPH_21_26_PAYROLL", "2026-09-01")!
    const ppn = resolveTaxComplianceRule("PPN_PPNBM", "2026-09-01")!
    const annual = resolveTaxComplianceRule("SPT_ANNUAL_INDIVIDUAL", "2026-12-31")!
    expect(calculateStatutoryDueDate(pph.paymentDueRule, "2026-09")).toBe("2026-10-15")
    expect(calculateStatutoryDueDate(pph.filingDueRule, "2026-09")).toBe("2026-10-20")
    expect(calculateStatutoryDueDate(ppn.filingDueRule, "2026-09")).toBe("2026-10-31")
    expect(calculateStatutoryDueDate(annual.filingDueRule, "2026", "2026-12-31")).toBe("2027-03-31")
    expect(calculateStatutoryDueDate(annual.filingDueRule, "2026", "2026-11-30")).toBe("2027-02-28")
  })

  test("document-driven tax never receives a fabricated date", () => {
    const pbb = resolveTaxComplianceRule("PBB", "2026-09-01")!
    expect(calculateStatutoryDueDate(pbb.paymentDueRule, "2026")).toBeNull()
    expect(pbb.manualDateRequired).toBe(true)
  })
})

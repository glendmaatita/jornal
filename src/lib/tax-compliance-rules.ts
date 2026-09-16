import type { TaxKind, TaxPeriodicity } from "./tax-compliance-types"

export type DueRule =
  | { type: "DAY_OF_NEXT_MONTH"; day: number }
  | { type: "END_OF_NEXT_MONTH" }
  | { type: "MONTHS_AFTER_FISCAL_YEAR_END"; months: number }
  | { type: "BEFORE_FILING" }
  | { type: "MANUAL_DOCUMENT" }
  | null

export interface TaxComplianceRule {
  id: string
  version: string
  kind: TaxKind
  label: string
  periodicity: TaxPeriodicity
  filingGroup: string
  effectiveFrom: string
  effectiveUntil: string | null
  paymentDueRule: DueRule
  filingDueRule: DueRule
  paymentBeforeFiling: boolean
  filingMethod: "SEPARATE_RETURN" | "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE" | "ANNUAL_RETURN" | "DOCUMENT" | "MANUAL"
  nilPolicy: "MAY_STILL_REQUIRE_FILING" | "RULE_SPECIFIC" | "NOT_APPLICABLE"
  holidayPolicy: "NEXT_WORKDAY_FOR_FILING" | "REQUIRES_OFFICIAL_CALENDAR" | "DOCUMENT_CONTROLS"
  manualDateRequired: boolean
  automaticAmount: boolean
  sourceUrls: string[]
  reviewedAt: string
}

const PMK_81 = "https://stats.pajak.go.id/en/node/113110"
const DUE_OVERVIEW = "https://www.pajak.go.id/en/node/35019"
const PAYMENT_OVERVIEW = "https://www.pajak.go.id/id/berita/pemerintah-sederhanakan-jatuh-tempo-pembayaran-pajak-lewat-peraturan-menkeu"
const PP_20_2026 = "https://jdih.kemenkeu.go.id/dok/pp-20-tahun-2026"
const PP_55_2022 = "https://jdih.kemenkeu.go.id/dok/pp-55-tahun-2022"

const pphMonthly = (
  id: string,
  kind: TaxKind,
  label: string,
  filingGroup = "SPT_MASA_UNIFIKASI",
  filingMethod: TaxComplianceRule["filingMethod"] = "SEPARATE_RETURN",
): TaxComplianceRule => ({
  id, version: "2026.1", kind, label, periodicity: "MONTHLY", filingGroup,
  effectiveFrom: "2025-01-01", effectiveUntil: null,
  paymentDueRule: { type: "DAY_OF_NEXT_MONTH", day: 15 },
  filingDueRule: { type: "DAY_OF_NEXT_MONTH", day: 20 },
  paymentBeforeFiling: true, filingMethod, nilPolicy: "RULE_SPECIFIC",
  holidayPolicy: "REQUIRES_OFFICIAL_CALENDAR", manualDateRequired: false,
  automaticAmount: kind === "PPH_FINAL_UMKM",
  sourceUrls: [PMK_81, PAYMENT_OVERVIEW], reviewedAt: "2026-09-16",
})

export const TAX_COMPLIANCE_RULES: TaxComplianceRule[] = [
  { ...pphMonthly("PPH_FINAL_UMKM_PP55_2022", "PPH_FINAL_UMKM", "PPh Final UMKM 0,5%", "SPT_MASA_UNIFIKASI", "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"), version: "2025.1", effectiveUntil: "2026-04-21", sourceUrls: [PMK_81, PAYMENT_OVERVIEW, PP_55_2022] },
  { ...pphMonthly("PPH_FINAL_UMKM_PP20_2026", "PPH_FINAL_UMKM", "PPh Final UMKM 0,5%", "SPT_MASA_UNIFIKASI", "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"), effectiveFrom: "2026-04-22", sourceUrls: [PMK_81, PAYMENT_OVERVIEW, PP_20_2026] },
  pphMonthly("PPH_21_26_2025", "PPH_21_26_PAYROLL", "PPh 21/26 terkait pekerjaan", "SPT_MASA_21_26"),
  pphMonthly("PPH_23_26_2025", "PPH_23_26", "PPh 23/26 non-payroll"),
  pphMonthly("PPH_4_2_OTHER_2025", "PPH_4_2_OTHER", "PPh Pasal 4 ayat (2) selain UMKM"),
  pphMonthly("PPH_15_2025", "PPH_15", "PPh Pasal 15"),
  pphMonthly("PPH_22_2025", "PPH_22", "PPh Pasal 22"),
  pphMonthly("PPH_25_2025", "PPH_25", "PPh Pasal 25", "SPT_MASA_PPH_25", "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"),
  {
    id: "PPN_PPNBM_GENERAL_2025", version: "2026.1", kind: "PPN_PPNBM", label: "SPT Masa PPN/PPnBM",
    periodicity: "MONTHLY", filingGroup: "SPT_MASA_PPN", effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: { type: "END_OF_NEXT_MONTH" }, filingDueRule: { type: "END_OF_NEXT_MONTH" },
    paymentBeforeFiling: true, filingMethod: "SEPARATE_RETURN", nilPolicy: "MAY_STILL_REQUIRE_FILING",
    holidayPolicy: "REQUIRES_OFFICIAL_CALENDAR", manualDateRequired: false, automaticAmount: false,
    sourceUrls: [PMK_81, DUE_OVERVIEW], reviewedAt: "2026-09-16",
  },
  {
    id: "PPN_SPECIAL_MANUAL", version: "2026.1", kind: "PPN_SPECIAL", label: "PPN khusus",
    periodicity: "EVENT", filingGroup: "PPN_SPECIAL", effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: { type: "MANUAL_DOCUMENT" }, filingDueRule: { type: "MANUAL_DOCUMENT" },
    paymentBeforeFiling: false, filingMethod: "MANUAL", nilPolicy: "RULE_SPECIFIC",
    holidayPolicy: "DOCUMENT_CONTROLS", manualDateRequired: true, automaticAmount: false,
    sourceUrls: [PMK_81], reviewedAt: "2026-09-16",
  },
  {
    id: "SPT_ANNUAL_INDIVIDUAL_2025", version: "2026.1", kind: "SPT_ANNUAL_INDIVIDUAL", label: "SPT Tahunan Orang Pribadi",
    periodicity: "ANNUAL", filingGroup: "SPT_TAHUNAN_OP", effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: null, filingDueRule: { type: "MONTHS_AFTER_FISCAL_YEAR_END", months: 3 }, paymentBeforeFiling: false,
    filingMethod: "ANNUAL_RETURN", nilPolicy: "MAY_STILL_REQUIRE_FILING", holidayPolicy: "REQUIRES_OFFICIAL_CALENDAR",
    manualDateRequired: false, automaticAmount: false, sourceUrls: [PMK_81, DUE_OVERVIEW], reviewedAt: "2026-09-16",
  },
  {
    id: "SPT_ANNUAL_ENTITY_2025", version: "2026.1", kind: "SPT_ANNUAL_ENTITY", label: "SPT Tahunan Badan",
    periodicity: "ANNUAL", filingGroup: "SPT_TAHUNAN_BADAN", effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: null, filingDueRule: { type: "MONTHS_AFTER_FISCAL_YEAR_END", months: 4 }, paymentBeforeFiling: false,
    filingMethod: "ANNUAL_RETURN", nilPolicy: "MAY_STILL_REQUIRE_FILING", holidayPolicy: "REQUIRES_OFFICIAL_CALENDAR",
    manualDateRequired: false, automaticAmount: false, sourceUrls: [PMK_81, DUE_OVERVIEW], reviewedAt: "2026-09-16",
  },
  {
    id: "PPH_29_ANNUAL", version: "2026.1", kind: "PPH_29", label: "PPh Pasal 29",
    periodicity: "ANNUAL", filingGroup: "SPT_TAHUNAN_LINKED", effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: { type: "BEFORE_FILING" }, filingDueRule: null, paymentBeforeFiling: true,
    filingMethod: "ANNUAL_RETURN", nilPolicy: "NOT_APPLICABLE", holidayPolicy: "REQUIRES_OFFICIAL_CALENDAR",
    manualDateRequired: false, automaticAmount: false, sourceUrls: [PMK_81], reviewedAt: "2026-09-16",
  },
  ...(["PBB", "LOCAL_TAX", "STAMP_DUTY", "ASSESSMENT", "OTHER"] as const).map((kind): TaxComplianceRule => ({
    id: `${kind}_MANUAL_DOCUMENT`, version: "2026.1", kind,
    label: ({ PBB: "Pajak Bumi dan Bangunan", LOCAL_TAX: "Pajak daerah", STAMP_DUTY: "Bea meterai", ASSESSMENT: "STP/SKP atau angsuran resmi", OTHER: "Kewajiban pajak lainnya" })[kind],
    periodicity: "EVENT", filingGroup: kind, effectiveFrom: "2025-01-01", effectiveUntil: null,
    paymentDueRule: { type: "MANUAL_DOCUMENT" }, filingDueRule: { type: "MANUAL_DOCUMENT" },
    paymentBeforeFiling: false, filingMethod: "DOCUMENT", nilPolicy: "RULE_SPECIFIC",
    holidayPolicy: "DOCUMENT_CONTROLS", manualDateRequired: true, automaticAmount: false,
    sourceUrls: kind === "PBB" ? ["https://www.pajak.go.id/id/artikel/pajak-bumi-dan-bangunan-siapakah-yang-mengelola"] : [],
    reviewedAt: "2026-09-16",
  })),
]

export function resolveTaxComplianceRule(kind: TaxKind, onDate: string): TaxComplianceRule | null {
  return TAX_COMPLIANCE_RULES
    .filter((rule) => rule.kind === kind && rule.effectiveFrom <= onDate && (!rule.effectiveUntil || rule.effectiveUntil >= onDate))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
}

function isoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day))
  return date.toISOString().slice(0, 10)
}

function addMonthsClamped(dateText: string, months: number): string | null {
  const [year, month, day] = dateText.split("-").map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return isoDate(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay))
}

export function calculateStatutoryDueDate(
  rule: DueRule,
  period: string,
  fiscalYearEnd?: string,
): string | null {
  if (!rule || rule.type === "MANUAL_DOCUMENT" || rule.type === "BEFORE_FILING") return null
  if (rule.type === "MONTHS_AFTER_FISCAL_YEAR_END") {
    if (!fiscalYearEnd || !/^\d{4}-\d{2}-\d{2}$/.test(fiscalYearEnd)) return null
    return addMonthsClamped(fiscalYearEnd, rule.months)
  }
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return null
  if (rule.type === "DAY_OF_NEXT_MONTH") return isoDate(year, monthIndex + 1, rule.day)
  return isoDate(year, monthIndex + 2, 0)
}

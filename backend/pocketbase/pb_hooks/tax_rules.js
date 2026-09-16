const RULES = [
  ["PPH_FINAL_UMKM_PP55_2022", "PPH_FINAL_UMKM", "PPh Final UMKM 0,5%", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", true, "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"],
  ["PPH_FINAL_UMKM_PP20_2026", "PPH_FINAL_UMKM", "PPh Final UMKM 0,5%", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", true, "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"],
  ["PPH_21_26_2025", "PPH_21_26_PAYROLL", "PPh 21/26 terkait pekerjaan", "MONTHLY", "SPT_MASA_21_26", "DAY_15", "DAY_20", false, "SEPARATE_RETURN"],
  ["PPH_23_26_2025", "PPH_23_26", "PPh 23/26 non-payroll", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", false, "SEPARATE_RETURN"],
  ["PPH_4_2_OTHER_2025", "PPH_4_2_OTHER", "PPh Pasal 4 ayat (2) selain UMKM", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", false, "SEPARATE_RETURN"],
  ["PPH_15_2025", "PPH_15", "PPh Pasal 15", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", false, "SEPARATE_RETURN"],
  ["PPH_22_2025", "PPH_22", "PPh Pasal 22", "MONTHLY", "SPT_MASA_UNIFIKASI", "DAY_15", "DAY_20", false, "SEPARATE_RETURN"],
  ["PPH_25_2025", "PPH_25", "PPh Pasal 25", "MONTHLY", "SPT_MASA_PPH_25", "DAY_15", "DAY_20", false, "FULFILLED_BY_VALIDATED_PAYMENT_WHEN_ELIGIBLE"],
  ["PPN_PPNBM_GENERAL_2025", "PPN_PPNBM", "SPT Masa PPN/PPnBM", "MONTHLY", "SPT_MASA_PPN", "END_NEXT_MONTH", "END_NEXT_MONTH", false, "SEPARATE_RETURN"],
  ["PPN_SPECIAL_MANUAL", "PPN_SPECIAL", "PPN khusus", "EVENT", "PPN_SPECIAL", "MANUAL", "MANUAL", false, "MANUAL"],
  ["SPT_ANNUAL_INDIVIDUAL_2025", "SPT_ANNUAL_INDIVIDUAL", "SPT Tahunan Orang Pribadi", "ANNUAL", "SPT_TAHUNAN_OP", null, "FY_PLUS_3", false, "ANNUAL_RETURN"],
  ["SPT_ANNUAL_ENTITY_2025", "SPT_ANNUAL_ENTITY", "SPT Tahunan Badan", "ANNUAL", "SPT_TAHUNAN_BADAN", null, "FY_PLUS_4", false, "ANNUAL_RETURN"],
  ["PPH_29_ANNUAL", "PPH_29", "PPh Pasal 29", "ANNUAL", "SPT_TAHUNAN_LINKED", "BEFORE_FILING", null, false, "ANNUAL_RETURN"],
  ["PBB_MANUAL_DOCUMENT", "PBB", "Pajak Bumi dan Bangunan", "EVENT", "PBB", "MANUAL", "MANUAL", false, "DOCUMENT"],
  ["LOCAL_TAX_MANUAL_DOCUMENT", "LOCAL_TAX", "Pajak daerah", "EVENT", "LOCAL_TAX", "MANUAL", "MANUAL", false, "DOCUMENT"],
  ["STAMP_DUTY_MANUAL_DOCUMENT", "STAMP_DUTY", "Bea meterai", "EVENT", "STAMP_DUTY", "MANUAL", "MANUAL", false, "DOCUMENT"],
  ["ASSESSMENT_MANUAL_DOCUMENT", "ASSESSMENT", "STP/SKP atau angsuran resmi", "EVENT", "ASSESSMENT", "MANUAL", "MANUAL", false, "DOCUMENT"],
  ["OTHER_MANUAL_DOCUMENT", "OTHER", "Kewajiban pajak lainnya", "EVENT", "OTHER", "MANUAL", "MANUAL", false, "DOCUMENT"],
].map((rule) => ({
  id: rule[0], kind: rule[1], label: rule[2], periodicity: rule[3], filingGroup: rule[4],
  paymentDueRule: rule[5], filingDueRule: rule[6], automaticAmount: rule[7], filingMethod: rule[8],
  version: rule[0] === "PPH_FINAL_UMKM_PP55_2022" ? "2025.1" : "2026.1",
  effectiveFrom: rule[0] === "PPH_FINAL_UMKM_PP20_2026" ? "2026-04-22" : "2025-01-01",
  effectiveUntil: rule[0] === "PPH_FINAL_UMKM_PP55_2022" ? "2026-04-21" : null,
  manualDateRequired: rule[5] === "MANUAL" || rule[6] === "MANUAL",
}))

function isoDate(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10)
}

function addMonthsClamped(dateText, months) {
  const parts = String(dateText || "").split("-").map(Number)
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null
  const targetFirst = new Date(Date.UTC(parts[0], parts[1] - 1 + months, 1))
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate()
  return isoDate(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(parts[2], lastDay))
}

function dueDate(code, period, fiscalYearEnd, linkedFilingDueDate) {
  if (!code || code === "MANUAL") return null
  if (code === "BEFORE_FILING") return linkedFilingDueDate || null
  if (code === "FY_PLUS_3") return addMonthsClamped(fiscalYearEnd, 3)
  if (code === "FY_PLUS_4") return addMonthsClamped(fiscalYearEnd, 4)
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ""))
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]) - 1
  if (month < 0 || month > 11) return null
  if (code === "DAY_15") return isoDate(year, month + 1, 15)
  if (code === "DAY_20") return isoDate(year, month + 1, 20)
  if (code === "END_NEXT_MONTH") return isoDate(year, month + 2, 0)
  return null
}

function ruleById(id) { return RULES.find((rule) => rule.id === id) || null }
function ruleByKindAt(kind, dateText) {
  return RULES.filter((rule) => rule.kind === kind && rule.effectiveFrom <= dateText && (!rule.effectiveUntil || rule.effectiveUntil >= dateText))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] || null
}

function computeUmkm(input) {
  const safeMoney = (value, name) => {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number < 0) throw new ApiError(400, `${name} must be a non-negative integer`)
    return number
  }
  const before = safeMoney(input.cumulativeRevenueBefore, "cumulativeRevenueBefore")
  const current = safeMoney(input.currentMonthRevenue, "currentMonthRevenue")
  const adjustment = Number(input.adjustments || 0)
  if (!Number.isSafeInteger(adjustment)) throw new ApiError(400, "adjustments must be an integer")
  if (!input.eligible) return { amountState: "NEEDS_REVIEW", dataStatus: "NEEDS_RECONCILIATION", taxableBase: null, liabilityAmount: null }
  if (!input.dataComplete) return { amountState: "UNKNOWN", dataStatus: "INCOMPLETE", taxableBase: null, liabilityAmount: null }
  const allowance = input.subjectType === "INDIVIDUAL" ? 500000000 : 0
  const monthRevenue = Math.max(0, current + adjustment)
  const taxableBase = Math.max(0, before + monthRevenue - allowance) - Math.max(0, before - allowance)
  return { amountState: "CONFIRMED", dataStatus: "COMPLETE", taxableBase, liabilityAmount: Math.round(taxableBase * 0.005) }
}

module.exports = { RULES, addMonthsClamped, computeUmkm, dueDate, ruleById, ruleByKindAt }

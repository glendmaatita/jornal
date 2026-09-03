// Versioned Tax Rule Engine per prd.md §42.
// Rules are decoupled from transactions: each rule version carries
// tax_rule_version / effective_from / effective_until so regulatory changes
// never silently rewrite historical calculations.

import { formatRupiah } from "./format"
import { monthsElapsedThisYear, todayIsoDate } from "./format"
import { resolveProfileAsOf, resolveTransactionsAsOf } from "./store"
import type { BusinessProfile, BusinessType, TaxScheme, Transaction } from "./types"

export type TaxRuleId = "UMKM_FINAL_05_P55_2022" | "PPH_PROG_2022" | "PPH_BADAN_22"

export interface TaxRule {
  id: TaxRuleId
  scheme: TaxScheme
  name: string
  version: string
  effectiveFrom: string // YYYY-MM-DD inclusive
  effectiveUntil: string | null // YYYY-MM-DD inclusive, null = open ended
  ratePercent: number | null // flat/final rate
  brackets: TaxBracket[] | null
  base: "REVENUE" | "PROFIT" // what the rule is applied to
  note: string
}

export interface TaxBracket {
  upTo: number | null // null = no upper bound
  ratePercent: number
}

export const TAX_RULES: TaxRule[] = [
  {
    id: "UMKM_FINAL_05_P55_2022",
    scheme: "UMKM_FINAL",
    name: "PPh Final UMKM 0,5% (PP 55/2022)",
    version: "2022.1",
    effectiveFrom: "2022-01-01",
    effectiveUntil: null,
    ratePercent: 0.5,
    brackets: null,
    base: "REVENUE",
    note: "PPh final 0,5% dari peredaran bruto untuk Wajib Pajak UMKM yang memenuhi syarat. Untuk Wajib Pajak Orang Pribadi, omzet kumulatif sampai Rp500 juta per tahun tidak dikenai pajak.",
  },
  {
    id: "PPH_PROG_2022",
    scheme: "PROGRESSIVE",
    name: "PPh Orang Pribadi Progresif (UU PPh)",
    version: "2022.1",
    effectiveFrom: "2022-01-01",
    effectiveUntil: null,
    ratePercent: null,
    // Simplified: applied to annual net income above PTKP TK/0.
    brackets: [
      { upTo: 60_000_000, ratePercent: 5 },
      { upTo: 250_000_000, ratePercent: 15 },
      { upTo: 500_000_000, ratePercent: 25 },
      { upTo: 5_000_000_000, ratePercent: 30 },
      { upTo: null, ratePercent: 35 },
    ],
    base: "REVENUE",
    note: "Estimasi sederhana: tarif progresif atas laba neto tahunan di atas PTKP Rp54.000.000 (TK/0). Bukan pengganti perhitungan PPh yang sesungguhnya.",
  },
  {
    id: "PPH_BADAN_22",
    scheme: "CORPORATE",
    name: "PPh Badan 22% (UU HPP)",
    version: "2022.1",
    effectiveFrom: "2022-01-01",
    effectiveUntil: null,
    ratePercent: 22,
    brackets: null,
    base: "PROFIT",
    note: "Estimasi sederhana: 22% atas laba neto. Fasilitas Pasal 31E (pengurangan tarif 50% untuk bagian omzet sampai Rp4,8 miliar) diperhitungkan secara proporsional.",
  },
]

const UMKM_ANNUAL_LIMIT = 4_800_000_000
const UMKM_OP_FREE_ALLOWANCE = 500_000_000
const CORP_RATE = 22
const CORP_REDUCED_RATE = 11

export function allowedTaxSchemes(businessType: BusinessType): TaxScheme[] {
  switch (businessType) {
    case "INDIVIDUAL":
      return ["UMKM_FINAL", "PROGRESSIVE", "NOT_CALCULATED"]
    case "PT_PERORANGAN":
      return ["UMKM_FINAL", "CORPORATE", "NOT_CALCULATED"]
    case "PT":
    case "CV":
      return ["CORPORATE", "NOT_CALCULATED"]
    case "OTHER":
      return ["PROGRESSIVE", "CORPORATE", "NOT_CALCULATED"]
  }
}

function fallbackTaxScheme(businessType: BusinessType): Exclude<TaxScheme, "NOT_CALCULATED"> {
  switch (businessType) {
    case "INDIVIDUAL":
    case "OTHER":
      return "PROGRESSIVE"
    case "PT_PERORANGAN":
    case "PT":
    case "CV":
      return "CORPORATE"
  }
}

function annualize(amount: number, monthsElapsed: number): number {
  const months = Math.max(1, monthsElapsed)
  return (amount / months) * 12
}

function corporateTax(taxableProfit: number, projectedAnnualRevenue: number): number {
  if (taxableProfit <= 0) return 0
  if (projectedAnnualRevenue <= UMKM_ANNUAL_LIMIT) {
    return (taxableProfit * CORP_REDUCED_RATE) / 100
  }
  if (projectedAnnualRevenue > 50_000_000_000) {
    return (taxableProfit * CORP_RATE) / 100
  }
  const reducedShare = UMKM_ANNUAL_LIMIT / projectedAnnualRevenue
  const effectiveRate = CORP_RATE - (CORP_RATE - CORP_REDUCED_RATE) * reducedShare
  return (taxableProfit * effectiveRate) / 100
}

function resolveAppliedScheme(
  businessType: BusinessType,
  taxScheme: TaxScheme,
  projectedAnnualRevenue: number,
): { appliedScheme: Exclude<TaxScheme, "NOT_CALCULATED"> | null; note: string | null } {
  if (taxScheme === "NOT_CALCULATED") {
    return {
      appliedScheme: null,
      note: "Skema pajak belum diatur di profil. Isi profil pajak di Pengaturan agar estimasi bisa dihitung.",
    }
  }

  if (!allowedTaxSchemes(businessType).includes(taxScheme)) {
    const fallback = fallbackTaxScheme(businessType)
    return {
      appliedScheme: fallback,
      note: `Skema yang dipilih tidak tersedia untuk jenis usaha ini. Estimasi dihitung memakai skema ${fallback === "PROGRESSIVE" ? "progresif" : "badan"} sebagai cadangan.`,
    }
  }

  if (taxScheme === "UMKM_FINAL" && projectedAnnualRevenue > UMKM_ANNUAL_LIMIT) {
    const fallback = fallbackTaxScheme(businessType)
    return {
      appliedScheme: fallback,
      note: `Proyeksi omzet tahunan melebihi batas Rp4,8 miliar sehingga fasilitas PPh Final UMKM tidak lagi dipakai. Estimasi beralih ke skema ${fallback === "PROGRESSIVE" ? "progresif" : "badan"}.`,
    }
  }

  return { appliedScheme: taxScheme, note: null }
}

/** Resolve the rule version valid for a given date (§42: effective_from / effective_until). */
export function resolveTaxRule(scheme: TaxScheme, onDate: string): TaxRule | null {
  let latest: TaxRule | null = null
  for (const rule of TAX_RULES) {
    if (rule.scheme !== scheme) continue
    if (rule.effectiveFrom > onDate) continue
    if (rule.effectiveUntil !== null && onDate > rule.effectiveUntil) continue
    if (!latest || rule.effectiveFrom > latest.effectiveFrom) latest = rule
  }
  return latest
}

export interface TaxOverviewInput {
  scheme: TaxScheme
  businessType: BusinessType
  /** ISO date used to resolve the rule version (today) */
  onDate: string
  revenueYTD: number
  businessExpenseYTD: number
  taxPaid: number
  monthsElapsed: number // 1–12
}

export interface TaxOverview {
  rule: TaxRule | null
  appliedScheme: Exclude<TaxScheme, "NOT_CALCULATED"> | null
  revenueYTD: number
  projectedAnnualRevenue: number
  estimatedTax: number
  taxPaid: number
  remainingEstimatedTax: number
  recommendedTaxReserve: number
  explanation: string
}

function progressiveTax(taxable: number, brackets: TaxBracket[]): number {
  let remaining = taxable
  let lowerBound = 0
  let tax = 0
  for (const bracket of brackets) {
    if (remaining <= 0) break
    const ceiling = bracket.upTo ?? Number.POSITIVE_INFINITY
    const bandWidth = ceiling - lowerBound
    const taxed = Math.min(remaining, bandWidth)
    tax += (taxed * bracket.ratePercent) / 100
    remaining -= taxed
    lowerBound = ceiling
  }
  return tax
}

const PTKP_TK0 = 54_000_000

export function computeTaxOverview(input: TaxOverviewInput): TaxOverview {
  const months = Math.max(1, input.monthsElapsed)
  const projectedAnnualRevenue = Math.round(annualize(input.revenueYTD, months))
  const projectedAnnualProfit = Math.max(0, Math.round(annualize(Math.max(0, input.revenueYTD - input.businessExpenseYTD), months)))
  const applied = resolveAppliedScheme(input.businessType, input.scheme, projectedAnnualRevenue)

  if (!applied.appliedScheme) {
    return {
      rule: null,
      appliedScheme: null,
      revenueYTD: input.revenueYTD,
      projectedAnnualRevenue,
      estimatedTax: 0,
      taxPaid: input.taxPaid,
      remainingEstimatedTax: 0,
      recommendedTaxReserve: 0,
      explanation: applied.note ?? "Skema pajak belum diatur di profil. Isi profil pajak di Pengaturan agar estimasi bisa dihitung.",
    }
  }

  const rule = resolveTaxRule(applied.appliedScheme, input.onDate)
  if (!rule) {
    return {
      rule: null,
      appliedScheme: applied.appliedScheme,
      revenueYTD: input.revenueYTD,
      projectedAnnualRevenue,
      estimatedTax: 0,
      taxPaid: input.taxPaid,
      remainingEstimatedTax: 0,
      recommendedTaxReserve: 0,
      explanation: applied.note ?? "Aturan pajak untuk skema ini belum tersedia pada tanggal tersebut.",
    }
  }
  let estimatedTax = 0

  switch (applied.appliedScheme) {
    case "UMKM_FINAL": {
      const taxableRevenue =
        input.businessType === "INDIVIDUAL"
          ? Math.max(0, projectedAnnualRevenue - UMKM_OP_FREE_ALLOWANCE)
          : projectedAnnualRevenue
      estimatedTax = (taxableRevenue * 0.5) / 100
      break
    }
    case "PROGRESSIVE": {
      const taxableIncome = Math.max(0, projectedAnnualProfit - PTKP_TK0)
      estimatedTax = rule?.brackets ? progressiveTax(taxableIncome, rule.brackets) : 0
      break
    }
    case "CORPORATE":
      estimatedTax = corporateTax(projectedAnnualProfit, projectedAnnualRevenue)
      break
  }

  estimatedTax = Math.round(estimatedTax)

  const remaining = Math.max(0, estimatedTax - input.taxPaid)
  const baseDescription =
    applied.appliedScheme === "UMKM_FINAL"
      ? `${formatRupiah(projectedAnnualRevenue)} (proyeksi omzet tahunan)`
      : `${formatRupiah(projectedAnnualProfit)} (proyeksi laba neto tahunan)`

  return {
    rule,
    appliedScheme: applied.appliedScheme,
    revenueYTD: input.revenueYTD,
    projectedAnnualRevenue,
    estimatedTax,
    taxPaid: input.taxPaid,
    remainingEstimatedTax: remaining,
    recommendedTaxReserve: remaining,
    explanation: `${applied.note ? `${applied.note} ` : ""}${rule.name} (versi ${rule.version}) diterapkan atas ${baseDescription}.`,
  }
}

/** System-generated tax treatment explanation for the transaction detail screen (§29). */
export const TAX_TREATMENTS: Partial<Record<Transaction["classification"], string>> = {
  REVENUE: "Termasuk omzet — diperhitungkan dalam estimasi pajak.",
  OPERATING_EXPENSE: "Biaya operasional bisnis — mengurangi estimasi laba.",
  CAPITAL_INJECTION: "Bukan omzet — tidak diperhitungkan sebagai pendapatan pajak.",
  OWNER_WITHDRAWAL: "Bukan biaya bisnis — tidak mengurangi pajak.",
  ASSET_PURCHASE: "Pembelian aset — perlakuan penyusutan tidak dihitung otomatis.",
  LOAN_RECEIVED: "Bukan omzet — pokok pinjaman tidak dikenakan pajak.",
  LOAN_PAYMENT: "Cicilan pokok — bukan biaya. Bunga belum dipisahkan otomatis.",
  TAX_PAYMENT: "Pembayaran pajak — mengurangi sisa estimasi pajak.",
  INTERNAL_TRANSFER: "Transfer antar rekening — tidak memengaruhi omzet, biaya, atau pajak.",
  REFUND: "Pengembalian dana.",
  OTHER_INCOME: "Pemasukan di luar omzet utama.",
  OTHER_OUTFLOW: "Pengeluaran di luar klasifikasi lain.",
  OPENING_BALANCE: "Saldo awal — bukan omzet.",
  UNKNOWN: "Belum ada perlakuan pajak — konfirmasi klasifikasinya.",
}

// ── Aggregations feeding the tax engine (§42 flow: transactions → classification → tax) ──

export function revenueYTD(transactions: Transaction[], fiscalYear: number): number {
  return transactions
    .filter(
      (t) =>
        t.direction === "MONEY_IN" &&
        t.classification === "REVENUE" &&
        t.transactionDate.startsWith(String(fiscalYear)),
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

export function businessExpenseYTD(transactions: Transaction[], fiscalYear: number): number {
  return transactions
    .filter(
      (t) =>
        t.direction === "MONEY_OUT" &&
        t.classification === "OPERATING_EXPENSE" &&
        t.transactionDate.startsWith(String(fiscalYear)),
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

export function taxPaidYTD(transactions: Transaction[], fiscalYear: number): number {
  return transactions
    .filter(
      (t) =>
        t.direction === "MONEY_OUT" &&
        t.classification === "TAX_PAYMENT" &&
        t.transactionDate.startsWith(String(fiscalYear)),
    )
    .reduce((sum, t) => sum + t.amount, 0)
}

/** Tax overview computed as of an arbitrary historical date (used by STS history, §59). */
export function computeTaxOverviewAsOf(
  profile: BusinessProfile,
  transactions: Transaction[],
  asOf: string,
  usePersistedHistory = false,
): TaxOverview {
  const resolvedProfile = usePersistedHistory ? resolveProfileAsOf(asOf, profile) : profile
  const txnsUpTo = usePersistedHistory ? resolveTransactionsAsOf(asOf, transactions) : transactions.filter((transaction) => transaction.transactionDate <= asOf)
  const year = Number(asOf.slice(0, 4))
  const monthsElapsed = Math.max(1, Number(asOf.slice(5, 7)))
  return computeTaxOverview({
    scheme: resolvedProfile.taxScheme,
    businessType: resolvedProfile.businessType,
    onDate: asOf,
    revenueYTD: revenueYTD(txnsUpTo, year),
    businessExpenseYTD: businessExpenseYTD(txnsUpTo, year),
    taxPaid: taxPaidYTD(txnsUpTo, year),
    monthsElapsed,
  })
}

// ── Proactive tax awareness (§5.1 #9 — ROADMAP Phase 2 D) ──

export type TaxAlertLevel = "info" | "warning"

export interface TaxAlert {
  id: string
  level: TaxAlertLevel
  text: string
}

/** PKP registration threshold for taxable entrepreneurs (gross turnover annual limit). */
const PKP_THRESHOLD = 4_800_000_000

export function taxAlerts(profile: { taxScheme: TaxScheme; businessType: BusinessType; pkpStatus: boolean }, transactions: Transaction[], now = new Date()): TaxAlert[] {
  const alerts: TaxAlert[] = []
  if (profile.taxScheme === "NOT_CALCULATED") return alerts

  const year = now.getFullYear()
  const ytd = revenueYTD(transactions, year)
  const overview = computeTaxOverview({
    scheme: profile.taxScheme,
    businessType: profile.businessType,
    onDate: todayIsoDate(now),
    revenueYTD: ytd,
    businessExpenseYTD: businessExpenseYTD(transactions, year),
    taxPaid: taxPaidYTD(transactions, year),
    monthsElapsed: monthsElapsedThisYear(now),
  })
  const projected = overview.projectedAnnualRevenue

  if (profile.taxScheme === "UMKM_FINAL") {
    if (ytd >= UMKM_ANNUAL_LIMIT) {
      alerts.push({
        id: "umkm-limit-exceeded",
        level: "warning",
        text: `Omzet YTD sudah ${formatRupiah(ytd)} — melebihi batas UMKM Rp4,8 M. Fasilitas PPh Final UMKM tidak bisa dipakai.`,
      })
    } else if (projected >= UMKM_ANNUAL_LIMIT * 0.8) {
      alerts.push({
        id: "umkm-limit-approaching",
        level: "info",
        text: `Proyeksi omzet tahun ini ${formatRupiah(projected)} — mendekati batas UMKM Rp4,8 M. Pantau agar tarif final 0,5% tetap berlaku.`,
      })
    }
  }

  if (!profile.pkpStatus && projected >= PKP_THRESHOLD) {
    alerts.push({
      id: "pkp-threshold",
      level: "info",
      text: `Proyeksi omzet ${formatRupiah(projected)} — melewati ambang batas PKP (pengusaha kena pajak). Pertimbangkan mendaftarkan status PKP.`,
    })
  }

  if (profile.taxScheme === "PROGRESSIVE" && projected > 0) {
    const NEXT_BRACKETS: { upTo: number; ratePercent: number }[] = [
      { upTo: 60_000_000, ratePercent: 15 },
      { upTo: 250_000_000, ratePercent: 25 },
      { upTo: 500_000_000, ratePercent: 30 },
    ]
    let lowerBound = 0
    for (const bracket of NEXT_BRACKETS) {
      if (projected >= lowerBound && projected < bracket.upTo) {
        if (projected >= bracket.upTo * 0.9) {
          alerts.push({
            id: `bracket-${bracket.upTo}`,
            level: "info",
            text: `Proyeksi omzet tahunan ${formatRupiah(projected)} — hampir masuk tarif ${bracket.ratePercent}% (di atas ${formatRupiah(bracket.upTo)}).`,
          })
        }
        break
      }
      lowerBound = bracket.upTo
    }
  }

  return alerts
}

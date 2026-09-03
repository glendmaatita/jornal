// Automatic classification & categorization engine per prd.md §18, §20–23, §25.
// Phase 1: rule-based (source RULE) + learned patterns from user corrections
// (source HISTORICAL_PATTERN). Pattern data is captured now so Phase 2's
// learning loop can build on it (see ROADMAP Phase 1 item C).

import { ALL_CATEGORIES } from "./categories"
import type {
  Category,
  NewTransaction,
  TransactionClassification,
  TransactionDirection,
} from "./types"

export interface ClassificationSuggestion {
  categoryId: string | null
  classification: TransactionClassification
  businessRelevance: NewTransaction["businessRelevance"]
  confidence: number
  source: "RULE" | "HISTORICAL_PATTERN"
}

export interface ConfidenceThresholds {
  autoAccept: number
  needsReview: number
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  autoAccept: 0.9,
  needsReview: 0.7,
}

export type ConfidenceLevel = "auto_accept" | "accept_with_suggestion" | "needs_review"

/** prd.md §22 — >= 0.90 auto accept, 0.70–0.89 accept + subtle suggestion, < 0.70 needs review */
export function confidenceLevel(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceLevel {
  if (confidence >= thresholds.autoAccept) return "auto_accept"
  if (confidence >= thresholds.needsReview) return "accept_with_suggestion"
  return "needs_review"
}

export function reviewStatusFor(confidence: number, thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS) {
  const level = confidenceLevel(confidence, thresholds)
  return level === "auto_accept" ? "AUTO_ACCEPTED" : level === "accept_with_suggestion" ? "ACCEPTED" : "NEEDS_REVIEW"
}

function normalize(description: string): string {
  return description.toLowerCase().trim()
}

function matchKeywords(description: string, keywords: string[]): string[] {
  const text = ` ${normalize(description)} `
  return keywords.filter((keyword) => text.includes(` ${keyword.trim().toLowerCase()} `) || text.includes(keyword.trim().toLowerCase()))
}

// Direction-informing keywords for smart classification (§3.2 examples)
const OUT_HINTS = ["bayar", "beli", "belanjakan", "transfer keluar", "keluar", "top up", "isi ulang", "tarik"]
const IN_HINTS = ["terima", "penjualan", "dibayar", "masuk", "setoran", "terjual"]

export function detectDirection(description: string): TransactionDirection | null {
  const text = normalize(description)
  const hasOut = OUT_HINTS.some((hint) => text.includes(hint))
  const hasIn = IN_HINTS.some((hint) => text.includes(hint))
  if (hasOut && !hasIn) return "MONEY_OUT"
  if (hasIn && !hasOut) return "MONEY_IN"
  return null
}

// Non-operational money movement keywords (§18, §19, §4.3–4.4)
const NON_OPERATIONAL_RULES: {
  keywords: string[]
  classification: TransactionClassification
  direction: TransactionDirection
  businessRelevance: NewTransaction["businessRelevance"]
}[] = [
  { keywords: ["modal", "setoran modal", "injeksi modal"], classification: "CAPITAL_INJECTION", direction: "MONEY_IN", businessRelevance: "BUSINESS" },
  { keywords: ["pinjaman", "kredit bank", "loan"], classification: "LOAN_RECEIVED", direction: "MONEY_IN", businessRelevance: "BUSINESS" },
  { keywords: ["transfer antar rekening", "transfer bca", "pindah rekening", "tarik tunai"], classification: "INTERNAL_TRANSFER", direction: "MONEY_OUT", businessRelevance: "NON_BUSINESS" },
  { keywords: ["tarik pemilik", "penarikan pemilik", "untuk pribadi", "uang pribadi"], classification: "OWNER_WITHDRAWAL", direction: "MONEY_OUT", businessRelevance: "NON_BUSINESS" },
  { keywords: ["bayar utang", "cicilan pinjaman", "angsuran"], classification: "LOAN_PAYMENT", direction: "MONEY_OUT", businessRelevance: "BUSINESS" },
  { keywords: ["beli laptop", "beli mesin", "beli peralatan", "beli komputer", "beli aset"], classification: "ASSET_PURCHASE", direction: "MONEY_OUT", businessRelevance: "BUSINESS" },
]

/** Score-based rule engine: classification + category + confidence for a description. */
export function classifyTransaction(
  description: string,
  direction: TransactionDirection,
): ClassificationSuggestion {
  const text = normalize(description)
  if (!text) {
    return { categoryId: null, classification: "UNKNOWN", businessRelevance: "UNDETERMINED", confidence: 0.3, source: "RULE" }
  }

  // 1. Non-operational flows win — they should never be counted as revenue/expense.
  for (const rule of NON_OPERATIONAL_RULES) {
    if (rule.direction !== direction) continue
    if (matchKeywords(description, rule.keywords).length > 0) {
      return { categoryId: null, classification: rule.classification, businessRelevance: rule.businessRelevance, confidence: 0.95, source: "RULE" }
    }
  }

  // 2. Category keyword rules (§21).
  const kind = direction === "MONEY_IN" ? "income" : "expense"
  const candidates = ALL_CATEGORIES.filter((category) => category.kind === kind)
  let best: { category: Category; hits: string[] } | null = null
  for (const category of candidates) {
    const hits = matchKeywords(description, category.keywords)
    if (hits.length > (best?.hits.length ?? 0)) best = { category, hits }
  }

  if (best && best.hits.length > 0) {
    // More keyword hits → higher confidence; single generic hit stays below auto-accept.
    const confidence = best.hits.length >= 2 ? 0.93 : 0.88
    return {
      categoryId: best.category.id,
      classification: kind === "income" ? "REVENUE" : "OPERATING_EXPENSE",
      businessRelevance: "BUSINESS",
      confidence,
      source: "RULE",
    }
  }

  // 3. Nothing matched — needs review (exception-based bookkeeping, §3.3).
  return {
    categoryId: null,
    classification: direction === "MONEY_IN" ? "OTHER_INCOME" : "UNKNOWN",
    businessRelevance: "UNDETERMINED",
    confidence: 0.4,
    source: "RULE",
  }
}

// ── Corrections / learning data capture (§25 — storage foundation for Phase 2) ──

export interface LearnedPattern {
  token: string
  categoryId: string | null
  classification: TransactionClassification
  direction: TransactionDirection
  occurrences: number
}

/** Extract the most informative token from a description for pattern storage. */
export function patternToken(description: string): string {
  return normalize(description).replace(/\s+/g, " ").replace(/[0-9.,]+/g, "").trim()
}

/**
 * Derive a suggestion from previously learned user corrections.
 * Confidence grows with occurrences (capped at 0.95) — source HISTORICAL_PATTERN.
 */
export function suggestFromPatterns(
  description: string,
  direction: TransactionDirection,
  patterns: LearnedPattern[],
): ClassificationSuggestion | null {
  const token = patternToken(description)
  if (!token) return null
  const matches = patterns.filter((pattern) => pattern.direction === direction && (token.includes(pattern.token) || pattern.token.includes(token)))
  if (matches.length === 0) return null
  const best = matches.reduce((a, b) => (b.occurrences > a.occurrences ? b : a))
  const confidence = Math.min(0.95, 0.8 + best.occurrences * 0.05)
  return {
    categoryId: best.categoryId,
    classification: best.classification,
    businessRelevance: "BUSINESS",
    confidence,
    source: "HISTORICAL_PATTERN",
  }
}

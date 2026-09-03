// Smart/NLP transaction input per prd.md §14 — stretch item in Phase 1 (ROADMAP §10.3).
// "bayar iklan meta 3jt" → Money Out, Rp3.000.000, Marketing, today.

import { detectDirection } from "./classification"
import type { TransactionDirection } from "./types"
import { toIsoDate } from "./format"

export interface ParsedTransactionInput {
  direction: TransactionDirection
  amount: number | null
  description: string
  transactionDate: string
}

const MULTIPLIERS: Record<string, number> = {
  jt: 1_000_000,
  juta: 1_000_000,
  m: 1_000_000_000,
  miliar: 1_000_000_000,
  rb: 1_000,
  ribu: 1_000,
  k: 1_000,
}

const AMOUNT_PATTERN = /(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|miliar|m|k)\b/i

export function parseAmount(text: string): number | null {
  const match = text.match(AMOUNT_PATTERN)
  if (!match) {
    // Plain number like "150000" or "150.000"
    const plain = text.match(/(?:rp\.?\s*)?(\d[\d.,]*\d|\d)/i)
    if (!plain) return null
    const cleaned = plain[1].replace(/[.\s]/g, "").replace(/,/g, ".")
    const value = Number(cleaned)
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }
  const value = Number(match[1].replace(",", "."))
  if (!Number.isFinite(value)) return null
  const suffix = match[2].toLowerCase()
  return Math.round(value * (MULTIPLIERS[suffix] ?? 1))
}

function parseDate(text: string, now = new Date()): string {
  const lower = text.toLowerCase()
  if (lower.includes("kemarin")) {
    const date = new Date(now)
    date.setDate(date.getDate() - 1)
    return toIsoDate(date)
  }
  return toIsoDate(now)
}

export function parseTransactionInput(raw: string, now = new Date()): ParsedTransactionInput {
  const text = raw.trim()
  const amount = parseAmount(text)
  const transactionDate = parseDate(text, now)

  // Strip amount/date tokens to get a clean description
  let description = text
    .replace(AMOUNT_PATTERN, " ")
    .replace(/\b(rp\.?|hari ini|kemarin)\b/gi, " ")
    .replace(/(\d[\d.,]*\d|\d)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!description) description = text

  const direction = detectDirection(text) ?? "MONEY_OUT"

  return { direction, amount, description, transactionDate }
}

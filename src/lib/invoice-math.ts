import { MAX_INVOICE_ITEMS, MAX_INVOICE_TOTAL, QUANTITY_SCALE, type InvoiceItem, type InvoiceItemInput, type InvoiceTotals } from "./invoice-types"

const MAX_QUANTITY_SCALED = 1_000_000 * QUANTITY_SCALE
const MAX_UNIT_PRICE = 1_000_000_000
const MAX_SAFE = Number.MAX_SAFE_INTEGER

export class InvoiceValidationError extends Error {}

function requireInteger(value: number, label: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new InvoiceValidationError(`${label} tidak valid`)
  }
}

/** Integer half-up division. Both operands must be non-negative safe integers. */
export function divideRoundHalfUp(numerator: number, divisor: number) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(divisor) || numerator < 0 || divisor <= 0) {
    throw new InvoiceValidationError("Nilai perhitungan tidak valid")
  }
  if (numerator > MAX_SAFE - Math.floor(divisor / 2)) throw new InvoiceValidationError("Nilai invoice terlalu besar")
  return Math.floor((numerator + Math.floor(divisor / 2)) / divisor)
}

function checkedMultiply(a: number, b: number) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a !== 0 && b > Math.floor(MAX_SAFE / a)) {
    throw new InvoiceValidationError("Nilai invoice terlalu besar")
  }
  return a * b
}

function checkedAdd(a: number, b: number) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a > MAX_SAFE - b) {
    throw new InvoiceValidationError("Nilai invoice terlalu besar")
  }
  return a + b
}

export function calculateInvoiceItem(input: InvoiceItemInput): InvoiceItem {
  const description = input.description.trim()
  if (!description || description.length > 500) throw new InvoiceValidationError("Deskripsi item wajib diisi dan maksimal 500 karakter")
  if (!input.unitLabel.trim() || input.unitLabel.trim().length > 20) throw new InvoiceValidationError("Satuan item tidak valid")
  requireInteger(input.quantityScaled, "Kuantitas", 1, MAX_QUANTITY_SCALED)
  requireInteger(input.unitPrice, "Harga satuan", 0, MAX_UNIT_PRICE)
  requireInteger(input.sortOrder, "Urutan item", 0, MAX_INVOICE_ITEMS - 1)
  return {
    ...input,
    id: input.id ?? crypto.randomUUID(),
    description,
    unitLabel: input.unitLabel.trim(),
    lineTotal: divideRoundHalfUp(checkedMultiply(input.quantityScaled, input.unitPrice), QUANTITY_SCALE),
  }
}

export function calculateInvoiceTotals(
  rawItems: InvoiceItemInput[],
  discountAmount: number,
  shippingAmount: number,
  taxRateBps: number,
): { items: InvoiceItem[]; totals: InvoiceTotals } {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_INVOICE_ITEMS) {
    throw new InvoiceValidationError(`Invoice harus memiliki 1–${MAX_INVOICE_ITEMS} item`)
  }
  requireInteger(discountAmount, "Diskon", 0, MAX_INVOICE_TOTAL)
  requireInteger(shippingAmount, "Ongkir", 0, MAX_INVOICE_TOTAL)
  requireInteger(taxRateBps, "Tarif pajak", 0, 10_000)
  const items = rawItems.map(calculateInvoiceItem).sort((a, b) => a.sortOrder - b.sortOrder)
  const subtotal = items.reduce((total, item) => checkedAdd(total, item.lineTotal), 0)
  if (discountAmount > subtotal) throw new InvoiceValidationError("Diskon tidak boleh melebihi subtotal")
  const baseAmount = checkedAdd(subtotal - discountAmount, shippingAmount)
  const taxAmount = divideRoundHalfUp(checkedMultiply(baseAmount, taxRateBps), 10_000)
  const grandTotal = checkedAdd(baseAmount, taxAmount)
  if (grandTotal <= 0 || grandTotal > MAX_INVOICE_TOTAL) throw new InvoiceValidationError("Total invoice harus lebih dari nol dan maksimal Rp1 triliun")
  return { items, totals: { subtotal, baseAmount, taxAmount, grandTotal } }
}

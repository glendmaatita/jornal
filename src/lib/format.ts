// Formatting helpers — Indonesian locale, Rupiah currency.
// Grouping/decimal symbols are hardcoded ("." thousands, "," decimals) instead
// of relying on Intl.NumberFormat: ICU versions disagree on currency symbol
// spacing ("Rp150.000" vs "Rp 150.000") and this keeps output deterministic
// across runtimes (bun tests, CI, browsers).

function formatIdNumber(value: number, maxFractionDigits = 0): string {
  const rounded = Number(value.toFixed(maxFractionDigits))
  const [intPart, decPart] = String(rounded).split(".")
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return decPart ? `${grouped},${decPart}` : grouped
}

export function formatRupiah(amount: number): string {
  return `Rp${formatIdNumber(amount)}`
}

export function formatSignedRupiah(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : ""
  return `${sign}Rp${formatIdNumber(Math.abs(amount))}`
}

/** Compact display: Rp45M style used in PRD examples (§34–35) → "Rp45 jt" */
export function formatCompactRupiah(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? "-" : ""
  if (abs >= 1_000_000_000) return `${sign}Rp${trim(formatIdNumber(round(abs / 1_000_000_000, 1), 1))} M`
  if (abs >= 1_000_000) return `${sign}Rp${trim(formatIdNumber(round(abs / 1_000_000, 1), 1))} jt`
  if (abs >= 1_000) return `${sign}Rp${formatIdNumber(round(abs / 1_000, 0))} rb`
  return `${sign}Rp${formatIdNumber(abs)}`
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function trim(value: string) {
  return value.replace(/,0$/, "")
}

/** "Rp1.500.000" / "1500000" → number; tolerant of thousand separators */
export function parseAmountInput(value: string): number {
  if (!value.trim()) return 0
  const cleaned = value.replace(/[^\d]/g, "")
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Format while typing: "1500000" → "1.500.000" */
export function formatNumberInput(value: number | string): string {
  const parsed = typeof value === "number" ? value : parseAmountInput(value)
  return parsed === 0 ? "" : formatIdNumber(parsed)
}

/** Alias used by the custom fields */
export const parseNumberValue = parseAmountInput

const monthNames = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

const weekdayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]

/** "YYYY-MM-DD" → "2 September 2026" */
export function formatDateLong(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  return `${day} ${monthNames[month - 1]} ${year}`
}

/** "YYYY-MM-DD" → "2 Sep 2026" */
export function formatDateShort(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  return `${day} ${monthNamesShort[month - 1]} ${year}`
}

/** "YYYY-MM-DD" → "September 2026" */
export function formatMonthYear(isoDate: string): string {
  const [year, month] = isoDate.split("-").map(Number)
  return `${monthNames[month - 1]} ${year}`
}

/** "YYYY-MM-DD" → "2 Sep" */
export function formatShortDateLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number)
  return `${day} ${monthNamesShort[month - 1]}`
}

export function todayIsoDate(now = new Date()): string {
  return toIsoDate(now)
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/** Group label: "Hari ini", "Kemarin", else "Senin, 1 Sep 2026" */
export function formatGroupLabel(isoDate: string, todayIso = todayIsoDate()): string {
  if (isoDate === todayIso) return "Hari ini"
  const yesterday = new Date(`${todayIso}T00:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  if (isoDate === toIsoDate(yesterday)) return "Kemarin"
  const [year, month, day] = isoDate.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return `${weekdayNames[date.getDay()]}, ${formatDateShort(isoDate)}`
}

export function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/** Month start/end as ISO dates for a "YYYY-MM" string */
export function monthRange(year: number, monthIndex: number): { start: string; end: string } {
  const start = new Date(year, monthIndex, 1)
  const end = new Date(year, monthIndex + 1, 0)
  return { start: toIsoDate(start), end: toIsoDate(end) }
}

/** Months elapsed in the fiscal year (1–12), used for annual projections */
export function monthsElapsedThisYear(now = new Date()): number {
  return now.getMonth() + 1
}

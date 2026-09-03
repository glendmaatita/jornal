// Period helpers (prd.md §10.1)

export interface Period {
  label: string
  start: string // inclusive YYYY-MM-DD
  end: string // inclusive YYYY-MM-DD
}

export type PeriodPreset = "today" | "week" | "month" | "last_month" | "year" | "custom"

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

export function resolvePeriod(preset: PeriodPreset, custom: { start: string; end: string }, now = new Date()): Period {
  const today = toIsoDate(now)
  switch (preset) {
    case "today":
      return { label: "Hari ini", start: today, end: today }
    case "week": {
      const weekday = (now.getDay() + 6) % 7 // Monday-start week
      const start = new Date(now)
      start.setDate(now.getDate() - weekday)
      return { label: "Pekan ini", start: toIsoDate(start), end: today }
    }
    case "month": {
      const start = toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1))
      return { label: `${MONTHS[now.getMonth()]} ${now.getFullYear()}`, start, end: today }
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0)
      return { label: "Bulan lalu", start: toIsoDate(start), end: toIsoDate(end) }
    }
    case "year":
      return { label: String(now.getFullYear()), start: `${now.getFullYear()}-01-01`, end: today }
    case "custom":
      return { label: "Kustom", start: custom.start || today, end: custom.end || today }
  }
}

export function inPeriod(isoDate: string, period: Period): boolean {
  return isoDate >= period.start && isoDate <= period.end
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

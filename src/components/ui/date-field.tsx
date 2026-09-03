import { useEffect, useMemo, useRef, useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { formatDateShort, toIsoDate } from "@/lib/format"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

interface CalendarMonth {
  year: number
  month: number // 0-based
  cells: { iso: string; day: number; outside: boolean }[]
}

function buildMonth(year: number, month: number): CalendarMonth {
  // Monday-start grid
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: CalendarMonth["cells"] = []

  for (let index = 0; index < startOffset; index++) {
    const date = new Date(year, month, -(startOffset - 1 - index))
    cells.push({ iso: toIsoDate(date), day: date.getDate(), outside: true })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: toIsoDate(new Date(year, month, day)), day, outside: false })
  }
  const remaining = (7 - (cells.length % 7)) % 7
  for (let index = 1; index <= remaining; index++) {
    const date = new Date(year, month + 1, index)
    cells.push({ iso: toIsoDate(date), day: date.getDate(), outside: true })
  }
  return { year, month, cells }
}

export interface DateFieldProps {
  label?: string
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  /** Extra label hint for quick picks */
  todayLabel?: string
}

/**
 * Custom date picker — teofin-styled calendar popover, no native date input.
 * Keyboard/AT accessible via plain buttons; closes on outside press.
 */
export function DateField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  disabled,
  todayLabel = "Hari ini",
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const initial = useMemo(() => {
    const [year, month] = (value || toIsoDate(new Date())).split("-").map(Number)
    return { year, month: month - 1 }
  }, [value])
  const [view, setView] = useState(initial)
  const month = useMemo(() => buildMonth(view.year, view.month), [view])
  const todayIso = toIsoDate(new Date())

  // Re-align the visible month with the selected value when opening
  const toggleOpen = () => {
    const [year, month] = (value || toIsoDate(new Date())).split("-").map(Number)
    setView({ year, month: month - 1 })
    setOpen((current) => !current)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const date = new Date(current.year, current.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <FieldShell label={label} error={error} hint={hint} required={required} disabled={disabled} hasValue={!!value} focused={open}>
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className={cn("text-[15px]", !value && "text-[var(--placeholder)]")}>
            {value ? formatDateShort(value) : "Pilih tanggal"}
          </span>
          <CalendarDays className={cn("size-4 shrink-0", open ? "text-[#16579d]" : "text-muted-foreground")} aria-hidden="true" />
        </button>
      </FieldShell>

      {open && (
        <div className="calendar-popover" role="dialog" aria-label="Pilih tanggal">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="Bulan sebelumnya"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-bold">
              {MONTHS[view.month]} {view.year}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
              aria-label="Bulan berikutnya"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="calendar-grid">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="calendar-weekday">
                {weekday}
              </span>
            ))}
            {month.cells.map((cell) => (
              <button
                key={cell.iso}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onChange(cell.iso)
                  setOpen(false)
                  onBlur?.()
                }}
                className={cn(
                  "calendar-day",
                  cell.outside && "calendar-day--outside",
                  cell.iso === todayIso && cell.iso !== value && "calendar-day--today",
                  cell.iso === value && "calendar-day--selected",
                )}
              >
                {cell.day}
              </button>
            ))}
          </div>

          <div className="mt-2 flex justify-end gap-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={() => {
                onChange(todayIso)
                setOpen(false)
                onBlur?.()
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--link)] hover:bg-accent"
            >
              {todayLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useId, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { MONTHS, MONTHS_SHORT } from "@/lib/month-names"
import { useAnchoredPopover } from "@/lib/use-anchored-popover"
import { cn } from "@/lib/utils"

export interface MonthFieldProps {
  label?: string
  /** Accessible name when no visible label is rendered */
  "aria-label"?: string
  value: string // YYYY-MM
  onChange: (value: string) => void
  /** Latest selectable month, YYYY-MM */
  max?: string
  /** Earliest selectable month, YYYY-MM */
  min?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) - 1 }
}

function toMonthValue(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`
}

/** "YYYY-MM" → "September 2026" */
function formatMonthValue(value: string): string {
  const parsed = parseMonth(value)
  return parsed ? `${MONTHS[parsed.month]} ${parsed.year}` : value
}

/**
 * Custom month picker: year stepper plus a 3×4 month grid, no
 * native month input. Shares the field chrome and popover styling
 * with DateField and SelectField.
 */
export function MonthField({
  label,
  "aria-label": ariaLabel,
  value,
  onChange,
  max,
  min,
  error,
  hint,
  required,
  disabled,
  className,
}: MonthFieldProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const today = new Date()
  const current = toMonthValue(today.getFullYear(), today.getMonth())
  const selected = parseMonth(value)
  const [year, setYear] = useState(selected?.year ?? today.getFullYear())

  const { style, placement } = useAnchoredPopover(open, anchorRef, popoverRef, { minWidth: 280 })

  const toggle = () => {
    if (disabled) return
    if (!open) setYear(selected?.year ?? today.getFullYear())
    setOpen((state) => !state)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const isAllowed = (candidate: string) => (!max || candidate <= max) && (!min || candidate >= min)
  const yearHasAllowed = (candidate: number) => (!max || `${candidate}-01` <= max) && (!min || `${candidate}-12` >= min)

  const pick = (month: number) => {
    onChange(toMonthValue(year, month))
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={anchorRef} className={cn("relative w-full", className)}>
      <FieldShell label={label} error={error} hint={hint} required={required} disabled={disabled} hasValue={Boolean(selected)} focused={open}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          disabled={disabled}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left"
          aria-label={ariaLabel ?? label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={Boolean(error)}
        >
          <span className={cn("truncate text-[15px]", !selected && "text-[var(--placeholder)]")}>
            {selected ? formatMonthValue(value) : "Pilih bulan"}
          </span>
          <CalendarRange className={cn("size-4 shrink-0", open ? "text-[#16579d]" : "text-muted-foreground")} aria-hidden="true" />
        </button>
      </FieldShell>

      {open && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={ariaLabel ?? label ?? "Pilih bulan"}
          style={style}
          className={cn("month-popover", placement === "up" && "month-popover--up")}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setYear((state) => state - 1)}
              disabled={!yearHasAllowed(year - 1)}
              className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label="Tahun sebelumnya"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-bold tabular-nums" aria-live="polite">{year}</span>
            <button
              type="button"
              onClick={() => setYear((state) => state + 1)}
              disabled={!yearHasAllowed(year + 1)}
              className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label="Tahun berikutnya"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="month-grid">
            {MONTHS_SHORT.map((short, month) => {
              const candidate = toMonthValue(year, month)
              return (
                <button
                  key={candidate}
                  type="button"
                  disabled={!isAllowed(candidate)}
                  onClick={() => pick(month)}
                  aria-label={`${MONTHS[month]} ${year}`}
                  aria-pressed={candidate === value}
                  className={cn(
                    "month-cell",
                    candidate === current && candidate !== value && "month-cell--current",
                    candidate === value && "month-cell--selected",
                  )}
                >
                  {short}
                </button>
              )
            })}
          </div>

          {isAllowed(current) && (
            <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => {
                  onChange(current)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[var(--link)] hover:bg-accent"
              >
                Bulan ini
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}

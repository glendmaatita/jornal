import { DateField } from "@/components/ui/date-field"
import { cn } from "@/lib/utils"
import type { PeriodPreset } from "@/lib/period"

const PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Hari ini" },
  { value: "week", label: "Pekan ini" },
  { value: "month", label: "Bulan ini" },
  { value: "last_month", label: "Bulan lalu" },
  { value: "year", label: "Tahun ini" },
  { value: "custom", label: "Kustom" },
]

interface PeriodSelectorProps {
  preset: PeriodPreset
  custom: { start: string; end: string }
  onChange: (preset: PeriodPreset) => void
  onCustomChange: (range: { start: string; end: string }) => void
}

export function PeriodSelector({ preset, custom, onChange, onCustomChange }: PeriodSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PRESETS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              preset === option.value
                ? "border-transparent bg-[var(--main-dark)] text-white"
                : "border-border bg-white text-[var(--body-text)]",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DateField
            value={custom.start}
            onChange={(start) => onCustomChange({ ...custom, start })}
            label="Dari"
          />
          <DateField
            value={custom.end}
            onChange={(end) => onCustomChange({ ...custom, end })}
            label="Sampai"
          />
        </div>
      )}
    </div>
  )
}

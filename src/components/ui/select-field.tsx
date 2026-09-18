import { useId, useState } from "react"
import { ChevronDown, type LucideIcon } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  label?: string
  /** Leading icon rendered inside the field chrome */
  icon?: LucideIcon
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Rendered as the first, empty-valued option */
  placeholder?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Native `<select>` wrapped in the shared field chrome — replaces the ad-hoc
 * bordered selects so dropdowns match text and date fields.
 */
export function SelectField({
  label,
  icon,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  required,
  disabled,
  className,
}: SelectFieldProps) {
  const id = useId()
  const [focused, setFocused] = useState(false)

  return (
    <FieldShell
      label={label}
      icon={icon}
      error={error}
      hint={hint}
      required={required}
      disabled={disabled}
      hasValue={value.length > 0}
      focused={focused}
      className={className}
    >
      <select
        id={id}
        aria-label={label}
        aria-invalid={Boolean(error)}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          "min-w-0 flex-1 appearance-none bg-transparent text-[15px] outline-none",
          !value && placeholder && "text-[var(--placeholder)]",
        )}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className={cn("size-4 shrink-0", focused ? "text-[#16579d]" : "text-muted-foreground")} aria-hidden="true" />
    </FieldShell>
  )
}

import { useId, useState } from "react"

import { FieldShell } from "@/components/ui/field-shell"
import { cn } from "@/lib/utils"

export interface TextFieldProps {
  label?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  type?: "text" | "numeric" | "amount"
  placeholder?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  prefix?: string
  /** Amount variant renders the big serif number used in the transaction form */
  size?: "md" | "amount"
  autoFocus?: boolean
  className?: string
  inputClassName?: string
  list?: string
}

/** Formatted display while typing amounts: 1500000 → 1.500.000 */
function formatAmount(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "")
  if (!digits) return ""
  return Number(digits).toLocaleString("id-ID")
}

/**
 * Custom text field in the teofin style — replaces native `<Input>` chrome.
 * `numeric` strips non-digits; `amount` adds live thousand separators + Rp prefix.
 */
export function TextField({
  label,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  error,
  hint,
  required,
  disabled,
  prefix,
  size = "md",
  autoFocus,
  className,
  inputClassName,
  list,
}: TextFieldProps) {
  const id = useId()
  const [focused, setFocused] = useState(false)

  const handleChange = (raw: string) => {
    if (type === "numeric") {
      onChange(raw.replace(/[^\d]/g, ""))
    } else if (type === "amount") {
      onChange(formatAmount(raw))
    } else {
      onChange(raw)
    }
  }

  return (
    <FieldShell
      label={label}
      error={error}
      hint={hint}
      required={required}
      disabled={disabled}
      hasValue={value.length > 0}
      focused={focused}
      className={className}
    >
      {prefix && (
        <span className={cn("shrink-0 font-semibold", size === "amount" ? "text-lg" : "text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {prefix}
        </span>
      )}
      <input
        id={id}
        inputMode={type === "text" ? "text" : "numeric"}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        list={list}
        className={cn(
          "w-full bg-transparent outline-none placeholder:text-[var(--placeholder)]",
          size === "amount" ? "text-2xl font-semibold tabular-nums" : "text-[15px]",
          error && "text-destructive placeholder:text-destructive/50",
          inputClassName,
        )}
      />
      {size === "amount" && value && <span className="shrink-0 text-[11px] font-medium text-muted-foreground">IDR</span>}
    </FieldShell>
  )
}

import { useId, useState } from "react"
import type { LucideIcon } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { cn } from "@/lib/utils"
import { formatAmountEdit, formatNumberInput, parseAmountInput } from "@/lib/format"

export interface TextFieldProps {
  label?: string
  /** Leading icon rendered inside the field chrome */
  icon?: LucideIcon
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  type?: "text" | "numeric" | "amount" | "decimal"
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

/**
 * Custom text field in the teofin style — replaces native `<Input>` chrome.
 * `numeric` strips non-digits; `amount` adds live thousand separators + Rp prefix.
 */
export function TextField({
  label,
  icon,
  value,
  onChange,
  onBlur,
  type = "text",
  placeholder,
  error: providedError,
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
  const error = providedError ?? (type === "amount" && value.trim() && !Number.isSafeInteger(parseAmountInput(value))
    ? "Masukkan nominal rupiah utuh yang valid."
    : undefined)

  const handleChange = (raw: string) => {
    if (type === "numeric") {
      onChange(raw.replace(/[^\d]/g, ""))
    } else if (type === "amount") {
      onChange(formatAmountEdit(raw))
    } else {
      onChange(raw)
    }
  }

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
      {prefix && (
        <span className={cn("shrink-0 font-semibold", size === "amount" ? "text-lg" : "text-sm", error ? "text-destructive" : "text-muted-foreground")}>
          {prefix}
        </span>
      )}
      <input
        id={id}
        inputMode={type === "text" ? "text" : type === "decimal" ? "decimal" : "numeric"}
        value={value}
        onChange={(event) => handleChange(event.target.value)}
        onPaste={(event) => {
          if (type !== "amount") return
          event.preventDefault()
          const input = event.currentTarget
          const next = value.slice(0, input.selectionStart ?? 0) + event.clipboardData.getData("text") + value.slice(input.selectionEnd ?? value.length)
          onChange(formatNumberInput(next))
        }}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        list={list}
        aria-label={label}
        aria-invalid={Boolean(error)}
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

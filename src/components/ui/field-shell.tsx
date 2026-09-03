import * as React from "react"

import { cn } from "@/lib/utils"

export interface FieldShellProps {
  label?: string
  error?: string
  hint?: string
  required?: boolean
  hasValue?: boolean
  focused?: boolean
  disabled?: boolean
  children: React.ReactNode
  className?: string
}

/**
 * Shared field chrome in the teofin style: label above, 50px white wrapper
 * with 10px radius, error/hint below. All custom inputs compose this.
 */
export function FieldShell({
  label,
  error,
  hint,
  required,
  hasValue,
  focused,
  disabled,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn("w-full", disabled && "opacity-60", className)}>
      {label && (
        <span className="field-label">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </span>
      )}
      <div
        className={cn(
          "field-shell",
          hasValue && "field-shell--with-value",
          focused && "field-shell--focus",
          error && "field-shell--error",
          disabled && "field-shell--disabled",
        )}
      >
        {children}
      </div>
      {error ? (
        <span className="field-error" role="alert">
          <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="currentColor" aria-hidden="true">
            <path d="M8 1.5a6.5 6.5 0 1 0 0 12 6.5 6.5 0 0 0 0-12Zm0 3a.9.9 0 0 1 .9.9v2.7a.9.9 0 1 1-1.8 0V5.4A.9.9 0 0 1 8 4.5Zm0 7.2a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
          </svg>
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  )
}

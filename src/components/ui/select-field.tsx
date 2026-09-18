import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, type LucideIcon } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { useAnchoredPopover } from "@/lib/use-anchored-popover"
import { cn } from "@/lib/utils"

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  label?: string
  /** Accessible name when no visible label is rendered */
  "aria-label"?: string
  /** Leading icon rendered inside the field chrome */
  icon?: LucideIcon
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  /** Rendered as the first, empty-valued option and as the trigger text when nothing is chosen */
  placeholder?: string
  error?: string
  hint?: string
  required?: boolean
  disabled?: boolean
  /** `compact` = 40px chrome for inline filters */
  size?: "default" | "compact"
  className?: string
  /** Extra classes on the bordered wrapper (e.g. `!rounded-full`) */
  shellClassName?: string
}

/**
 * Fully custom select: button trigger in the shared field chrome plus a
 * portaled listbox popover styled like the calendar. ARIA 1.2 select-only
 * combobox pattern — focus stays on the trigger, highlight is announced via
 * `aria-activedescendant`.
 */
export function SelectField({
  label,
  "aria-label": ariaLabel,
  icon,
  value,
  onChange,
  options,
  placeholder,
  error,
  hint,
  required,
  disabled,
  size = "default",
  className,
  shellClassName,
}: SelectFieldProps) {
  const id = useId()
  const listboxId = `${id}-listbox`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ text: "", at: 0 })
  const compact = size === "compact"

  const items: SelectOption[] = placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined
  const displayText = selected?.label ?? (value || placeholder || "")
  const isPlaceholder = !value

  const { style, placement } = useAnchoredPopover(open, anchorRef, listRef, { minWidth: compact ? 200 : 0 })

  const openList = () => {
    if (disabled) return
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }
  const closeList = (refocus = true) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }
  const commit = (index: number) => {
    const item = items[index]
    if (item) onChange(item.value)
    closeList()
  }

  // Scroll the highlighted option into view within the list only (never the page).
  // Waits for the measured maxHeight so the list is actually scrollable.
  const measured = style.visibility !== "hidden"
  useLayoutEffect(() => {
    if (!open || !measured) return
    const list = listRef.current
    const option = list?.children[active] as HTMLElement | undefined
    if (!list || !option) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [open, active, measured])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const move = (delta: number) => setActive((current) => Math.min(items.length - 1, Math.max(0, current + delta)))

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault()
        openList()
      }
      return
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break
      case "ArrowUp": event.preventDefault(); move(-1); break
      case "Home": event.preventDefault(); setActive(0); break
      case "End": event.preventDefault(); setActive(items.length - 1); break
      case "Enter":
      case " ": event.preventDefault(); commit(active); break
      case "Escape": event.preventDefault(); closeList(); break
      case "Tab": closeList(false); break
      default: {
        if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
        const now = Date.now()
        const buffer = now - typeahead.current.at < 600 ? typeahead.current.text + event.key : event.key
        typeahead.current = { text: buffer.toLowerCase(), at: now }
        const match = items.findIndex((item) => item.label.toLowerCase().startsWith(typeahead.current.text))
        if (match >= 0) setActive(match)
      }
    }
  }

  return (
    <div ref={anchorRef} className={cn("relative min-w-0", compact ? "w-auto max-w-full" : "w-full", className)}>
      <FieldShell
        label={label}
        icon={icon}
        error={error}
        hint={hint}
        required={required}
        disabled={disabled}
        compact={compact}
        hasValue={value.length > 0}
        focused={open}
        shellClassName={shellClassName}
      >
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${id}-option-${active}` : undefined}
          aria-invalid={Boolean(error)}
          onClick={() => (open ? closeList() : openList())}
          onKeyDown={onKeyDown}
          className="flex w-full min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 overflow-hidden text-left"
        >
          <span className={cn("min-w-0 truncate", compact ? "text-sm" : "text-[15px]", isPlaceholder && "text-[var(--placeholder)]")}>
            {displayText}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 transition-transform duration-150", open ? "rotate-180 text-[#16579d]" : "text-muted-foreground")}
            aria-hidden="true"
          />
        </button>
      </FieldShell>

      {open && createPortal(
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel ?? label}
          style={{ ...style, maxHeight: Math.min(280, Number(style.maxHeight ?? 280)) }}
          className={cn("listbox-popover", placement === "up" && "listbox-popover--up")}
        >
          {items.length === 0 && <div className="listbox-empty">Tidak ada pilihan</div>}
          {items.map((item, index) => {
            const isSelected = item.value === value
            return (
              <div
                key={`${item.value}-${index}`}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => active !== index && setActive(index)}
                onClick={() => commit(index)}
                className={cn(
                  "listbox-option",
                  index === active && "listbox-option--active",
                  isSelected && "listbox-option--selected",
                  item.value === "" && placeholder !== undefined && "listbox-option--placeholder",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {isSelected && <Check className="size-4 shrink-0 text-[#16579d]" aria-hidden="true" />}
              </div>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}

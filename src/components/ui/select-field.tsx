import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Search, type LucideIcon } from "lucide-react"

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
  /** Adds an in-popover search input for options loaded from dynamic data sources. */
  searchable?: boolean
  searchPlaceholder?: string
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
  searchable = false,
  searchPlaceholder,
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
  const [query, setQuery] = useState("")
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ text: "", at: 0 })
  const compact = size === "compact"

  const items: SelectOption[] = placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options
  const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")
  const visibleItems = normalizedQuery
    ? options.filter((item) => item.label.toLocaleLowerCase("id-ID").includes(normalizedQuery))
    : items
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined
  const displayText = selected?.label ?? (value || placeholder || "")
  const isPlaceholder = !value

  const { style, placement } = useAnchoredPopover(open, anchorRef, popoverRef, { minWidth: compact ? 200 : 0 })

  const openList = () => {
    if (disabled) return
    setQuery("")
    setActive(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }
  const closeList = (refocus = true) => {
    setOpen(false)
    setQuery("")
    if (refocus) triggerRef.current?.focus()
  }
  const commit = (index: number) => {
    const item = visibleItems[index]
    if (item) onChange(item.value)
    closeList()
  }

  // Scroll the highlighted option into view within the list only (never the page).
  // Waits for the measured maxHeight so the list is actually scrollable.
  const measured = style.visibility !== "hidden"
  useLayoutEffect(() => {
    if (!open || !measured) return
    const list = listRef.current
    const option = list?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)
    if (!list || !option) return
    const top = option.offsetTop
    const bottom = top + option.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [open, active, measured, visibleItems.length])

  useEffect(() => {
    if (!open || !searchable) return
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, searchable])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  const move = (delta: number) => setActive((current) => Math.min(Math.max(0, visibleItems.length - 1), Math.max(0, current + delta)))

  const onListKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break
      case "ArrowUp": event.preventDefault(); move(-1); break
      case "Home": event.preventDefault(); setActive(0); break
      case "End": event.preventDefault(); setActive(Math.max(0, visibleItems.length - 1)); break
      case "Enter": if (visibleItems.length) { event.preventDefault(); commit(active) } break
      case "Escape": event.preventDefault(); closeList(); break
      case "Tab": closeList(false); break
    }
  }

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
      case " ": event.preventDefault(); commit(active); break
      default: {
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape", "Tab"].includes(event.key)) {
          onListKeyDown(event)
          return
        }
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
          aria-activedescendant={open && visibleItems.length ? `${id}-option-${active}` : undefined}
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
          ref={popoverRef}
          style={{ ...style, maxHeight: Math.min(280, Number(style.maxHeight ?? 280)) }}
          className={cn("listbox-popover", placement === "up" && "listbox-popover--up")}
        >
          {searchable && (
            <div className="listbox-search">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                onKeyDown={onListKeyDown}
                placeholder={searchPlaceholder ?? "Cari pilihan…"}
                aria-label={searchPlaceholder ?? `Cari ${ariaLabel ?? label ?? "pilihan"}`}
                aria-controls={listboxId}
                aria-activedescendant={visibleItems.length ? `${id}-option-${active}` : undefined}
              />
            </div>
          )}
          <div ref={listRef} id={listboxId} role="listbox" aria-label={ariaLabel ?? label} className="listbox-options">
            {visibleItems.length === 0 && <div className="listbox-empty">Tidak ada hasil{query.trim() ? ` untuk “${query.trim()}”` : ""}</div>}
            {visibleItems.map((item, index) => {
              const isSelected = item.value === value
              return (
                <div
                  key={`${item.value}-${index}`}
                  id={`${id}-option-${index}`}
                  data-option-index={index}
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
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { createPortal } from "react-dom"
import { Package } from "lucide-react"

import { FieldShell } from "@/components/ui/field-shell"
import { formatRupiah } from "@/lib/format"
import type { InvoiceProductSuggestion } from "@/lib/invoice-types"
import { useAnchoredPopover } from "@/lib/use-anchored-popover"
import { cn } from "@/lib/utils"

export function InvoiceProductField({
  value,
  suggestions,
  loading,
  onChange,
  onSearch,
  onSelect,
}: {
  value: string
  suggestions: InvoiceProductSuggestion[]
  loading: boolean
  onChange: (value: string) => void
  onSearch: (value: string) => void
  onSelect: (product: InvoiceProductSuggestion) => void
}) {
  const id = useId()
  const listboxId = `${id}-products`
  const anchorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const normalized = value.trim().toLocaleLowerCase("id-ID")
  const visible = useMemo(() => suggestions
    .filter((product) => product.description.toLocaleLowerCase("id-ID").includes(normalized))
    .sort((a, b) => {
      const aStarts = a.description.toLocaleLowerCase("id-ID").startsWith(normalized)
      const bStarts = b.description.toLocaleLowerCase("id-ID").startsWith(normalized)
      return Number(bStarts) - Number(aStarts)
    }), [normalized, suggestions])
  const safeActive = Math.min(active, Math.max(0, visible.length - 1))
  const showPopover = open && normalized.length > 0
  const { style, placement } = useAnchoredPopover(showPopover, anchorRef, popoverRef)

  useEffect(() => {
    if (!showPopover) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [showPopover])

  const choose = (index: number) => {
    const product = visible[index]
    if (!product) return
    onSelect(product)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showPopover) {
      if (event.key === "ArrowDown" && normalized) {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === "ArrowDown" && visible.length) {
      event.preventDefault()
      setActive(Math.min(visible.length - 1, safeActive + 1))
    } else if (event.key === "ArrowUp" && visible.length) {
      event.preventDefault()
      setActive(Math.max(0, safeActive - 1))
    } else if (event.key === "Enter" && visible.length) {
      event.preventDefault()
      choose(safeActive)
    } else if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <>
      <div ref={anchorRef} className="min-w-0">
        <FieldShell label="Produk" icon={Package} hasValue={value.length > 0} focused={focused}>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showPopover}
            aria-controls={showPopover ? listboxId : undefined}
            aria-activedescendant={showPopover && visible.length ? `${id}-product-${safeActive}` : undefined}
            autoComplete="off"
            value={value}
            onChange={(event) => {
              const next = event.target.value
              onChange(next)
              onSearch(next)
              setActive(0)
              setOpen(Boolean(next.trim()))
            }}
            onFocus={() => {
              setFocused(true)
              onSearch(value)
              if (value.trim()) setOpen(true)
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            placeholder="Ketik nama produk"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--placeholder)]"
          />
        </FieldShell>
      </div>
      {showPopover && createPortal(
        <div ref={popoverRef} style={{ ...style, maxHeight: Math.min(280, Number(style.maxHeight ?? 280)) }} className={cn("listbox-popover", placement === "up" && "listbox-popover--up")}>
          <div id={listboxId} role="listbox" aria-label="Saran produk" className="listbox-options">
            {loading && visible.length === 0 && <div className="listbox-empty">Mencari produk…</div>}
            {!loading && visible.length === 0 && <div className="listbox-empty">Belum ada produk yang cocok</div>}
            {visible.map((product, index) => (
              <div
                key={`${product.description}-${product.unitLabel}-${product.unitPrice}`}
                id={`${id}-product-${index}`}
                role="option"
                aria-selected={index === safeActive}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
                className={cn("listbox-option items-start", index === safeActive && "listbox-option--active")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{product.description}</span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">{product.unitLabel} · {formatRupiah(product.unitPrice)} / unit</span>
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

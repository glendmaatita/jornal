import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

/** A4 width at CSS 96dpi (210mm), matching `.invoice-paper`. */
const PAPER_WIDTH = 794

/**
 * Scales the fixed-width A4 invoice paper down so it always fits the
 * available width (phones show the whole page instead of a cut-off corner).
 * The wrapper reserves the scaled height so content below does not shift.
 * Only the on-screen embedding is affected; print and export use the
 * untransformed `[data-invoice-document]` element.
 */
export function InvoicePaperFit({ children, className }: { children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState<number | undefined>(undefined)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const update = () => {
      const available = outer.clientWidth
      const next = available > 0 ? Math.min(1, available / PAPER_WIDTH) : 1
      setScale(next)
      setHeight(inner.offsetHeight * next)
    }
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={outerRef} className={className} style={{ height }}>
      <div ref={innerRef} style={{ width: PAPER_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  )
}

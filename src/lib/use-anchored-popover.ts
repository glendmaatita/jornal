import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react"

export type PopoverPlacement = "down" | "up"

interface AnchoredPosition {
  style: CSSProperties
  placement: PopoverPlacement
}

const GAP = 6
const VIEWPORT_MARGIN = 8
/** Off-flow placeholder for the first paint, before the anchor has been measured */
const HIDDEN: AnchoredPosition = { style: { position: "fixed", top: 0, left: 0, visibility: "hidden" }, placement: "down" }

function sameStyle(a: CSSProperties, b: CSSProperties): boolean {
  return a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.width === b.width && a.maxHeight === b.maxHeight && a.visibility === b.visibility
}

/**
 * Computes a `position: fixed` box for a popover anchored to `anchorRef`.
 * Opens below the anchor; flips upward when it would overflow the viewport
 * bottom and there is more room above. Re-measures on scroll and resize so
 * the layer never drifts away from its trigger.
 */
export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  options: { minWidth?: number; matchWidth?: boolean } = {},
): AnchoredPosition {
  const { minWidth = 0, matchWidth = true } = options
  const [position, setPosition] = useState<AnchoredPosition>(HIDDEN)

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return
      const rect = anchor.getBoundingClientRect()
      const height = popover.offsetHeight
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_MARGIN
      const spaceAbove = rect.top - VIEWPORT_MARGIN
      const placement: PopoverPlacement = height + GAP > spaceBelow && spaceAbove > spaceBelow ? "up" : "down"

      const width = Math.max(matchWidth ? rect.width : 0, minWidth)
      const maxWidth = viewportWidth - VIEWPORT_MARGIN * 2
      const finalWidth = Math.min(width, maxWidth)
      const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), viewportWidth - VIEWPORT_MARGIN - finalWidth)

      const style: CSSProperties = { position: "fixed", left, width: finalWidth, maxHeight: Math.max(120, placement === "up" ? spaceAbove - GAP : spaceBelow - GAP) }
      if (placement === "up") style.bottom = viewportHeight - rect.top + GAP
      else style.top = rect.bottom + GAP
      // Skip identical updates so the popover's own scroll events never re-render it
      setPosition((previous) => (previous.placement === placement && sameStyle(previous.style, style) ? previous : { style, placement }))
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
      setPosition(HIDDEN)
    }
  }, [open, anchorRef, popoverRef, minWidth, matchWidth])

  return position
}


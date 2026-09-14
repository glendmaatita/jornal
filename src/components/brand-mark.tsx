import logo from "@/assets/jornal-logo.svg"
import { cn } from "@/lib/utils"

/** Decorative mark; the adjacent wordmark provides the accessible brand name. */
export function BrandMark({ className }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden="true" width={64} height={64} className={cn("block shrink-0", className)} />
}

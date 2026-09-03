import * as React from "react"

import { cn } from "@/lib/utils"

export function Badge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border/70 bg-secondary/70 px-2.5 py-1 text-xs font-medium text-secondary-foreground",
        className,
      )}
      {...props}
    />
  )
}

import { Link } from "@tanstack/react-router"
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, HelpCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatRupiah, formatDateShort } from "@/lib/format"
import { categoryName } from "@/lib/categories"
import { CLASSIFICATION_LABELS, type Transaction } from "@/lib/types"
import { cn } from "@/lib/utils"

export function TransactionItem({ transaction }: { transaction: Transaction }) {
  const isTransfer = transaction.classification === "INTERNAL_TRANSFER"
  const Icon = isTransfer ? ArrowLeftRight : transaction.direction === "MONEY_IN" ? ArrowDownLeft : ArrowUpRight
  const needsReview = transaction.reviewStatus === "NEEDS_REVIEW"
  const amountColor = isTransfer
    ? "text-foreground"
    : transaction.direction === "MONEY_IN"
      ? "money-in"
      : "text-foreground"

  return (
    <Link
      to="/transactions/$transactionId"
      params={{ transactionId: transaction.id }}
      className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent/60"
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          isTransfer ? "bg-secondary" : transaction.direction === "MONEY_IN" ? "bg-[color-mix(in_oklab,var(--mint)_16%,white)]" : "bg-secondary",
        )}
      >
        <Icon className={cn("size-4", transaction.direction === "MONEY_IN" && !isTransfer && "money-in")} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{transaction.description || "(tanpa deskripsi)"}</span>
          {needsReview && <HelpCircle className="size-3.5 shrink-0 text-amber-600" aria-label="Perlu konfirmasi" />}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{categoryName(transaction.categoryId)}</span>
          <span aria-hidden="true">·</span>
          <span>{CLASSIFICATION_LABELS[transaction.classification]}</span>
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={cn("block text-sm font-semibold tabular-nums", amountColor)}>
          {isTransfer ? "" : transaction.direction === "MONEY_IN" ? "+" : "−"}
          {formatRupiah(transaction.amount)}
        </span>
        <span className="block text-xs text-muted-foreground">{formatDateShort(transaction.transactionDate)}</span>
      </span>
    </Link>
  )
}

export function ConfidenceBadge({ status }: { status: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" }) {
  const config = {
    HIGH_CONFIDENCE: { label: "Keyakinan data: Tinggi", className: "bg-[color-mix(in_oklab,var(--mint)_16%,white)] text-[var(--mint)]" },
    MEDIUM_CONFIDENCE: { label: "Keyakinan data: Sedang", className: "bg-amber-100 text-amber-800 border-amber-200" },
    LOW_CONFIDENCE: { label: "Keyakinan data: Rendah", className: "bg-red-100 text-red-800 border-red-200" },
  }[status]
  return <Badge className={config.className}>{config.label}</Badge>
}

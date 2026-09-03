import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Search, ShieldQuestion } from "lucide-react"

import { TransactionItem } from "@/components/transaction-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { TextField } from "@/components/ui/text-field"
import { categoriesForKind } from "@/lib/categories"
import { formatGroupLabel, todayIsoDate } from "@/lib/format"
import { queryKeys, useTransactions } from "@/lib/queries"
import { resolveReview } from "@/lib/store"
import type { TransactionClassification, TransactionDirection } from "@/lib/types"
import { CLASSIFICATION_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

const QUICK_CLASSIFICATIONS_IN: TransactionClassification[] = [
  "REVENUE",
  "CAPITAL_INJECTION",
  "LOAN_RECEIVED",
  "REFUND",
  "OTHER_INCOME",
]

const QUICK_CLASSIFICATIONS_OUT: TransactionClassification[] = [
  "OPERATING_EXPENSE",
  "OWNER_WITHDRAWAL",
  "ASSET_PURCHASE",
  "LOAN_PAYMENT",
  "TAX_PAYMENT",
  "OTHER_OUTFLOW",
]

function defaultCategoryForReview(classification: TransactionClassification): string | null {
  switch (classification) {
    case "OPERATING_EXPENSE":
      return categoriesForKind("expense").at(-1)?.id ?? null
    case "TAX_PAYMENT":
      return "exp-tax"
    case "REVENUE":
      return categoriesForKind("income")[0]?.id ?? null
    case "OTHER_INCOME":
      return "inc-other-income"
    case "OTHER_OUTFLOW":
      return "exp-other"
    default:
      return null
  }
}

export function TransactionsPage() {
  const search = useSearch({ from: "/transactions" }) as { filter?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()

  const [query, setQuery] = useState("")
  const [direction, setDirection] = useState<TransactionDirection | "">("")
  const [categoryId, setCategoryId] = useState<string>("")
  const [classification, setClassification] = useState<TransactionClassification | "">("")
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null)
  const [amountRange, setAmountRange] = useState<{ min: string; max: string } | null>(null)
  const [reviewOnly, setReviewOnly] = useState(false)

  const isReviewMode = search.filter === "review"

  const filtered = useMemo(() => {
    let result = transactions
    if (isReviewMode) {
      result = result.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW")
    } else if (reviewOnly) {
      result = result.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW")
    }
    if (direction) {
      result = result.filter((transaction) => transaction.direction === direction && transaction.classification !== "INTERNAL_TRANSFER")
    }
    if (categoryId) {
      result = result.filter((transaction) => transaction.categoryId === categoryId)
    }
    if (classification) {
      result = result.filter((transaction) => transaction.classification === classification)
    }
    if (dateRange) {
      if (dateRange.start) result = result.filter((transaction) => transaction.transactionDate >= dateRange.start)
      if (dateRange.end) result = result.filter((transaction) => transaction.transactionDate <= dateRange.end)
    }
    if (amountRange) {
      const min = Number(amountRange.min.replace(/[^\d]/g, ""))
      const max = Number(amountRange.max.replace(/[^\d]/g, ""))
      if (min > 0) result = result.filter((transaction) => transaction.amount >= min)
      if (max > 0) result = result.filter((transaction) => transaction.amount <= max)
    }
    if (query.trim()) {
      const text = query.trim().toLowerCase()
      result = result.filter(
        (transaction) =>
          transaction.description.toLowerCase().includes(text) ||
          String(transaction.amount).includes(text) ||
          formatGroupLabel(transaction.transactionDate).toLowerCase().includes(text),
      )
    }
    return result.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt))
  }, [transactions, isReviewMode, reviewOnly, direction, categoryId, classification, dateRange, amountRange, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof filtered>()
    for (const transaction of filtered) {
      const list = groups.get(transaction.transactionDate) ?? []
      list.push(transaction)
      groups.set(transaction.transactionDate, list)
    }
    return [...groups.entries()]
  }, [filtered])

  const reviewItems = useMemo(
    () => transactions.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW"),
    [transactions],
  )

  const resolve = useMutation({
    mutationFn: ({ id, classification }: { id: string; classification: TransactionClassification }) => {
      const categoryId = defaultCategoryForReview(classification)
      return Promise.resolve(resolveReview(id, classification, categoryId))
    },
    onSuccess: () => {
      for (const key of [queryKeys.transactions, queryKeys.corrections]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  return (
    <div className="space-y-3 pb-8">
      {/* Review queue banner (§24) */}
      {reviewItems.length > 0 && !isReviewMode && (
        <button
          type="button"
          onClick={() => void navigate({ to: "/transactions", search: { filter: "review" } })}
          className="flex w-full items-center gap-3 rounded-2xl border border-amber-300/70 bg-amber-50 p-4 text-left"
        >
          <ShieldQuestion className="size-5 shrink-0 text-amber-700" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium text-amber-900">
            Butuh Konfirmasi · {reviewItems.length} transaksi
          </span>
          <Badge className="bg-amber-200 text-amber-900">{reviewItems.length}</Badge>
        </button>
      )}
      {isReviewMode && (
        <div className="flex items-center justify-between">
          <h1 className="text-xl">Butuh Konfirmasi</h1>
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/transactions" })}>
            Tutup
          </Button>
        </div>
      )}

      {!isReviewMode && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[var(--placeholder)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari deskripsi atau nominal…"
              className="field-shell h-[50px] w-full !py-0 pl-10 text-[15px] outline-none placeholder:text-[var(--placeholder)]"
            />
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterChip active={direction === ""} onClick={() => setDirection("")}>Semua</FilterChip>
            <FilterChip active={direction === "MONEY_IN"} onClick={() => setDirection(direction === "MONEY_IN" ? "" : "MONEY_IN")}>Masuk</FilterChip>
            <FilterChip active={direction === "MONEY_OUT"} onClick={() => setDirection(direction === "MONEY_OUT" ? "" : "MONEY_OUT")}>Keluar</FilterChip>
            <select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="h-8 shrink-0 rounded-full border border-border bg-card px-3 text-xs"
              aria-label="Filter kategori"
            >
              <option value="">Semua kategori</option>
              {categoriesForKind("income").map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
              {categoriesForKind("expense").map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
            <select
              value={classification}
              onChange={(event) => setClassification(event.target.value as TransactionClassification | "")}
              className="h-8 shrink-0 rounded-full border border-border bg-card px-3 text-xs"
              aria-label="Filter klasifikasi"
            >
              <option value="">Semua klasifikasi</option>
              {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <FilterChip active={dateRange !== null} onClick={() => setDateRange(dateRange ? null : { start: "", end: "" })}>
              Tanggal
            </FilterChip>
            <FilterChip active={amountRange !== null} onClick={() => setAmountRange(amountRange ? null : { min: "", max: "" })}>
              Nominal
            </FilterChip>
            <FilterChip active={reviewOnly} onClick={() => setReviewOnly(!reviewOnly)}>Perlu Review</FilterChip>
          </div>

          {dateRange && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DateField value={dateRange.start} onChange={(start) => setDateRange({ ...dateRange, start })} label="Dari tanggal" />
              <DateField value={dateRange.end} onChange={(end) => setDateRange({ ...dateRange, end })} label="Sampai tanggal" />
            </div>
          )}
          {amountRange && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextField label="Nominal min" type="numeric" prefix="Rp" value={amountRange.min} onChange={(min) => setAmountRange({ ...amountRange, min })} />
              <TextField label="Nominal maks" type="numeric" prefix="Rp" value={amountRange.max} onChange={(max) => setAmountRange({ ...amountRange, max })} />
            </div>
          )}
        </>
      )}

      {isReviewMode && reviewItems.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Tidak ada transaksi yang perlu dikonfirmasi. 🎉
          </CardContent>
        </Card>
      )}

      {isReviewMode && reviewItems.length > 0 && (
        <div className="space-y-3">
          {reviewItems.map((transaction) => (
            <ReviewCard
              key={transaction.id}
              transaction={transaction}
              onResolve={(classification) => resolve.mutate({ id: transaction.id, classification })}
            />
          ))}
        </div>
      )}

      {!isReviewMode &&
        grouped.map(([date, items]) => (
          <section key={date}>
            <h2 className="mb-1 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {formatGroupLabel(date, todayIsoDate())}
            </h2>
            <Card>
              <CardContent className="divide-y divide-border/40 p-2">
                {items.map((transaction) => (
                  <TransactionItem key={transaction.id} transaction={transaction} />
                ))}
              </CardContent>
            </Card>
          </section>
        ))}

      {!isReviewMode && filtered.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-muted-foreground">Tidak ada transaksi yang cocok.</p>
            <Link to="/add" className={cn("mt-3 inline-block text-sm font-medium text-primary underline")}>
              Catat transaksi
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ReviewCard({
  transaction,
  onResolve,
}: {
  transaction: { id: string; amount: number; description: string; transactionDate: string; direction: TransactionDirection }
  onResolve: (classification: TransactionClassification) => void
}) {
  const quickClassifications = transaction.direction === "MONEY_IN" ? QUICK_CLASSIFICATIONS_IN : QUICK_CLASSIFICATIONS_OUT
  return (
    <Card className="border-amber-300/70">
      <CardContent className="p-4">
        <p className="text-lg font-semibold tabular-nums">Rp{transaction.amount.toLocaleString("id-ID")}</p>
        <p className="text-sm text-muted-foreground">{transaction.description || "(tanpa deskripsi)"}</p>
        <p className="mt-1 text-xs text-amber-800">Ini transaksi apa?</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {quickClassifications.map((classification) => (
            <Button key={classification} variant="outline" size="sm" onClick={() => onResolve(classification)}>
              {CLASSIFICATION_LABELS[classification]}
            </Button>
          ))}
        </div>
        <Link
          to="/transactions/$transactionId"
          params={{ transactionId: transaction.id }}
          className="mt-2 block text-center text-xs text-muted-foreground underline"
        >
          Buka detail & edit manual
        </Link>
      </CardContent>
    </Card>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

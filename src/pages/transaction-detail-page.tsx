import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Copy, Pencil, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { categoryName } from "@/lib/categories"
import { formatRupiah, formatDateLong } from "@/lib/format"
import { queryKeys, useAccountMap, useTransactions } from "@/lib/queries"
import { deleteTransaction, duplicateTransaction } from "@/lib/store"
import { TAX_TREATMENTS } from "@/lib/tax"
import { CLASSIFICATION_LABELS, type Transaction } from "@/lib/types"

export function TransactionDetailPage({ transactionId }: { transactionId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()
  const accountMap = useAccountMap()

  const transaction = transactions.find((candidate) => candidate.id === transactionId)

  const remove = useMutation({
    mutationFn: async () => deleteTransaction(transactionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      void navigate({ to: "/transactions" })
    },
  })

  const duplicate = useMutation({
    mutationFn: async () => duplicateTransaction(transactionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      void navigate({ to: "/transactions" })
    },
  })

  if (!transaction) {
    return (
      <Card className="mt-8 border-dashed">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground">Transaksi tidak ditemukan.</p>
          <Link to="/transactions" className={buttonClasses()}>
            <ArrowLeft aria-hidden="true" />
            Semua transaksi
          </Link>
        </CardContent>
      </Card>
    )
  }

  const account = transaction.accountId ? accountMap.get(transaction.accountId) : null
  const transferTo = transaction.transferAccountId ? accountMap.get(transaction.transferAccountId) : null

  return (
    <div className="pb-8">
      <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
        <ArrowLeft aria-hidden="true" />
        Kembali
      </Button>

      <Card className="mt-3">
        <CardContent className="p-6">
          <p
            className={`text-4xl font-semibold tracking-tight tabular-nums ${
              transaction.direction === "MONEY_IN" && transaction.classification !== "INTERNAL_TRANSFER" ? "money-in" : ""
            }`}
          >
            {transaction.classification !== "INTERNAL_TRANSFER" && (transaction.direction === "MONEY_IN" ? "+" : "−")}
            {formatRupiah(transaction.amount)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{transaction.direction === "MONEY_IN" ? "Uang Masuk" : "Uang Keluar"}</Badge>
            <Badge>{CLASSIFICATION_LABELS[transaction.classification]}</Badge>
            {transaction.reviewStatus === "NEEDS_REVIEW" && <Badge className="bg-red-100 text-red-800">Butuh konfirmasi</Badge>}
          </div>
          <h1 className="mt-4 text-2xl tracking-tight">{transaction.description || "(tanpa deskripsi)"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateLong(transaction.transactionDate)}</p>

          <dl className="mt-6 space-y-3 border-t border-border/60 pt-4 text-sm">
            <DetailRow label="Kategori" value={categoryName(transaction.categoryId)} />
            {account && <DetailRow label="Akun" value={transferTo ? `${account.name} → ${transferTo.name}` : account.name} />}
            {transaction.paymentMethod && <DetailRow label="Metode" value={transaction.paymentMethod} />}
            {transaction.supplierCustomer && <DetailRow label="Supplier / Customer" value={transaction.supplierCustomer} />}
            {transaction.tags && <DetailRow label="Tag" value={transaction.tags} />}
            <DetailRow label="Klasifikasi internal" value={CLASSIFICATION_LABELS[transaction.classification]} />
            <DetailRow label="Klasifikasi pajak" value={CLASSIFICATION_LABELS[transaction.taxClassification]} />
            {transaction.classificationConfidence !== null && (
              <DetailRow label="Keyakinan klasifikasi" value={`${Math.round(transaction.classificationConfidence * 100)}% (${sourceLabel(transaction.classificationSource)})`} />
            )}
            {transaction.notes && <DetailRow label="Catatan" value={transaction.notes} />}
            {transaction.attachmentName && (
              <div className="flex gap-3">
                <dt className="w-36 shrink-0 text-muted-foreground">Lampiran</dt>
                <dd className="flex-1">
                  {transaction.attachmentDataUrl ? (
                    <a href={transaction.attachmentDataUrl} download={transaction.attachmentName} className="text-primary underline">
                      {transaction.attachmentName}
                    </a>
                  ) : (
                    transaction.attachmentName
                  )}
                </dd>
              </div>
            )}
            <div className="flex gap-3 pt-1">
              <dt className="w-36 shrink-0 text-muted-foreground">Perlakuan pajak</dt>
              <dd className="flex-1 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed">
                {TAX_TREATMENTS[transaction.taxClassification]}
              </dd>
            </div>
          </dl>

          <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Link to="/transactions/$transactionId/edit" params={{ transactionId: transaction.id }} className={buttonClasses()}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
            <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}>
              <Copy aria-hidden="true" />
              Duplikat
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => {
                if (window.confirm("Hapus transaksi ini? Tidak bisa dibatalkan.")) remove.mutate()
              }}
              disabled={remove.isPending}
            >
              <Trash2 aria-hidden="true" />
              Hapus
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
      <dt className="sm:w-36 sm:shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex-1">{value}</dd>
    </div>
  )
}

function sourceLabel(source: Transaction["classificationSource"]) {
  return { USER: "pilihan Anda", RULE: "aturan", AI: "AI", HISTORICAL_PATTERN: "pola Anda", SYSTEM: "sistem" }[source]
}

function buttonClasses() {
  return "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border bg-background/80 text-sm font-medium hover:bg-accent"
}

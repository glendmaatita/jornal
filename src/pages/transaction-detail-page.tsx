import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Copy, Pencil, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppDialog } from "@/components/ui/app-dialog-context"
import { Card, CardContent } from "@/components/ui/card"
import { AttachmentPreview } from "@/components/attachment-preview"
import { categoryName } from "@/lib/categories"
import { formatRupiah, formatDateLong, formatInvoiceNumber } from "@/lib/format"
import { getInvoice } from "@/lib/invoice-client"
import { paymentMethodLabel } from "@/lib/payment-method"
import { queryKeys, useAccountMap, useTransactions } from "@/lib/queries"
import { deleteTransaction, duplicateTransaction, isCompanyWritable } from "@/lib/store"
import { TAX_TREATMENTS } from "@/lib/tax"
import { CLASSIFICATION_LABELS, type Transaction } from "@/lib/types"
import { useAttachmentUrl } from "@/lib/use-attachment-url"

export function TransactionDetailPage({ transactionId }: { transactionId: string }) {
  const dialog = useAppDialog()
  const writable = isCompanyWritable()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()
  const accountMap = useAccountMap()

  const transaction = transactions.find((candidate) => candidate.id === transactionId)
  const attachmentUrl = useAttachmentUrl(transaction?.attachmentDataUrl, transaction?.attachmentRemoteUrl)
  const invoiceId = transaction?.relatedInvoiceId ?? transaction?.invoiceId ?? null
  const relatedInvoice = useQuery({
    queryKey: ["invoice", "detail", invoiceId],
    queryFn: () => getInvoice(invoiceId!),
    enabled: Boolean(invoiceId),
  })

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
            {transaction.paymentMethod && <DetailRow label="Metode" value={paymentMethodLabel(transaction.paymentMethod)} />}
            {transaction.supplierCustomer && <DetailRow label="Supplier / Customer" value={transaction.supplierCustomer} />}
            {invoiceId && (
              <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-3">
                <dt className="text-muted-foreground sm:w-36 sm:shrink-0">{transaction.relatedInvoiceId ? "Invoice terkait" : "Pembayaran invoice"}</dt>
                <dd className="min-w-0 flex-1"><Link to="/invoices/$invoiceId" params={{ invoiceId }} className="break-all font-medium text-primary underline">
                  {relatedInvoice.data?.invoice ? formatInvoiceNumber(relatedInvoice.data.invoice.invoiceNumber, relatedInvoice.data.invoice.sequence, relatedInvoice.data.invoice.issueDate) || "Draft invoice" : transaction.invoiceNumber || "Lihat invoice"}
                </Link></dd>
              </div>
            )}
            {transaction.classification === "RECEIVABLE_CREATED" && transaction.receivableDueDate && <DetailRow label="Jatuh tempo piutang" value={formatDateLong(transaction.receivableDueDate)} />}
            {transaction.classification === "RECEIVABLE_PAYMENT" && transaction.receivableTransactionId && (
              <div className="flex gap-3"><dt className="w-36 shrink-0 text-muted-foreground">Untuk piutang</dt><dd><Link to="/transactions/$transactionId" params={{ transactionId: transaction.receivableTransactionId }} className="text-primary underline">Lihat piutang asal</Link></dd></div>
            )}
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
                <dd className="min-w-0 flex-1">
                  {attachmentUrl ? (
                    <>
                      <a href={attachmentUrl} download={transaction.attachmentName} className="break-all text-primary underline">{transaction.attachmentName}</a>
                      <AttachmentPreview name={transaction.attachmentName} url={attachmentUrl} />
                    </>
                  ) : (
                    transaction.attachmentName
                  )}
                </dd>
              </div>
            )}
            <div className="flex flex-col gap-1.5 pt-1 sm:flex-row sm:gap-3">
              <dt className="text-muted-foreground sm:w-36 sm:shrink-0">Perlakuan pajak</dt>
              <dd className="flex-1 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed">
                {TAX_TREATMENTS[transaction.taxClassification]}
              </dd>
            </div>
          </dl>

          {writable && <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              onClick={() => void dialog.confirm({
                title: "Hapus transaksi?",
                description: "Transaksi ini akan dihapus dan tidak dapat dipulihkan.",
                confirmLabel: "Hapus transaksi",
                tone: "destructive",
              }).then((confirmed) => { if (confirmed) remove.mutate() })}
              disabled={remove.isPending}
            >
              <Trash2 aria-hidden="true" />
              Hapus
            </Button>
          </div>}
          {transaction.classification === "RECEIVABLE_CREATED" && (
            <Link to="/receivables" className="mt-3 block text-center text-sm font-semibold text-[var(--link)]">Lihat status piutang</Link>
          )}
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

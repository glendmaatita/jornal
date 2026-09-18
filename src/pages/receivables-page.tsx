import { Link } from "@tanstack/react-router"
import { ArrowLeft, CalendarClock, CircleCheck, HandCoins, Plus, Receipt } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatDateShort, formatRupiah, todayIsoDate } from "@/lib/format"
import { useTransactions } from "@/lib/queries"
import { receivablesFromTransactions } from "@/lib/receivables"
import { isCompanyWritable } from "@/lib/store"

export function ReceivablesPage() {
  const { data: transactions = [] } = useTransactions()
  const receivables = receivablesFromTransactions(transactions)
  const open = receivables.filter((item) => item.outstanding > 0)
  const total = open.reduce((sum, item) => sum + item.outstanding, 0)
  const today = todayIsoDate()
  const writable = isCompanyWritable()

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}><ArrowLeft aria-hidden="true" />Kembali</Button>
        {writable && <Link to="/add" search={{ receivable: "new" }} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--main-dark)] px-3 text-sm font-semibold text-white"><Plus className="size-4" />Piutang baru</Link>}
      </div>
      <Card className="border-[#e2a9cb]/60 bg-[var(--main-dark)] text-white">
        <CardContent className="p-5"><p className="flex items-center gap-1.5 text-xs font-semibold tracking-[1.5px] text-white/70 uppercase"><HandCoins className="size-4" aria-hidden="true" />Total piutang berjalan</p><p className="mt-1 text-3xl font-bold tabular-nums">{formatRupiah(total)}</p><p className="mt-1 text-xs text-white/70">{open.length} orang/transaksi masih menunggak</p></CardContent>
      </Card>
      {receivables.length === 0 ? <Card className="border-dashed"><CardContent className="p-8 text-center"><HandCoins className="mx-auto mb-2 size-7 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">Belum ada piutang.</p>{writable && <Link to="/add" search={{ receivable: "new" }} className="mt-3 inline-block text-sm font-semibold text-[var(--link)]">Catat uang yang dipinjamkan</Link>}</CardContent></Card> : (
        <Card><CardContent className="divide-y divide-border/70 p-0">{receivables.map(({ transaction, paid, outstanding }) => {
          const overdue = outstanding > 0 && Boolean(transaction.receivableDueDate && transaction.receivableDueDate < today)
          return <div key={transaction.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><Link to="/transactions/$transactionId" params={{ transactionId: transaction.id }} className="font-semibold hover:underline">{transaction.supplierCustomer || transaction.description}</Link><p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">Dipinjamkan {formatDateShort(transaction.transactionDate)}{transaction.receivableDueDate ? <span className={overdue ? "inline-flex items-center gap-1 font-semibold text-red-600" : "inline-flex items-center gap-1"}>· <CalendarClock className="size-3" aria-hidden="true" />jatuh tempo {formatDateShort(transaction.receivableDueDate)}</span> : null}</p></div><p className={overdue ? "inline-flex items-center gap-1 text-sm font-bold text-red-600" : "inline-flex items-center gap-1 text-sm font-bold text-[var(--main-dark)]"}>{outstanding > 0 ? formatRupiah(outstanding) : <><CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />Lunas</>}</p></div><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>Dibayar {formatRupiah(paid)} dari {formatRupiah(transaction.amount)}</span>{writable && outstanding > 0 && <Link to="/add" search={{ receivable: transaction.id }} className="inline-flex items-center gap-1 font-semibold text-[var(--link)]"><Receipt className="size-3.5" aria-hidden="true" />Catat pembayaran</Link>}</div></div>
        })}</CardContent></Card>
      )}
    </div>
  )
}

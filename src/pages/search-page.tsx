import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, FileText, Paperclip, Receipt, Search, SearchX, User, type LucideIcon } from "lucide-react"

import { TextField } from "@/components/ui/text-field"
import { listCustomers, listInvoices } from "@/lib/invoice-client"
import { useTransactions } from "@/lib/queries"
import { formatInvoiceNumber, formatRupiah } from "@/lib/format"
import { searchDocuments } from "@/lib/document-client"

const rowClass = "flex items-center gap-3 rounded-xl border bg-white p-3"

/** Inner layout of a search hit; the caller supplies the typed router `Link`. */
function ResultRow({ icon: Icon, kind, title, amount }: { icon: LucideIcon; kind: string; title: string; amount?: number }) {
  return (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#f1f5fd] text-[#16579d]"><Icon className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{kind}</span>
        <span className="block truncate text-sm font-medium">{title}</span>
      </span>
      {amount !== undefined ? <strong className="shrink-0 tabular-nums">{formatRupiah(amount)}</strong> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
    </>
  )
}

export function SearchPage() {
  const [search, setSearch] = useState("")
  const customers = useQuery({ queryKey: ["search", "customers", search], queryFn: () => listCustomers({ search, perPage: 10 }), enabled: search.length >= 2 })
  const invoices = useQuery({ queryKey: ["search", "invoices", search], queryFn: () => listInvoices({ search, perPage: 10 }), enabled: search.length >= 2 })
  const documents = useQuery({ queryKey: ["search", "documents", search], queryFn: () => searchDocuments(search), enabled: search.length >= 2 })
  const { data: transactions = [] } = useTransactions()
  const local = useMemo(
    () => search.length < 2 ? [] : transactions.filter((item) => [item.description, item.supplierCustomer, item.notes].some((value) => value?.toLowerCase().includes(search.toLowerCase()))).slice(0, 10),
    [transactions, search],
  )
  const total = local.length + (customers.data?.items.length ?? 0) + (invoices.data?.items.length ?? 0) + (documents.data?.items.length ?? 0)
  const settled = search.length >= 2 && !customers.isFetching && !invoices.isFetching && !documents.isFetching

  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl"><Search className="size-5 text-primary" aria-hidden="true" />Pencarian</h1>
        <p className="text-sm text-muted-foreground">Transaksi, pelanggan, invoice, dan dokumen dalam company aktif.</p>
      </header>
      <TextField label="Cari minimal 2 karakter" icon={Search} value={search} onChange={setSearch} placeholder="Nama, deskripsi, nomor invoice…" autoFocus />
      {local.map((item) => <Link key={item.id} to="/transactions/$transactionId" params={{ transactionId: item.id }} className={rowClass}><ResultRow icon={Receipt} kind="Transaksi" title={item.description} amount={item.amount} /></Link>)}
      {customers.data?.items.map((item) => <Link key={item.id} to="/customers/$customerId" params={{ customerId: item.id }} className={rowClass}><ResultRow icon={User} kind="Pelanggan" title={item.name} /></Link>)}
      {invoices.data?.items.map((item) => <Link key={item.id} to="/invoices/$invoiceId" params={{ invoiceId: item.id }} className={rowClass}><ResultRow icon={FileText} kind="Invoice" title={formatInvoiceNumber(item.invoiceNumber, item.sequence, item.issueDate) || "Draft"} amount={item.grandTotal} /></Link>)}
      {documents.data?.items.map((item) => <Link key={item.document.id} to="/inbox/$documentId" params={{ documentId: item.document.id }} className={rowClass}><ResultRow icon={Paperclip} kind="Dokumen" title={item.summary.merchantName || item.summary.description || item.document.filename} /></Link>)}
      {settled && total === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <SearchX className="mx-auto mb-2 size-7" aria-hidden="true" />
          Tidak ada hasil untuk “{search}”.
        </div>
      )}
    </div>
  )
}

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { FileText, Plus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { formatRupiah } from "@/lib/format"
import { getInvoiceSummary, listInvoices } from "@/lib/invoice-client"

export function InvoicesPage() {
  const [status, setStatus] = useState(""); const [search, setSearch] = useState("")
  const summary = useQuery({ queryKey: ["invoice", "summary"], queryFn: getInvoiceSummary }); const invoices = useQuery({ queryKey: ["invoice", "list", status, search], queryFn: () => listInvoices({ status, search }) })
  return <div className="space-y-4 pb-8"><header className="flex items-center justify-between gap-3"><div><h1 className="text-2xl">Invoice</h1><p className="text-sm text-muted-foreground">Tagihan pelanggan dan penerimaan kas.</p></div><Link to="/invoices/new" search={{}} className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--main-dark)] px-4 text-sm font-semibold text-white"><Plus className="size-4" />Buat</Link></header>
    <div className="grid grid-cols-2 gap-3"><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Belum Dibayar</p><p className="font-semibold">{formatRupiah(summary.data?.unpaidTotal || 0)}</p><p className="text-xs">{summary.data?.unpaidCount || 0} invoice</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Lewat Jatuh Tempo</p><p className="font-semibold text-red-700">{formatRupiah(summary.data?.overdueTotal || 0)}</p><p className="text-xs">{summary.data?.overdueCount || 0} invoice</p></CardContent></Card></div>
    <div className="grid grid-cols-[1fr_auto] gap-2"><TextField label="Cari nomor atau pelanggan" value={search} onChange={setSearch} /><label className="mt-6"><select aria-label="Status" className="h-12 rounded-xl border bg-white px-3" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Semua</option><option value="DRAFT">Draft</option><option value="UNPAID">Belum dibayar</option><option value="PAID">Lunas</option><option value="VOID">Dibatalkan</option></select></label></div>
    <div className="space-y-3">{invoices.data?.items.map((invoice) => <Link key={invoice.id} to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }} className="block rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><div><p className="font-semibold">{invoice.invoiceNumber || "Draft invoice"}</p><p className="text-xs text-muted-foreground">{invoice.issueDate} · jatuh tempo {invoice.dueDate} · {invoice.status}</p></div><strong>{formatRupiah(invoice.grandTotal)}</strong></div></Link>)}</div>{!invoices.isLoading && !invoices.data?.items.length && <Card><CardContent className="p-8 text-center"><FileText className="mx-auto mb-2 size-7 text-muted-foreground" />Belum ada invoice.</CardContent></Card>}
    <div className="flex gap-4 text-sm"><Link to="/customers" className="font-semibold text-[var(--link)]">Kelola Pelanggan</Link><Link to="/settings/invoice" className="font-semibold text-[var(--link)]">Pengaturan Invoice</Link></div>
  </div>
}

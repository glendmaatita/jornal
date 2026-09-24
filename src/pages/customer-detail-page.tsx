import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CircleCheck, Clock, FilePlus2, FileText, History, Mail, MapPin, Pencil, Phone, User } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { formatInvoiceNumber, formatRupiah } from "@/lib/format"
import { getCustomer } from "@/lib/invoice-client"

export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["invoice", "customer", customerId], queryFn: () => getCustomer(customerId) })
  if (isLoading) return <p>Memuat…</p>
  if (error || !data) return <p className="text-red-700">{String(error || "Pelanggan tidak ditemukan")}</p>
  const { customer, summary, invoices } = data
  const address = [customer.addressLine1, customer.addressLine2, customer.district, customer.city, customer.province, customer.postalCode].filter(Boolean).join(", ")

  return (
    <div className="space-y-4 pb-8">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#f1f5fd] text-[#16579d]"><User className="size-5" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl">{customer.name}</h1>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {customer.email && <span className="inline-flex min-w-0 max-w-full items-center gap-1"><Mail className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{customer.email}</span></span>}
              {customer.phone && <span className="inline-flex items-center gap-1"><Phone className="size-3.5" aria-hidden="true" />{customer.phone}</span>}
            </p>
          </div>
        </div>
        <Link to="/customers/$customerId/edit" params={{ customerId }} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[var(--link)]"><Pencil className="size-4" aria-hidden="true" />Edit</Link>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5 text-amber-600" aria-hidden="true" />Belum dibayar</p><p className="mt-1 font-semibold tabular-nums">{formatRupiah(summary.unpaidTotal)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CircleCheck className="size-3.5 text-emerald-600" aria-hidden="true" />Sudah lunas</p><p className="mt-1 font-semibold tabular-nums">{formatRupiah(summary.paidTotal)}</p></CardContent></Card>
      </div>
      <Link to="/invoices/new" search={{ customer: customerId }} className="flex items-center justify-center gap-2 rounded-xl bg-[var(--main-dark)] p-3 text-center font-semibold text-white"><FilePlus2 className="size-4" aria-hidden="true" />Buat Invoice</Link>
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className={address ? "" : "text-muted-foreground"}>{address || "Alamat belum diisi"}</p>
        </CardContent>
      </Card>
      <h2 className="flex items-center gap-2 font-semibold"><History className="size-4 text-primary" aria-hidden="true" />Riwayat invoice ({summary.invoiceCount})</h2>
      {invoices.map((invoice) => (
        <Link key={invoice.id} to="/invoices/$invoiceId" params={{ invoiceId: invoice.id }} className="flex items-center gap-3 rounded-xl border bg-white p-3">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1">{formatInvoiceNumber(invoice.invoiceNumber, invoice.sequence, invoice.issueDate) || "Draft"} · {invoice.status}</span>
          <strong className="tabular-nums">{formatRupiah(invoice.grandTotal)}</strong>
        </Link>
      ))}
    </div>
  )
}

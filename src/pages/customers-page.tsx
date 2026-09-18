import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Archive, Plus, RotateCcw, Search, Users, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { formatRupiah } from "@/lib/format"
import { listCustomers, setCustomerArchived } from "@/lib/invoice-client"

export function CustomersPage() {
  const client = useQueryClient(); const [search, setSearch] = useState(""); const [archived, setArchived] = useState(false)
  const query = useQuery({ queryKey: ["invoice", "customers", search, archived], queryFn: () => listCustomers({ search, status: archived ? "ARCHIVED" : "ACTIVE" }) })
  const refresh = () => client.invalidateQueries({ queryKey: ["invoice"] })
  return <div className="space-y-4 pb-8"><header className="flex items-center justify-between"><div><h1 className="flex items-center gap-2 text-2xl tracking-tight"><Users className="size-5 text-primary" aria-hidden="true" />Pelanggan</h1><p className="text-sm text-muted-foreground">Kontak dan riwayat invoice per company.</p></div><Link to="/customers/new" className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--main-dark)] px-4 text-sm font-semibold text-white"><Plus className="size-4" />Tambah</Link></header>
    <div className="flex gap-2"><div className="flex-1"><TextField label="Cari nama, email, telepon, kota" icon={Search} value={search} onChange={setSearch} /></div><Button className="mt-6" variant="outline" onClick={() => setArchived((value) => !value)}>{archived ? <RotateCcw aria-hidden="true" /> : <Archive aria-hidden="true" />}{archived ? "Aktif" : "Arsip"}</Button></div>
    {query.isLoading && <p className="py-8 text-center text-sm">Memuat pelanggan…</p>}{query.error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{String(query.error)}</p>}
    <div className="space-y-3">{query.data?.items.map((customer) => <Card key={customer.id}><CardContent className="p-4"><Link to="/customers/$customerId" params={{ customerId: customer.id }} className="block"><div className="flex justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#f1f5fd] text-[#16579d]"><UsersRound className="size-4" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate font-semibold">{customer.name}</p><p className="text-xs text-muted-foreground">{[customer.email, customer.phone, customer.city].filter(Boolean).join(" · ") || "Kontak belum lengkap"}</p></div></div><div className="shrink-0 text-right"><p className="font-semibold tabular-nums">{formatRupiah(customer.unpaidTotal)}</p><p className="text-xs text-muted-foreground">{customer.activeInvoiceCount} belum dibayar</p></div></div></Link><Button className="mt-3" size="sm" variant="ghost" onClick={() => void setCustomerArchived(customer, !archived).then(refresh)}>{archived ? <RotateCcw /> : <Archive />}{archived ? "Pulihkan" : "Arsipkan"}</Button></CardContent></Card>)}</div>
    {!query.isLoading && !query.data?.items.length && <Card><CardContent className="p-8 text-center"><Search className="mx-auto mb-2 size-7 text-muted-foreground" /><p>Belum ada pelanggan.</p></CardContent></Card>}
  </div>
}

import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { listDocuments } from "@/lib/document-client"
import { getInvoiceSummary, listInvoiceReminders } from "@/lib/invoice-client"
import { useTaxAgenda } from "@/lib/tax-compliance-queries"

export function ActionCenter() {
  const invoice = useQuery({ queryKey: ["invoice", "summary"], queryFn: getInvoiceSummary }); const reminders = useQuery({ queryKey: ["actions", "invoice-reminders"], queryFn: listInvoiceReminders }); const documents = useQuery({ queryKey: ["actions", "documents"], queryFn: () => listDocuments() }); const { data: tax } = useTaxAgenda()
  const documentCount = documents.data?.items.filter((item) => item.status === "UNPROCESSED" || item.status === "REVIEW_READY").length || 0; const taxCount = (tax?.obligations.filter((item) => !["PAID", "OVERPAID", "NOT_REQUIRED"].includes(item.paymentStatus)).length || 0) + (tax?.filings.filter((item) => !["FILED", "FULFILLED_BY_PAYMENT", "NOT_REQUIRED"].includes(item.status)).length || 0); const total = (invoice.data?.overdueCount || 0) + documentCount + taxCount
  return <Card><CardContent className="p-4"><div className="flex items-center gap-2"><span className={`rounded-full p-2 ${total ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{total ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}</span><div><p className="font-semibold">Tindakan hari ini</p><p className="text-xs text-muted-foreground">{total ? `${total} hal perlu diperiksa` : "Tidak ada tugas mendesak"}</p></div></div>{total > 0 && <div className="mt-3 grid gap-2 text-sm">{Boolean(invoice.data?.overdueCount) && <Link to="/invoices" className="rounded-lg bg-secondary/60 p-2">{invoice.data?.overdueCount} invoice perlu ditagih · {reminders.data?.items.filter((item) => item.status === "UNREAD").length || 0} reminder baru</Link>}{documentCount > 0 && <Link to="/inbox" className="rounded-lg bg-secondary/60 p-2">{documentCount} dokumen belum selesai direview</Link>}{taxCount > 0 && <Link to="/tax" className="rounded-lg bg-secondary/60 p-2">{taxCount} kewajiban/laporan pajak aktif</Link>}</div>}</CardContent></Card>
}

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Archive, ArrowDownLeft, ArrowLeft, ArrowUpRight, ExternalLink, FileText, Link2, MessageSquare, PenLine, ScanSearch, Sparkles, Undo2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { SelectField } from "@/components/ui/select-field"
import { TextField } from "@/components/ui/text-field"
import { archiveDocument, confirmDocument, extractDocument, getAiJob, getDocument, listDocumentInvoiceCandidates, unlinkDocument } from "@/lib/document-client"
import type { DocumentExtraction } from "@/lib/document-types"
import { todayIsoDate } from "@/lib/format"

export function DocumentReviewPage({ documentId }: { documentId: string }) {
  const detail = useQuery({ queryKey: ["documents", documentId], queryFn: () => getDocument(documentId), refetchInterval: 10_000 })
  const [jobId, setJobId] = useState(""); const [job, setJob] = useState<{ status: string; result: DocumentExtraction | null; errorCode: string | null } | null>(null)
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [unlinkReason, setUnlinkReason] = useState(""); const [invoiceId, setInvoiceId] = useState("")
  const extraction = detail.data?.extraction?.result || job?.result || null
  const [review, setReview] = useState({ amount: "", transactionDate: todayIsoDate(), direction: "MONEY_OUT" as "MONEY_IN" | "MONEY_OUT", description: "" })
  const parsedAmount = Math.round(Number(review.amount.replace(/[^0-9.]/g, "")))
  const invoiceCandidates = useQuery({ queryKey: ["documents", documentId, "invoice-candidates", parsedAmount], queryFn: () => listDocumentInvoiceCandidates(documentId, parsedAmount), enabled: parsedAmount > 0 && detail.data?.document.status !== "LINKED" })
  const imageUrl = useMemo(() => detail.data && detail.data.document.mimeType.startsWith("image/") ? `data:${detail.data.document.mimeType};base64,${detail.data.contentBase64}` : "", [detail.data])

  // Poll the durable job until terminal; `detail.refetch` belongs to this mounted document.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!jobId || ["SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"].includes(job?.status || "")) return; const timer = window.setInterval(() => void getAiJob(jobId).then((result) => { setJob(result.job); if (result.job.status === "SUCCEEDED") void detail.refetch() }), 2_000); return () => clearInterval(timer) }, [jobId, job?.status])
  // A newly arrived extraction seeds the editable review draft once.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!extraction) return; setReview({ amount: extraction.amount || "", transactionDate: extraction.transactionDate || todayIsoDate(), direction: extraction.directionHint === "MONEY_IN" ? "MONEY_IN" : "MONEY_OUT", description: extraction.description || extraction.merchantName || "" }) }, [extraction])
  if (detail.isLoading) return <p>Memuat dokumen…</p>
  if (!detail.data) return <p className="text-red-700">{String(detail.error || "Dokumen tidak ditemukan")}</p>
  const document = detail.data.document
  const scan = async () => { setBusy(true); setMessage(""); try { const result = await extractDocument(document.id); setJobId(result.job.id); setJob({ status: result.job.status, result: null, errorCode: null }); setMessage("Dokumen masuk antrean AI. Anda boleh meninggalkan halaman ini.") } catch (cause) { setMessage(String(cause)) } finally { setBusy(false) } }
  const confirm = async () => { if (!parsedAmount || !review.transactionDate || !review.description.trim()) { setMessage("Nominal, tanggal, dan deskripsi wajib diperiksa sebelum disimpan."); return }; const invoice = invoiceCandidates.data?.items.find((item) => item.id === invoiceId); setBusy(true); setMessage(""); try { await confirmDocument(document, invoice ? { mode: "MATCH_INVOICE", invoiceId: invoice.id, expectedInvoiceRevision: invoice.revision, direction: "MONEY_IN", amount: parsedAmount, transactionDate: review.transactionDate, description: review.description.trim() } : { direction: review.direction, amount: parsedAmount, transactionDate: review.transactionDate, description: review.description.trim() }); setMessage(invoice ? "Pembayaran invoice dan transaksi tersimpan." : "Transaksi tersimpan dan dokumen sudah ditautkan."); await detail.refetch() } catch (cause) { setMessage(String(cause)) } finally { setBusy(false) } }

  return <div className="space-y-4 pb-8">
    <header><h1 className="flex items-center gap-2 text-2xl"><ScanSearch className="size-5 text-primary" aria-hidden="true" />Review Dokumen</h1><p className="text-sm text-muted-foreground">{document.filename} · {document.status}</p></header>
    {message && <p className="rounded-xl bg-white p-3 text-sm">{message}</p>}
    {imageUrl ? <img src={imageUrl} alt="Dokumen transaksi" className="max-h-[55vh] w-full rounded-xl bg-white object-contain" /> : <Card><CardContent className="p-8 text-center"><FileText className="mx-auto mb-2 size-7 text-muted-foreground" aria-hidden="true" />Preview PDF belum tersedia; file tetap tersimpan.</CardContent></Card>}
    <Button className="w-full" disabled={busy || job?.status === "RUNNING" || job?.status === "QUEUED" || document.status === "LINKED"} onClick={() => void scan()}><Sparkles />{job?.status === "RUNNING" || job?.status === "QUEUED" ? "AI sedang membaca…" : "Baca dengan AI"}</Button>
    {job?.errorCode && <p className="text-sm text-red-700">AI gagal: {job.errorCode}. Input manual tetap tersedia.</p>}
    {document.status !== "LINKED" && <Card><CardContent className="grid gap-3 p-4">
      <h2 className="flex items-center gap-2 font-semibold">{extraction ? <Sparkles className="size-4 text-primary" aria-hidden="true" /> : <PenLine className="size-4 text-primary" aria-hidden="true" />}{extraction ? "Usulan ekstraksi — wajib diperiksa" : "Isi transaksi secara manual"}</h2>
      {extraction && <p className="text-xs text-muted-foreground">Jenis: {extraction.documentType}. Nilai berikut dapat diedit sebelum disimpan.</p>}
      <TextField label="Nominal" type="amount" value={review.amount} onChange={(amount) => setReview({ ...review, amount })} />
      <DateField label="Tanggal transaksi" value={review.transactionDate} onChange={(transactionDate) => setReview({ ...review, transactionDate })} />
      <SelectField label="Arah" icon={review.direction === "MONEY_IN" ? ArrowDownLeft : ArrowUpRight} value={review.direction} onChange={(direction) => setReview({ ...review, direction: direction as "MONEY_IN" | "MONEY_OUT" })} options={[{ value: "MONEY_OUT", label: "Uang keluar" }, { value: "MONEY_IN", label: "Uang masuk" }]} />
      <TextField label="Deskripsi" icon={PenLine} value={review.description} onChange={(description) => setReview({ ...review, description })} />
      {invoiceCandidates.data?.items.length ? <SelectField label="Cocokkan invoice (opsional)" icon={Link2} value={invoiceId} onChange={setInvoiceId} placeholder="Simpan sebagai transaksi biasa" searchable searchPlaceholder="Cari invoice…" options={invoiceCandidates.data.items.map((invoice) => ({ value: invoice.id, label: `${invoice.invoiceNumber} · ${String(invoice.customerSnapshot?.name || "Pelanggan")}` }))} /> : null}
      {extraction && extraction.uncertainFields.length > 0 && <p className="flex gap-2 rounded-lg bg-amber-50 p-2 text-amber-900"><AlertTriangle className="size-4" />Periksa: {extraction.uncertainFields.join(", ")}</p>}
      <Button className="mt-2" disabled={busy} onClick={() => void confirm()}>{invoiceId ? <Link2 aria-hidden="true" /> : <Save aria-hidden="true" />}{invoiceId ? "Cocokkan & lunasi invoice" : "Simpan transaksi"}</Button>
    </CardContent></Card>}
    {document.status === "LINKED" && <Card><CardContent className="grid gap-3 p-4"><p className="flex items-center gap-2 font-semibold"><Link2 className="size-4 text-emerald-600" aria-hidden="true" />Dokumen sudah tertaut ke transaksi</p>{detail.data.linkedInvoiceId ? <Link to="/invoices/$invoiceId" params={{ invoiceId: detail.data.linkedInvoiceId }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--link)]"><ExternalLink className="size-4" aria-hidden="true" />Buka invoice terkait untuk koreksi pembayaran</Link> : <><TextField label="Alasan koreksi" icon={MessageSquare} value={unlinkReason} onChange={setUnlinkReason} placeholder="Alasan koreksi" /><Button variant="outline" disabled={busy || !unlinkReason.trim()} onClick={() => void (async () => { setBusy(true); try { await unlinkDocument(document, unlinkReason); setMessage("Tautan dokumen dikoreksi."); await detail.refetch() } catch (cause) { setMessage(String(cause)) } finally { setBusy(false) } })()}><Undo2 aria-hidden="true" />Koreksi tautan</Button></>}</CardContent></Card>}
    <Button variant="ghost" disabled={document.status === "LINKED"} onClick={() => void archiveDocument(document).then(() => history.back())}><Archive aria-hidden="true" />Arsipkan dokumen</Button>
    <Link to="/inbox" className="flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-[var(--link)]"><ArrowLeft className="size-4" aria-hidden="true" />Kembali ke inbox</Link>
  </div>
}

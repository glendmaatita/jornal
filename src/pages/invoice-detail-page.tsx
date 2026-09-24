import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CircleCheck,
  Copy,
  Eye,
  FileDown,
  FileText,
  ImageDown,
  Link2,
  MessageSquare,
  Pencil,
  Receipt,
  Send,
  Trash2,
  Undo2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/ui/app-dialog-context";
import { DateField } from "@/components/ui/date-field";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
import { InvoicePaperFit } from "@/components/invoice/invoice-paper-fit";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import {
  correctInvoicePayment,
  deleteInvoiceDraft,
  duplicateInvoice,
  getInvoice,
  getInvoiceSettings,
  issueInvoice,
  listInvoicePaymentCandidates,
  markInvoicePaid,
  voidInvoice,
} from "@/lib/invoice-client";
import {
  downloadInvoiceFile,
  invoicePdf,
  invoicePng,
  printInvoice,
} from "@/lib/invoice-export";
import { formatInvoiceNumber, todayIsoDate } from "@/lib/format";
import { useAccounts } from "@/lib/queries";
import { activeCompany, loadCompanyLogo } from "@/lib/companies";
import { isAccountEnabled } from "@/lib/types";

export function InvoiceDetailPage({
  invoiceId,
  previewOnly = false,
}: {
  invoiceId: string;
  previewOnly?: boolean;
}) {
  const dialog = useAppDialog();
  const navigate = useNavigate();
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["invoice", "detail", invoiceId],
    queryFn: () => getInvoice(invoiceId),
  });
  const candidates = useQuery({
    queryKey: ["invoice", "payment-candidates", invoiceId],
    queryFn: () => listInvoicePaymentCandidates(invoiceId),
    enabled: detail.data?.invoice.status === "UNPAID",
  });
  const settings = useQuery({
    queryKey: ["invoice", "settings"],
    queryFn: getInvoiceSettings,
  });
  const { data: accounts = [] } = useAccounts();
  const documentRef = useRef<HTMLDivElement>(null);
  const [paidOn, setPaidOn] = useState(todayIsoDate());
  const [accountId, setAccountId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"CREATE" | "LINK_EXISTING">(
    "CREATE",
  );
  const [candidateId, setCandidateId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabledAccounts = accounts.filter(isAccountEnabled);
  const selectedEnabledAccountId = accountId && enabledAccounts.some((account) => account.id === accountId)
    ? accountId
    : "";
  const defaultAccountId = settings.data?.settings.defaultAccountId || "";
  const effectiveAccountId = selectedEnabledAccountId
    || (enabledAccounts.some((account) => account.id === defaultAccountId) ? defaultAccountId : "");
  const snapshotLogoId = String(
    detail.data?.invoice.senderSnapshot?.logoAssetId || "",
  );
  const company = activeCompany();
  const logo = useQuery({
    queryKey: ["invoice", "logo", company?.id, snapshotLogoId],
    queryFn: () => (company ? loadCompanyLogo(company, snapshotLogoId) : null),
    enabled: Boolean(company && snapshotLogoId),
    staleTime: Infinity,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ["invoice"] });
    await detail.refetch();
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Aksi invoice gagal");
    } finally {
      setBusy(false);
    }
  };
  if (detail.isLoading) return <p>Memuat invoice…</p>;
  if (!detail.data)
    return (
      <p className="text-red-700">
        {String(detail.error || "Invoice tidak ditemukan")}
      </p>
    );
  const { invoice, payment } = detail.data;
  const displayedInvoiceNumber = formatInvoiceNumber(
    invoice.invoiceNumber,
    invoice.sequence,
    invoice.issueDate,
  );
  const candidate = candidates.data?.items.find(
    (item) => item.transaction.id === candidateId,
  );
  return (
    <div className={previewOnly ? "pb-8" : "space-y-4 pb-8"}>
      {!previewOnly && (
        <>
          <header className="flex justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl">
                <FileText className="size-5 text-primary" aria-hidden="true" />
                {displayedInvoiceNumber || "Draft Invoice"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {invoice.status} · revisi {invoice.revision}
              </p>
            </div>
            {(invoice.status === "DRAFT" || invoice.status === "UNPAID") && (
              <Link
                to="/invoices/$invoiceId/edit"
                params={{ invoiceId }}
                className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--link)]"
              >
                <Pencil className="size-4" aria-hidden="true" />
                {invoice.status === "UNPAID" ? "Revisi" : "Edit"}
              </Link>
            )}
          </header>
          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {invoice.status === "DRAFT" && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void run(() => issueInvoice(invoice))}
                >
                  <Send aria-hidden="true" />
                  Terbitkan
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void (async () => {
                    if (!await dialog.confirm({
                      title: "Hapus draft invoice?",
                      description: "Draft ini akan dihapus dan tidak dapat dipulihkan.",
                      confirmLabel: "Hapus draft",
                      tone: "destructive",
                    })) return;
                    setBusy(true);
                    void deleteInvoiceDraft(invoice)
                      .then(() => navigate({ to: "/invoices" }))
                      .catch((cause) => setError(String(cause)))
                      .finally(() => setBusy(false));
                  })()}
                >
                  <Trash2 aria-hidden="true" />
                  Hapus Draft
                </Button>
              </>
            )}
            <Link
              to="/invoices/$invoiceId/preview"
              params={{ invoiceId }}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#ced6e1] bg-white px-5 text-sm font-semibold hover:bg-[#f1f5fd]"
            >
              <Eye className="size-4" aria-hidden="true" />
              Preview
            </Link>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => duplicateInvoice(invoice))}
            >
              <Copy aria-hidden="true" />
              Duplikasi
            </Button>
            {invoice.status === "UNPAID" && (
              <Button
                variant="outline"
                disabled={busy || !reason.trim()}
                onClick={() => void run(() => voidInvoice(invoice, reason))}
              >
                <Ban aria-hidden="true" />
                Batalkan
              </Button>
            )}
          </div>
          {invoice.status === "UNPAID" && (
            <section className="grid gap-3 rounded-xl border bg-white p-4">
              <h2 className="flex items-center gap-2 font-semibold">
                <BadgeCheck className="size-4 text-primary" aria-hidden="true" />
                Tandai Lunas
              </h2>
              <SelectField
                label="Cara mencatat"
                icon={Receipt}
                value={paymentMode}
                onChange={(value) =>
                  setPaymentMode(value as "CREATE" | "LINK_EXISTING")
                }
                options={[
                  { value: "CREATE", label: "Buat transaksi pemasukan" },
                  {
                    value: "LINK_EXISTING",
                    label: "Kaitkan transaksi yang sudah ada",
                  },
                ]}
              />
              {paymentMode === "CREATE" ? (
                <>
                  <DateField
                    label="Tanggal diterima"
                    value={paidOn}
                    onChange={setPaidOn}
                  />
                  <SelectField
                    label="Rekening"
                    icon={Wallet}
                    value={effectiveAccountId}
                    onChange={setAccountId}
                    placeholder="Tanpa rekening"
                    searchable
                    searchPlaceholder="Cari rekening…"
                    options={enabledAccounts.map((account) => ({
                        value: account.id,
                        label: account.name,
                      }))}
                  />
                </>
              ) : (
                <SelectField
                  label="Transaksi cocok"
                  icon={Link2}
                  value={candidateId}
                  onChange={setCandidateId}
                  placeholder="Pilih transaksi"
                  searchable
                  searchPlaceholder="Cari transaksi…"
                  options={(candidates.data?.items ?? []).map((item) => ({
                    value: item.transaction.id,
                    label: `${item.transaction.transactionDate} · ${item.transaction.description}`,
                  }))}
                />
              )}
              <Button
                disabled={
                  busy || (paymentMode === "LINK_EXISTING" && !candidate)
                }
                onClick={() =>
                  void run(() =>
                    paymentMode === "CREATE"
                      ? markInvoicePaid(invoice, {
                          paidOn,
                          accountId: effectiveAccountId || null,
                        })
                      : markInvoicePaid(invoice, {
                          mode: "LINK_EXISTING",
                          transactionId: candidate!.transaction.id,
                          expectedTransactionRevision: candidate!.revision,
                          paidOn: "",
                        }),
                  )
                }
              >
                <BadgeCheck aria-hidden="true" />
                Konfirmasi pelunasan
              </Button>
              <TextField
                label="Alasan bila membatalkan invoice"
                icon={MessageSquare}
                value={reason}
                onChange={setReason}
              />
            </section>
          )}
          {invoice.status === "PAID" && payment && (
            <section className="grid gap-3 rounded-xl border bg-white p-4">
              <p className="flex items-center gap-2 font-semibold text-emerald-700">
                <CircleCheck className="size-4" aria-hidden="true" />
                Pembayaran tercatat pada {payment.paidOn}
              </p>
              <TextField
                label="Alasan koreksi pembayaran"
                icon={MessageSquare}
                value={reason}
                onChange={setReason}
              />
              <Button
                variant="outline"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(() => correctInvoicePayment(payment, reason))
                }
              >
                <Undo2 aria-hidden="true" />
                Koreksi Pembayaran
              </Button>
            </section>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void downloadInvoiceFile(
                  invoice.id,
                  displayedInvoiceNumber,
                  "pdf",
                )
                  .catch(() =>
                    documentRef.current?.querySelector("[data-invoice-document]")
                      ? invoicePdf(
                          documentRef.current.querySelector("[data-invoice-document]") as HTMLElement,
                          `invoice-${displayedInvoiceNumber || invoice.id}.pdf`,
                        )
                      : Promise.reject(new Error("Preview invoice belum siap.")),
                  )
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : "PDF gagal dibuat.")
                    printInvoice()
                  })
              }
            >
              <FileDown aria-hidden="true" />
              PDF / Bagikan
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void downloadInvoiceFile(
                  invoice.id,
                  displayedInvoiceNumber,
                  "png",
                )
                  .catch(() =>
                    documentRef.current?.querySelector("[data-invoice-document]")
                      ? invoicePng(
                          documentRef.current.querySelector("[data-invoice-document]") as HTMLElement,
                          `invoice-${displayedInvoiceNumber || invoice.id}.png`,
                        )
                      : Promise.reject(),
                  )
                  .catch((cause) => setError(String(cause)))
              }
            >
              <ImageDown aria-hidden="true" />
              PNG / Bagikan
            </Button>
          </div>
        </>
      )}
      <div className="rounded-xl bg-slate-200 p-2" ref={documentRef}>
        <InvoicePaperFit className="overflow-hidden">
          <InvoiceDocument invoice={invoice} logoDataUrl={logo.data?.dataUrl} />
        </InvoicePaperFit>
      </div>
    </div>
  );
}

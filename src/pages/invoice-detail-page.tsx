import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { InvoiceDocument } from "@/components/invoice/invoice-document";
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
  invoicePng,
  printInvoice,
} from "@/lib/invoice-export";
import { todayIsoDate } from "@/lib/format";
import { useAccounts } from "@/lib/queries";
import { activeCompany, loadCompanyLogo } from "@/lib/companies";

export function InvoiceDetailPage({
  invoiceId,
  previewOnly = false,
}: {
  invoiceId: string;
  previewOnly?: boolean;
}) {
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
  const effectiveAccountId =
    accountId || settings.data?.settings.defaultAccountId || "";
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
  const candidate = candidates.data?.items.find(
    (item) => item.transaction.id === candidateId,
  );
  return (
    <div className={previewOnly ? "pb-8" : "space-y-4 pb-8"}>
      {!previewOnly && (
        <>
          <header className="flex justify-between">
            <div>
              <h1 className="text-2xl">
                {invoice.invoiceNumber || "Draft Invoice"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {invoice.status} · revisi {invoice.revision}
              </p>
            </div>
            {invoice.status === "DRAFT" && (
              <Link
                to="/invoices/$invoiceId/edit"
                params={{ invoiceId }}
                className="text-sm font-semibold text-[var(--link)]"
              >
                Edit
              </Link>
            )}
          </header>
          {error && (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
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
                  Terbitkan
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm("Hapus draft invoice ini?")) return;
                    setBusy(true);
                    void deleteInvoiceDraft(invoice)
                      .then(() => navigate({ to: "/invoices" }))
                      .catch((cause) => setError(String(cause)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Hapus Draft
                </Button>
              </>
            )}
            <Link
              to="/invoices/$invoiceId/preview"
              params={{ invoiceId }}
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
            >
              Preview
            </Link>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => duplicateInvoice(invoice))}
            >
              Duplikasi
            </Button>
            {invoice.status === "UNPAID" && (
              <Button
                variant="outline"
                disabled={busy || !reason.trim()}
                onClick={() => void run(() => voidInvoice(invoice, reason))}
              >
                Batalkan
              </Button>
            )}
          </div>
          {invoice.status === "UNPAID" && (
            <section className="grid gap-3 rounded-xl border bg-white p-4">
              <h2 className="font-semibold">Tandai Lunas</h2>
              <label className="grid gap-1 text-sm font-semibold">
                Cara mencatat
                <select
                  className="h-12 rounded-xl border bg-white px-3"
                  value={paymentMode}
                  onChange={(event) =>
                    setPaymentMode(
                      event.target.value as "CREATE" | "LINK_EXISTING",
                    )
                  }
                >
                  <option value="CREATE">Buat transaksi pemasukan</option>
                  <option value="LINK_EXISTING">
                    Kaitkan transaksi yang sudah ada
                  </option>
                </select>
              </label>
              {paymentMode === "CREATE" ? (
                <>
                  <DateField
                    label="Tanggal diterima"
                    value={paidOn}
                    onChange={setPaidOn}
                  />
                  <label className="text-sm font-semibold">
                    Rekening
                    <select
                      className="mt-1 h-12 w-full rounded-xl border bg-white px-3"
                      value={effectiveAccountId}
                      onChange={(event) => setAccountId(event.target.value)}
                    >
                      <option value="">Tanpa rekening</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <label className="grid gap-1 text-sm font-semibold">
                  Transaksi cocok
                  <select
                    className="h-12 rounded-xl border bg-white px-3"
                    value={candidateId}
                    onChange={(event) => setCandidateId(event.target.value)}
                  >
                    <option value="">Pilih transaksi</option>
                    {candidates.data?.items.map((item) => (
                      <option
                        key={item.transaction.id}
                        value={item.transaction.id}
                      >
                        {item.transaction.transactionDate} ·{" "}
                        {item.transaction.description}
                      </option>
                    ))}
                  </select>
                </label>
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
                Konfirmasi pelunasan
              </Button>
              <TextField
                label="Alasan bila membatalkan invoice"
                value={reason}
                onChange={setReason}
              />
            </section>
          )}
          {invoice.status === "PAID" && payment && (
            <section className="grid gap-3 rounded-xl border bg-white p-4">
              <p className="font-semibold text-emerald-700">
                Pembayaran tercatat pada {payment.paidOn}
              </p>
              <TextField
                label="Alasan koreksi pembayaran"
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
                  invoice.invoiceNumber,
                  "pdf",
                ).catch(() => printInvoice())
              }
            >
              PDF / Bagikan
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void downloadInvoiceFile(
                  invoice.id,
                  invoice.invoiceNumber,
                  "png",
                )
                  .catch(() =>
                    documentRef.current?.firstElementChild
                      ? invoicePng(
                          documentRef.current.firstElementChild as HTMLElement,
                          `invoice-${invoice.invoiceNumber || invoice.id}.png`,
                        )
                      : Promise.reject(),
                  )
                  .catch((cause) => setError(String(cause)))
              }
            >
              PNG / Bagikan
            </Button>
          </div>
        </>
      )}
      <div
        className="overflow-auto rounded-xl bg-slate-200 p-2"
        ref={documentRef}
      >
        <InvoiceDocument invoice={invoice} logoDataUrl={logo.data?.dataUrl} />
      </div>
    </div>
  );
}

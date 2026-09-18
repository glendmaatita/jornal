import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  FilePen,
  FilePlus2,
  Hash,
  Package,
  Percent,
  Plus,
  Save,
  Send,
  Tag,
  Trash2,
  Truck,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { calculateInvoiceTotals } from "@/lib/invoice-math";
import {
  createInvoice,
  getInvoice,
  getInvoiceSettings,
  issueInvoice,
  listCustomers,
  updateInvoice,
  type InvoiceDraftInput,
} from "@/lib/invoice-client";
import { formatRupiah, parseAmountInput, todayIsoDate } from "@/lib/format";
import type { Invoice, InvoiceItemInput } from "@/lib/invoice-types";
import { activeCompany } from "@/lib/companies";

function plusDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function newItem(unitLabel = "pcs"): InvoiceItemInput {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantityScaled: 1000,
    unitLabel,
    unitPrice: 0,
    sortOrder: 0,
  };
}
function initialDraft(
  storageKey: string,
  invoiceId: string | undefined,
  initialCustomerId: string | undefined,
  today: string,
) {
  const fallback: InvoiceDraftInput = {
    customerId: initialCustomerId || "",
    issueDate: today,
    dueDate: plusDays(today, 1),
    timezone: "Asia/Jakarta",
    items: [newItem()],
    discountAmount: 0,
    shippingAmount: 0,
    taxRateBps: 0,
    shippingMethod: "",
  };
  if (invoiceId) return { form: fallback, restored: false };
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(storageKey) || "null",
    ) as InvoiceDraftInput | null;
    if (saved?.items?.length)
      return {
        form: { ...saved, customerId: initialCustomerId || saved.customerId },
        restored: true,
      };
  } catch {
    /* Ignore an invalid device-only draft. */
  }
  return { form: fallback, restored: false };
}
export function InvoiceFormPage({
  invoiceId,
  initialCustomerId,
}: {
  invoiceId?: string;
  initialCustomerId?: string;
}) {
  const navigate = useNavigate();
  const today = todayIsoDate();
  const companyId = activeCompany()?.id || "none";
  const storageKey = `jornal.invoice-compose.${companyId}.v1`;
  const [initial] = useState(() =>
    initialDraft(storageKey, invoiceId, initialCustomerId, today),
  );
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customers, setCustomers] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [units, setUnits] = useState<string[]>(["pcs", "Lusin", "Kodi"]);
  const [dueDays, setDueDays] = useState(1);
  const [form, setForm] = useState<InvoiceDraftInput>(initial.form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      listCustomers({ perPage: 100 }),
      getInvoiceSettings(),
      invoiceId ? getInvoice(invoiceId) : Promise.resolve(null),
    ])
      .then(([customerPage, config, detail]) => {
        setCustomers(customerPage.items);
        setUnits(
          config.units
            .filter((unit) => unit.status === "ACTIVE")
            .map((unit) => unit.label),
        );
        setDueDays(config.settings.defaultDueDays);
        if (!invoiceId && !initial.restored)
          setForm((current) => ({
            ...current,
            items: [
              newItem(
                config.units.find(
                  (unit) => unit.id === config.settings.defaultUnitId,
                )?.label || "pcs",
              ),
            ],
            dueDate: plusDays(
              current.issueDate,
              config.settings.defaultDueDays,
            ),
          }));
        if (detail) {
          setInvoice(detail.invoice);
          setForm({
            customerId: detail.invoice.customerId,
            issueDate: detail.invoice.issueDate,
            dueDate: detail.invoice.dueDate,
            timezone: detail.invoice.timezone,
            items: detail.invoice.items,
            shippingMethod: detail.invoice.shippingMethod || "",
            discountAmount: detail.invoice.discountAmount,
            shippingAmount: detail.invoice.shippingAmount,
            taxRateBps: detail.invoice.taxRateBps,
          });
        }
      })
      .catch((cause) => setError(String(cause)));
  }, [initial.restored, invoiceId]);
  useEffect(() => {
    if (!invoiceId) sessionStorage.setItem(storageKey, JSON.stringify(form));
  }, [form, invoiceId, storageKey]);
  const totals = useMemo(() => {
    try {
      return calculateInvoiceTotals(
        form.items,
        form.discountAmount || 0,
        form.shippingAmount || 0,
        form.taxRateBps || 0,
      ).totals;
    } catch {
      return null;
    }
  }, [form]);
  const setItem = (index: number, patch: Partial<InvoiceItemInput>) =>
    setForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  const persist = async (publish: boolean) => {
    setBusy(true);
    setError("");
    try {
      const saved = invoice
        ? await updateInvoice(invoice, form)
        : await createInvoice(form);
      const result = publish ? await issueInvoice(saved.invoice) : saved;
      sessionStorage.removeItem(storageKey);
      await navigate({
        to: "/invoices/$invoiceId",
        params: { invoiceId: result.invoice.id },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Invoice gagal disimpan",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl">
          {invoice ? (
            <FilePen className="size-5 text-primary" aria-hidden="true" />
          ) : (
            <FilePlus2 className="size-5 text-primary" aria-hidden="true" />
          )}
          {invoice ? "Edit draft" : "Buat Invoice"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Nomor resmi dibuat saat invoice diterbitkan. Draft di perangkat
          dipulihkan otomatis setelah kembali atau refresh.
        </p>
      </header>
      {error && (
        <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      <Card>
        <CardContent className="grid gap-4 p-4">
          <SelectField
            label="Pelanggan"
            icon={Users}
            value={form.customerId}
            onChange={(customerId) =>
              setForm((current) => ({ ...current, customerId }))
            }
            placeholder="Pilih pelanggan"
            options={customers.map((customer) => ({
              value: customer.id,
              label: customer.name,
            }))}
          />
          {!invoiceId && (
            <Link
              to="/customers/new"
              search={{ returnTo: "/invoices/new" }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--link)]"
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Tambah pelanggan tanpa kehilangan draft
            </Link>
          )}
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label="Tanggal invoice"
              value={form.issueDate}
              onChange={(issueDate) =>
                setForm((current) => ({
                  ...current,
                  issueDate,
                  dueDate: plusDays(issueDate, dueDays),
                }))
              }
            />
            <DateField
              label="Jatuh tempo"
              value={form.dueDate}
              onChange={(dueDate) =>
                setForm((current) => ({ ...current, dueDate }))
              }
            />
          </div>
        </CardContent>
      </Card>
      {form.items.map((item, index) => (
        <Card key={item.id}>
          <CardContent className="grid gap-3 p-4">
            <div className="flex items-center justify-between">
              <strong className="flex items-center gap-2">
                <Package className="size-4 text-primary" aria-hidden="true" />
                Item {index + 1}
              </strong>
              {form.items.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-11 text-red-700 hover:bg-red-50 hover:text-red-700"
                  aria-label={`Hapus item ${index + 1}`}
                  title={`Hapus item ${index + 1}`}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      items: current.items.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <Trash2 className="size-5" aria-hidden="true" />
                </Button>
              )}
            </div>
            <TextField
              label="Deskripsi"
              icon={Package}
              value={item.description}
              onChange={(description) => setItem(index, { description })}
            />
            <div className="grid grid-cols-3 gap-2">
              <TextField
                label="Jumlah"
                icon={Hash}
                value={String(item.quantityScaled / 1000)}
                onChange={(value) =>
                  setItem(index, {
                    quantityScaled:
                      Math.round(Number(value.replace(",", ".")) * 1000) || 0,
                  })
                }
              />
              <SelectField
                label="Satuan"
                value={item.unitLabel}
                onChange={(unitLabel) => setItem(index, { unitLabel })}
                options={units.map((unit) => ({ value: unit, label: unit }))}
              />
              <TextField
                label="Harga"
                icon={Banknote}
                type="amount"
                value={
                  item.unitPrice ? item.unitPrice.toLocaleString("id-ID") : ""
                }
                onChange={(value) =>
                  setItem(index, { unitPrice: parseAmountInput(value) })
                }
              />
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        variant="outline"
        className="w-full"
        onClick={() =>
          setForm((current) => ({
            ...current,
            items: [
              ...current.items,
              { ...newItem(units[0]), sortOrder: current.items.length },
            ],
          }))
        }
      >
        <Plus aria-hidden="true" />
        Tambah item
      </Button>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Diskon"
              icon={Tag}
              type="amount"
              value={
                form.discountAmount
                  ? form.discountAmount.toLocaleString("id-ID")
                  : ""
              }
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  discountAmount: parseAmountInput(value),
                }))
              }
            />
            <TextField
              label="Ongkir"
              icon={Truck}
              type="amount"
              value={
                form.shippingAmount
                  ? form.shippingAmount.toLocaleString("id-ID")
                  : ""
              }
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  shippingAmount: parseAmountInput(value),
                }))
              }
            />
            <TextField
              label="Pajak (%)"
              icon={Percent}
              value={String((form.taxRateBps || 0) / 100)}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  taxRateBps:
                    Math.round(Number(value.replace(",", ".")) * 100) || 0,
                }))
              }
            />
            <TextField
              label="Pengiriman"
              icon={Truck}
              value={form.shippingMethod || ""}
              onChange={(shippingMethod) =>
                setForm((current) => ({ ...current, shippingMethod }))
              }
            />
          </div>
          <div className="flex justify-between border-t pt-3 text-lg font-semibold">
            <span>Total</span>
            <span>{formatRupiah(totals?.grandTotal || 0)}</span>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          disabled={busy || !totals || !form.customerId}
          onClick={() => void persist(false)}
        >
          <Save aria-hidden="true" />
          Simpan Draft
        </Button>
        <Button
          disabled={busy || !totals || !form.customerId}
          onClick={() => void persist(true)}
        >
          <Send aria-hidden="true" />
          Terbitkan
        </Button>
      </div>
    </div>
  );
}

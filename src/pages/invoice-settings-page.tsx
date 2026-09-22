import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Building2,
  CalendarClock,
  Clock,
  CreditCard,
  DatabaseBackup,
  Download,
  FileCog,
  Globe,
  Hash,
  IdCard,
  Landmark,
  Mail,
  Phone,
  Plus,
  Repeat,
  Ruler,
  Save,
  SlidersHorizontal,
  Upload,
  User,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDialog } from "@/components/ui/app-dialog-context";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/loading-screen";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import {
  createInvoiceUnit,
  exportInvoiceBackup,
  getInvoiceSettings,
  previewInvoiceBackup,
  restoreInvoiceBackup,
  updateInvoiceSettings,
  updateInvoiceUnit,
  type InvoiceBackup,
} from "@/lib/invoice-client";
import type { InvoiceSettings, InvoiceUnit } from "@/lib/invoice-types";
import { useAccounts } from "@/lib/queries";

export function InvoiceSettingsPage() {
  const dialog = useAppDialog();
  const client = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const [settings, setSettings] = useState<InvoiceSettings | null>(null);
  const [units, setUnits] = useState<InvoiceUnit[]>([]);
  const [unit, setUnit] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    const result = await getInvoiceSettings();
    setSettings(result.settings);
    setUnits(result.units);
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the editable server draft once on mount
    void load().catch((cause) => setMessage(String(cause)));
  }, []);
  if (!settings)
    return <PageLoading label={message || "Memuat pengaturan invoice…"} />;
  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await updateInvoiceSettings({
        ...settings,
        paymentInstructions: settings.paymentInstructions.filter(
          (item) =>
            item &&
            [item.name, item.accountNumber, item.accountHolder].some((value) =>
              value.trim(),
            ),
        ),
      });
      setSettings(result.settings);
      setMessage("Pengaturan invoice tersimpan.");
      await client.invalidateQueries({ queryKey: ["invoice"] });
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const updateInstruction = (
    index: number,
    field: "name" | "accountNumber" | "accountHolder",
    value: string,
  ) => {
    const next = [...settings.paymentInstructions];
    next[index] = {
      ...(next[index] || { name: "", accountNumber: "", accountHolder: "" }),
      [field]: value,
    };
    setSettings({ ...settings, paymentInstructions: next });
  };
  const downloadBackup = async () => {
    setBusy(true);
    try {
      const backup = await exportInvoiceBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `jornal-invoice-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setMessage(
        "Backup invoice, pembayaran, ledger terkait, dan logo berhasil dibuat.",
      );
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Backup gagal dibuat.",
      );
    } finally {
      setBusy(false);
    }
  };
  const restoreBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 30_000_000) {
      setMessage("Backup terlalu besar (maksimal 30 MB).");
      return;
    }
    setBusy(true);
    try {
      const backup = JSON.parse(await file.text()) as InvoiceBackup;
      const preview = await previewInvoiceBackup(backup, {
        replaceLogo: false,
      });
      if (!preview.valid)
        throw new Error(
          `Backup tidak dapat dipulihkan: ${preview.conflicts.length} konflik, ${preview.invalidAssets.length} aset rusak.`,
        );
      if (preview.requiredAccountIds.length)
        throw new Error(
          "Backup memakai rekening yang tidak ada di company tujuan. Buat rekening dengan ID yang sama atau gunakan API restore dengan accountMap.",
        );
      const summary = Object.entries(preview.counts)
        .map(([name, count]) => `${name}: ${count}`)
        .join(", ");
      const replaceLogo = Boolean(
        backup.manifest.activeLogoAssetId &&
        await dialog.confirm({
          title: "Gunakan logo dari backup?",
          description: `Pemeriksaan backup valid (${summary}). Logo aktif company dapat diganti dengan logo yang tersimpan dalam backup.`,
          confirmLabel: "Ganti logo",
        }),
      );
      if (!await dialog.confirm({
        title: "Pulihkan backup invoice?",
        description: "Backup akan dipulihkan secara atomik. Reminder lama tidak akan dipulihkan atau dikirim ulang.",
        confirmLabel: "Pulihkan backup",
      })) return;
      const result = await restoreInvoiceBackup(backup, {
        replaceLogo,
        reason: "Restore dari Pengaturan Invoice",
      });
      setMessage(
        `Restore selesai: ${result.counts.created} dibuat, ${result.counts.merged} digabung, ${result.counts.skipped} dilewati.`,
      );
      await client.invalidateQueries({ queryKey: ["invoice"] });
      await load();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Restore gagal.");
    } finally {
      setBusy(false);
      if (restoreInput.current) restoreInput.current.value = "";
    }
  };
  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl">
          <FileCog className="size-5 text-primary" aria-hidden="true" />
          Pengaturan Invoice
        </h1>
        <p className="text-sm text-muted-foreground">
          Identitas pengirim, nomor, termin, satuan, dan reminder.
        </p>
      </header>
      {message && <p className="rounded-xl bg-white p-3 text-sm">{message}</p>}
      <Card>
        <CardContent className="grid gap-4 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <IdCard className="size-4 text-primary" aria-hidden="true" />
            Identitas pengirim
          </h2>
          <TextField
            label="Nama"
            icon={Building2}
            value={settings.senderName}
            onChange={(senderName) => setSettings({ ...settings, senderName })}
          />
          <TextField
            label="Telepon konfirmasi"
            icon={Phone}
            value={settings.senderPhone || ""}
            onChange={(senderPhone) =>
              setSettings({ ...settings, senderPhone })
            }
          />
          <TextField
            label="Email"
            icon={Mail}
            value={settings.senderEmail || ""}
            onChange={(senderEmail) =>
              setSettings({ ...settings, senderEmail })
            }
          />
          <h2 className="mt-2 flex items-center gap-2 font-semibold">
            <Hash className="size-4 text-primary" aria-hidden="true" />
            Nomor dan termin
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Prefix"
              icon={Hash}
              value={settings.numberingPrefix}
              onChange={(numberingPrefix) =>
                setSettings({ ...settings, numberingPrefix })
              }
            />
            <TextField
              label="Jumlah digit"
              type="numeric"
              value={String(settings.numberingPadding)}
              onChange={(value) =>
                setSettings({ ...settings, numberingPadding: Number(value) })
              }
            />
            <TextField
              label="Nomor awal"
              type="numeric"
              value={String(settings.numberingStart)}
              onChange={(value) =>
                setSettings({ ...settings, numberingStart: Number(value) })
              }
            />
            <TextField
              label="Termin (hari)"
              icon={CalendarClock}
              type="numeric"
              value={String(settings.defaultDueDays)}
              onChange={(value) =>
                setSettings({ ...settings, defaultDueDays: Number(value) })
              }
            />
            <TextField
              label="Jam reminder"
              icon={Clock}
              type="numeric"
              value={String(settings.reminderHour)}
              onChange={(value) =>
                setSettings({ ...settings, reminderHour: Number(value) })
              }
            />
            <TextField
              label="Ulangi setiap (hari)"
              icon={Repeat}
              type="numeric"
              value={String(settings.reminderRepeatDays)}
              onChange={(value) =>
                setSettings({ ...settings, reminderRepeatDays: Number(value) })
              }
            />
          </div>
          <TextField
            label="Timezone reminder"
            icon={Globe}
            value={settings.reminderTimezone}
            onChange={(reminderTimezone) =>
              setSettings({ ...settings, reminderTimezone })
            }
          />
          <label className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
            <input
              type="checkbox"
              checked={settings.reminderEnabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  reminderEnabled: event.target.checked,
                })
              }
              className="size-4 accent-[var(--primary)]"
            />
            <BellRing className="size-4 shrink-0 text-primary" aria-hidden="true" />
            Aktifkan reminder invoice overdue
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
            Default invoice & penerimaan
          </h2>
          <SelectField
            label="Satuan default"
            icon={Ruler}
            value={settings.defaultUnitId || ""}
            onChange={(value) =>
              setSettings({ ...settings, defaultUnitId: value || null })
            }
            placeholder="pcs"
            searchable
            searchPlaceholder="Cari satuan…"
            options={units
              .filter((item) => item.status === "ACTIVE")
              .map((item) => ({ value: item.id, label: item.label }))}
          />
          <SelectField
            label="Rekening penerimaan default"
            icon={Wallet}
            value={settings.defaultAccountId || ""}
            onChange={(value) =>
              setSettings({ ...settings, defaultAccountId: value || null })
            }
            placeholder="Pilih saat pelunasan"
            searchable
            searchPlaceholder="Cari rekening…"
            options={accounts.map((item) => ({ value: item.id, label: item.name }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4 p-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Landmark className="size-4 text-primary" aria-hidden="true" />
              Instruksi pembayaran
            </h2>
            <p className="text-xs text-muted-foreground">
              Maksimal tiga rekening atau e-wallet. Biarkan kosong untuk
              pembayaran tunai.
            </p>
          </div>
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid gap-2 rounded-xl border p-3">
              <TextField
                label={`Metode ${index + 1}`}
                icon={Landmark}
                value={settings.paymentInstructions[index]?.name || ""}
                onChange={(value) => updateInstruction(index, "name", value)}
              />
              <TextField
                label="Nomor rekening/e-wallet"
                icon={CreditCard}
                value={settings.paymentInstructions[index]?.accountNumber || ""}
                onChange={(value) =>
                  updateInstruction(index, "accountNumber", value)
                }
              />
              <TextField
                label="Nama pemilik"
                icon={User}
                value={settings.paymentInstructions[index]?.accountHolder || ""}
                onChange={(value) =>
                  updateInstruction(index, "accountHolder", value)
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Ruler className="size-4 text-primary" aria-hidden="true" />
            Satuan
          </h2>
          <div className="my-3 flex gap-2">
            <div className="flex-1">
              <TextField
                label="Satuan custom"
                icon={Ruler}
                value={unit}
                onChange={setUnit}
              />
            </div>
            <Button
              className="mt-6"
              disabled={!unit.trim()}
              onClick={() =>
                void createInvoiceUnit(unit).then(() => {
                  setUnit("");
                  return load();
                })
              }
            >
              <Plus aria-hidden="true" />
              Tambah
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {units.map((item) => (
              <button
                key={item.id}
                className={`rounded-full border px-3 py-1 text-sm ${item.status === "ARCHIVED" ? "opacity-50" : "bg-white"}`}
                onClick={() =>
                  void updateInvoiceUnit(item, {
                    status: item.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE",
                  }).then(load)
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <DatabaseBackup className="size-4 text-primary" aria-hidden="true" />
              Backup & pemulihan invoice
            </h2>
            <p className="text-xs text-muted-foreground">
              Bundle terversi menyertakan pelanggan, invoice, pembayaran, ledger
              terkait, pengaturan, satuan, audit, dan aset logo. Restore selalu
              menjalankan dry-run checksum terlebih dahulu.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void downloadBackup()}
            >
              <Download aria-hidden="true" />
              Unduh backup
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => restoreInput.current?.click()}
            >
              <Upload aria-hidden="true" />
              Pulihkan backup
            </Button>
            <input
              ref={restoreInput}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(event) => void restoreBackup(event.target.files?.[0])}
            />
          </div>
        </CardContent>
      </Card>
      <Button className="w-full" disabled={busy} onClick={() => void save()}>
        <Save aria-hidden="true" />
        {busy ? "Menyimpan…" : "Simpan Pengaturan"}
      </Button>
    </div>
  );
}

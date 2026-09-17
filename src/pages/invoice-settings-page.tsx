import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageLoading } from "@/components/loading-screen";
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
        window.confirm(
          `Dry-run valid (${summary}). Ganti juga logo aktif company dengan logo dari backup?`,
        ),
      );
      if (
        !window.confirm(
          "Pulihkan backup ini secara atomik? Reminder lama tidak akan dipulihkan atau dikirim ulang.",
        )
      )
        return;
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
        <h1 className="text-2xl">Pengaturan Invoice</h1>
        <p className="text-sm text-muted-foreground">
          Identitas pengirim, nomor, termin, satuan, dan reminder.
        </p>
      </header>
      {message && <p className="rounded-xl bg-white p-3 text-sm">{message}</p>}
      <Card>
        <CardContent className="grid gap-4 p-4">
          <h2 className="font-semibold">Identitas pengirim</h2>
          <TextField
            label="Nama"
            value={settings.senderName}
            onChange={(senderName) => setSettings({ ...settings, senderName })}
          />
          <TextField
            label="Telepon konfirmasi"
            value={settings.senderPhone || ""}
            onChange={(senderPhone) =>
              setSettings({ ...settings, senderPhone })
            }
          />
          <TextField
            label="Email"
            value={settings.senderEmail || ""}
            onChange={(senderEmail) =>
              setSettings({ ...settings, senderEmail })
            }
          />
          <h2 className="mt-2 font-semibold">Nomor dan termin</h2>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Prefix"
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
              type="numeric"
              value={String(settings.defaultDueDays)}
              onChange={(value) =>
                setSettings({ ...settings, defaultDueDays: Number(value) })
              }
            />
            <TextField
              label="Jam reminder"
              type="numeric"
              value={String(settings.reminderHour)}
              onChange={(value) =>
                setSettings({ ...settings, reminderHour: Number(value) })
              }
            />
            <TextField
              label="Ulangi setiap (hari)"
              type="numeric"
              value={String(settings.reminderRepeatDays)}
              onChange={(value) =>
                setSettings({ ...settings, reminderRepeatDays: Number(value) })
              }
            />
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Timezone reminder</span>
            <input
              className="rounded-xl border bg-white px-3 py-2"
              value={settings.reminderTimezone}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  reminderTimezone: event.target.value,
                })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.reminderEnabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  reminderEnabled: event.target.checked,
                })
              }
            />
            Aktifkan reminder invoice overdue
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <h2 className="font-semibold">Default invoice & penerimaan</h2>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Satuan default</span>
            <select
              className="rounded-xl border bg-white px-3 py-2"
              value={settings.defaultUnitId || ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  defaultUnitId: event.target.value || null,
                })
              }
            >
              <option value="">pcs</option>
              {units
                .filter((item) => item.status === "ACTIVE")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Rekening penerimaan default</span>
            <select
              className="rounded-xl border bg-white px-3 py-2"
              value={settings.defaultAccountId || ""}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  defaultAccountId: event.target.value || null,
                })
              }
            >
              <option value="">Pilih saat pelunasan</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid gap-4 p-4">
          <div>
            <h2 className="font-semibold">Instruksi pembayaran</h2>
            <p className="text-xs text-muted-foreground">
              Maksimal tiga rekening atau e-wallet. Biarkan kosong untuk
              pembayaran tunai.
            </p>
          </div>
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid gap-2 rounded-xl border p-3">
              <TextField
                label={`Metode ${index + 1}`}
                value={settings.paymentInstructions[index]?.name || ""}
                onChange={(value) => updateInstruction(index, "name", value)}
              />
              <TextField
                label="Nomor rekening/e-wallet"
                value={settings.paymentInstructions[index]?.accountNumber || ""}
                onChange={(value) =>
                  updateInstruction(index, "accountNumber", value)
                }
              />
              <TextField
                label="Nama pemilik"
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
          <h2 className="font-semibold">Satuan</h2>
          <div className="my-3 flex gap-2">
            <div className="flex-1">
              <TextField
                label="Satuan custom"
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
            <h2 className="font-semibold">Backup & pemulihan invoice</h2>
            <p className="text-xs text-muted-foreground">
              Bundle terversi menyertakan pelanggan, invoice, pembayaran, ledger
              terkait, pengaturan, satuan, audit, dan aset logo. Restore selalu
              menjalankan dry-run checksum terlebih dahulu.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void downloadBackup()}
            >
              Unduh backup
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => restoreInput.current?.click()}
            >
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
        {busy ? "Menyimpan…" : "Simpan Pengaturan"}
      </Button>
    </div>
  );
}

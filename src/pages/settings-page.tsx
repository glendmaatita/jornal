import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Archive,
  BellOff,
  BellRing,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  Download,
  FileCog,
  Gauge,
  LayoutTemplate,
  Plus,
  RefreshCw,
  Save,
  Store,
  Trash2,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBrain } from "@fortawesome/free-solid-svg-icons/faBrain";
import { faBuilding } from "@fortawesome/free-solid-svg-icons/faBuilding";
import { faDatabase } from "@fortawesome/free-solid-svg-icons/faDatabase";
import { faSliders } from "@fortawesome/free-solid-svg-icons/faSliders";
import { faWallet } from "@fortawesome/free-solid-svg-icons/faWallet";

import { Button } from "@/components/ui/button";
import { CompanyLogoEditor } from "@/components/company-logo";
import { PageLoading } from "@/components/loading-screen";
import { Card, CardContent } from "@/components/ui/card";
import { DateField } from "@/components/ui/date-field";
import { TextField } from "@/components/ui/text-field";
import { categoryName } from "@/lib/categories";
import { activeCompany, resetCompany, updateCompany } from "@/lib/companies";
import { parseAmountInput, formatNumberInput } from "@/lib/format";

import {
  queryKeys,
  useAccounts,
  useCorrections,
  useProfile,
  useSettings,
  useTransactions,
} from "@/lib/queries";
import {
  clearCorrections,
  deleteAccount,
  deleteCorrection,
  exportLocalData,
  importLocalData,
  resetAllData,
  saveProfile,
  saveSettings,
  setCompanyScope,
  upsertAccount,
} from "@/lib/store";
import { allowedTaxSchemes } from "@/lib/tax";
import {
  BUSINESS_TYPE_LABELS,
  CLASSIFICATION_LABELS,
  type AccountType,
  type BusinessType,
  type TaxScheme,
} from "@/lib/types";
import {
  disablePushNotifications,
  enablePushNotifications,
} from "@/lib/push-client";

const BUSINESS_TYPES: BusinessType[] = [
  "INDIVIDUAL",
  "PT_PERORANGAN",
  "PT",
  "CV",
  "OTHER",
];

const SCHEMES = [
  { value: "UMKM_FINAL", label: "UMKM — PPh Final 0,5%" },
  { value: "PROGRESSIVE", label: "Orang Pribadi Progresif" },
  { value: "CORPORATE", label: "Badan — PPh 22%" },
  { value: "NOT_CALCULATED", label: "Tidak dihitung" },
] as const;

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHER", label: "Other" },
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useSettings();
  const { data: transactions = [] } = useTransactions();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [pushPreferences, setPushPreferences] = useState({
    invoice: true,
    tax: true,
    documents: true,
    hideAmounts: true,
    quietStartHour: 21,
    quietEndHour: 7,
  });
  const [storageInfo, setStorageInfo] = useState<{
    usage?: number;
    quota?: number;
  } | null>(null);
  const company = activeCompany();

  useEffect(() => {
    const estimate = navigator.storage?.estimate;
    if (!estimate) return;
    void estimate
      .call(navigator.storage)
      .then(({ usage, quota }) => {
        setStorageInfo({ usage, quota });
      })
      .catch(() => undefined);
  }, []);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(exportLocalData(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jornal-backup-${(company?.name ?? "company").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Give mobile browsers time to start the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setDataMessage("Backup berhasil dibuat.");
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setDataMessage("Backup terlalu besar. Pilih file sampai 10 MB.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (
        !window.confirm(
          "Pulihkan backup ini? Data pada perangkat akan digabungkan dengan isi backup.",
        )
      )
        return;
      const result = importLocalData(parsed);
      setDataMessage(`${result.imported} bagian data dipulihkan.`);
      invalidate();
    } catch (error) {
      setDataMessage(
        error instanceof Error
          ? error.message
          : "Backup tidak dapat dipulihkan.",
      );
    }
  };
  const { data: corrections = [] } = useCorrections();

  const [autoAccept, setAutoAccept] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState<string | null>(null);
  const [businessTypeDraft, setBusinessTypeDraft] =
    useState<BusinessType | null>(null);
  const [taxSchemeDraft, setTaxSchemeDraft] = useState<TaxScheme | null>(null);
  const [pkpStatusDraft, setPkpStatusDraft] = useState<boolean | null>(null);
  const [useAccountTrackingDraft, setUseAccountTrackingDraft] = useState<
    boolean | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const [newAccount, setNewAccount] = useState({
    name: "",
    type: "BANK" as AccountType,
    balance: "",
  });
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [startDateDraft, setStartDateDraft] = useState<string | null>(null);
  const [fiscalYearDraft, setFiscalYearDraft] = useState<string | null>(null);
  const [openingBalanceDraft, setOpeningBalanceDraft] = useState<string | null>(
    null,
  );
  const [accountBalanceDrafts, setAccountBalanceDrafts] = useState<
    Record<string, string>
  >({});
  const selectedBusinessType =
    businessTypeDraft ?? profile?.businessType ?? "INDIVIDUAL";
  const allowedSchemes = allowedTaxSchemes(selectedBusinessType);
  const selectedTaxScheme =
    taxSchemeDraft && allowedSchemes.includes(taxSchemeDraft)
      ? taxSchemeDraft
      : profile && allowedSchemes.includes(profile.taxScheme)
        ? profile.taxScheme
        : (allowedSchemes[0] ?? "NOT_CALCULATED");

  const invalidate = useCallback(() => {
    for (const key of [
      queryKeys.profile,
      queryKeys.accounts,
      queryKeys.settings,
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [queryClient]);

  if (!profile || !settings)
    return <PageLoading label="Memuat pengaturan…" />;

  if (company?.status === "ARCHIVED") {
    return (
      <div className="space-y-4 pb-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl tracking-tight">
            <Archive className="size-5 text-primary" aria-hidden="true" />
            Pengaturan
          </h1>
          <p className="text-sm text-muted-foreground">
            Company arsip hanya dapat dilihat dan diekspor.
          </p>
        </div>
        <Card>
          <CardContent className="space-y-3 p-5">
            <Link
              to="/companies"
              className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
            >
              <Building2 className="size-4" aria-hidden="true" />
              <span className="flex-1">Kelola atau pulihkan company</span>
              <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
            </Link>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={exportData}
            >
              <Download aria-hidden="true" />
              Unduh backup {company.name}
            </Button>
            {dataMessage && (
              <p className="text-xs text-muted-foreground" role="status">
                {dataMessage}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const saveAllChanges = async () => {
    const nextName = (nameDraft ?? company?.name ?? profile.businessName).trim();
    const nextAutoAccept = Number(autoAccept ?? settings.autoAccept);
    const nextNeedsReview = Number(needsReview ?? settings.needsReview);
    if (!nextName) {
      setDataMessage("Nama bisnis wajib diisi.");
      return;
    }
    if (
      !Number.isFinite(nextAutoAccept) ||
      !Number.isFinite(nextNeedsReview) ||
      nextAutoAccept <= 0 ||
      nextAutoAccept > 1 ||
      nextNeedsReview <= 0 ||
      nextNeedsReview > nextAutoAccept
    ) {
      setDataMessage(
        "Ambang klasifikasi harus antara 0–1 dan ambang review tidak boleh melebihi auto-accept.",
      );
      return;
    }

    setSaving(true);
    setSaveComplete(false);
    setDataMessage(null);
    try {
      if (company && nextName !== company.name) {
        await updateCompany(company, { name: nextName });
      }
      const useAccountTracking =
        useAccountTrackingDraft ?? profile.useAccountTracking;
      saveProfile({
        ...profile,
        businessName: nextName,
        businessType: selectedBusinessType,
        taxScheme: selectedTaxScheme,
        businessStartDate:
          startDateDraft === null
            ? profile.businessStartDate
            : startDateDraft || null,
        fiscalYear:
          parseAmountInput(fiscalYearDraft ?? String(profile.fiscalYear)) ||
          profile.fiscalYear,
        pkpStatus: pkpStatusDraft ?? profile.pkpStatus,
        useAccountTracking,
        openingBalance: useAccountTracking
          ? profile.openingBalance
          : parseAmountInput(
              openingBalanceDraft ?? String(profile.openingBalance),
            ),
      });
      saveSettings({
        ...settings,
        autoAccept: nextAutoAccept,
        needsReview: nextNeedsReview,
      });
      for (const account of accounts) {
        const draft = accountBalanceDrafts[account.id];
        if (draft === undefined) continue;
        upsertAccount({
          ...account,
          openingBalance: parseAmountInput(draft),
        });
      }
      setNameDraft(null);
      setBusinessTypeDraft(null);
      setTaxSchemeDraft(null);
      setStartDateDraft(null);
      setFiscalYearDraft(null);
      setPkpStatusDraft(null);
      setUseAccountTrackingDraft(null);
      setOpeningBalanceDraft(null);
      setAccountBalanceDrafts({});
      setAutoAccept(null);
      setNeedsReview(null);
      setDataMessage("Semua perubahan berhasil disimpan.");
      setSaveComplete(true);
      window.setTimeout(() => setSaveComplete(false), 2_000);
      invalidate();
    } catch (error) {
      setDataMessage(
        error instanceof Error ? error.message : "Perubahan gagal disimpan.",
      );
    } finally {
      setSaving(false);
    }
  };

  const useAccountTracking =
    useAccountTrackingDraft ?? profile.useAccountTracking;

  return (
    <div className="space-y-4 pb-28">
      <div>
        <h1 className="flex items-center gap-2 text-xl tracking-tight">
          <FontAwesomeIcon
            icon={faSliders}
            className="size-4 text-primary"
            aria-hidden="true"
          />
          Pengaturan
        </h1>
        <p className="text-sm text-muted-foreground">
          Profil bisnis, pajak, dan data aplikasi.
        </p>
      </div>

      {/* Business / tax profile (§41) */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FontAwesomeIcon
              icon={faBuilding}
              className="size-4 text-primary"
              aria-hidden="true"
            />
            Profil Bisnis & Pajak
          </h2>
          <Link
            to="/companies"
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
          >
            <Building2 className="size-4" aria-hidden="true" />
            <span className="flex-1">Kelola dan tambah company</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/settings/invoice"
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
          >
            <FileCog className="size-4" aria-hidden="true" />
            <span className="flex-1">Pengaturan Invoice</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          {company && <Link
            to="/companies/$companyId/team"
            params={{ companyId: company.id }}
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
          >
            <Users className="size-4" aria-hidden="true" />
            <span className="flex-1">Tim & undangan</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>}
          <Link
            to="/sync"
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span className="flex-1">Status sync & pemulihan konflik</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          <Link
            to="/templates"
            className="flex items-center gap-2.5 rounded-xl bg-secondary/60 px-3 py-2.5 text-sm font-semibold text-[var(--link)]"
          >
            <LayoutTemplate className="size-4" aria-hidden="true" />
            <span className="flex-1">Template transaksi</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
          {company && <CompanyLogoEditor company={company} />}
          <TextField
            label="Nama bisnis"
            icon={Store}
            value={nameDraft ?? company?.name ?? profile.businessName}
            onChange={(value) => setNameDraft(value)}
          />
          <label className="block">
            <span className="field-label">Jenis usaha</span>
            <select
              value={selectedBusinessType}
              onChange={(event) => {
                const nextBusinessType = event.target.value as BusinessType;
                setBusinessTypeDraft(nextBusinessType);
                const nextAllowedSchemes = allowedTaxSchemes(nextBusinessType);
                if (!nextAllowedSchemes.includes(selectedTaxScheme)) {
                  setTaxSchemeDraft(nextAllowedSchemes[0] ?? "NOT_CALCULATED");
                }
              }}
              className="field-shell !min-h-[50px] w-full !py-0 text-sm"
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUSINESS_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">
              Skema pajak (tax rules berversi)
            </span>
            <select
              value={selectedTaxScheme}
              onChange={(event) =>
                setTaxSchemeDraft(event.target.value as TaxScheme)
              }
              className="field-shell !min-h-[50px] w-full !py-0 text-sm"
            >
              {SCHEMES.filter((scheme) =>
                allowedSchemes.includes(scheme.value),
              ).map((scheme) => (
                <option key={scheme.value} value={scheme.value}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateField
              label="Mulai usaha"
              value={startDateDraft ?? profile.businessStartDate ?? ""}
              onChange={setStartDateDraft}
            />
            <TextField
              label="Tahun fiskal"
              icon={Calendar}
              type="numeric"
              value={fiscalYearDraft ?? String(profile.fiscalYear)}
              onChange={(value) => setFiscalYearDraft(value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-3">
            <span>
              <span className="block text-sm font-medium">Status PKP</span>
              <span className="text-xs text-muted-foreground">
                Pengusaha kena pajak
              </span>
            </span>
            <input
              type="checkbox"
              checked={pkpStatusDraft ?? profile.pkpStatus}
              onChange={(event) => setPkpStatusDraft(event.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <BellRing className="size-4 text-primary" aria-hidden="true" />
            Notifikasi & PWA
          </h2>
          <p className="text-xs text-muted-foreground">
            Pilih jenis notifikasi untuk perangkat ini. Setiap notifikasi selalu
            membuka layar review.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {(
              [
                ["invoice", "Invoice jatuh tempo"],
                ["tax", "Pajak"],
                ["documents", "Dokumen"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-xl bg-secondary/50 p-3"
              >
                <input
                  type="checkbox"
                  checked={pushPreferences[key]}
                  onChange={(event) =>
                    setPushPreferences((current) => ({
                      ...current,
                      [key]: event.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
            <label className="flex items-center gap-2 rounded-xl bg-secondary/50 p-3">
              <input
                type="checkbox"
                checked={pushPreferences.hideAmounts}
                onChange={(event) =>
                  setPushPreferences((current) => ({
                    ...current,
                    hideAmounts: event.target.checked,
                  }))
                }
              />
              Sembunyikan nominal
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Mode tenang mulai"
              icon={Clock}
              type="numeric"
              value={String(pushPreferences.quietStartHour)}
              onChange={(value) =>
                setPushPreferences((current) => ({
                  ...current,
                  quietStartHour: Math.min(23, Math.max(0, Number(value) || 0)),
                }))
              }
            />
            <TextField
              label="Mode tenang selesai"
              icon={Clock}
              type="numeric"
              value={String(pushPreferences.quietEndHour)}
              onChange={(value) =>
                setPushPreferences((current) => ({
                  ...current,
                  quietEndHour: Math.min(23, Math.max(0, Number(value) || 0)),
                }))
              }
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void enablePushNotifications(pushPreferences)
                  .then(() =>
                    setDataMessage(
                      "Preferensi notifikasi tersimpan pada perangkat ini.",
                    ),
                  )
                  .catch((error) => setDataMessage(String(error)))
              }
            >
              <BellRing aria-hidden="true" />
              Aktifkan notifikasi
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void disablePushNotifications().then(() =>
                  setDataMessage("Notifikasi perangkat dinonaktifkan."),
                )
              }
            >
              <BellOff aria-hidden="true" />
              Nonaktifkan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Accounts & opening balances (§31, §46.4) */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FontAwesomeIcon
              icon={faWallet}
              className="size-4 text-primary"
              aria-hidden="true"
            />
            Akun & Saldo Awal
          </h2>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-3">
            <span>
              <span className="block text-sm font-medium">
                Lacak lokasi uang
              </span>
              <span className="text-xs text-muted-foreground">
                Meningkatkan akurasi Safe To Spend
              </span>
            </span>
            <input
              type="checkbox"
              checked={useAccountTracking}
              onChange={(event) =>
                setUseAccountTrackingDraft(event.target.checked)
              }
              className="size-4 accent-[var(--primary)]"
            />
          </label>

          {useAccountTracking ? (
            <>
              <div className="divide-y divide-border/40">
                {accounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {account.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {
                          ACCOUNT_TYPES.find(
                            (type) => type.value === account.type,
                          )?.label
                        }
                      </p>
                    </div>
                    <TextField
                      type="amount"
                      prefix="Rp"
                      className="w-36"
                      inputClassName="text-right text-sm"
                      value={
                        accountBalanceDrafts[account.id] ??
                        (account.openingBalance > 0
                          ? formatNumberInput(account.openingBalance)
                          : "")
                      }
                      onChange={(value) =>
                        setAccountBalanceDrafts((current) => ({
                          ...current,
                          [account.id]: value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        deleteAccount(account.id);
                        invalidate();
                      }}
                      className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Hapus ${account.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextField
                  label="Nama akun"
                  icon={Wallet}
                  value={newAccount.name}
                  onChange={(name) =>
                    setNewAccount((current) => ({ ...current, name }))
                  }
                  placeholder="Nama akun"
                />
                <TextField
                  label="Saldo awal"
                  type="amount"
                  prefix="Rp"
                  value={newAccount.balance}
                  onChange={(balance) =>
                    setNewAccount((current) => ({ ...current, balance }))
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={newAccount.type}
                  onChange={(event) =>
                    setNewAccount((current) => ({
                      ...current,
                      type: event.target.value as AccountType,
                    }))
                  }
                  className="field-shell !min-h-[46px] w-full !py-0 text-sm"
                  aria-label="Jenis akun"
                >
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                <Button
                  onClick={() => {
                    if (!newAccount.name.trim()) return;
                    upsertAccount({
                      name: newAccount.name.trim(),
                      type: newAccount.type,
                      openingBalance: parseAmountInput(newAccount.balance),
                      includedInCash: true,
                    });
                    setNewAccount({ name: "", type: "BANK", balance: "" });
                    invalidate();
                  }}
                >
                  <Plus aria-hidden="true" />
                  Tambah
                </Button>
              </div>
            </>
          ) : (
            <div>
              <TextField
                label="Saldo awal bisnis"
                type="amount"
                prefix="Rp"
                value={
                  openingBalanceDraft ??
                  (profile.openingBalance > 0
                    ? formatNumberInput(profile.openingBalance)
                    : "")
                }
                onChange={(value) => setOpeningBalanceDraft(value)}
                hint="Saldo awal tidak dihitung sebagai omzet."
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Classification thresholds (§22) */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FontAwesomeIcon
              icon={faSliders}
              className="size-4 text-primary"
              aria-hidden="true"
            />
            Ambang Klasifikasi
          </h2>
          <p className="text-xs text-muted-foreground">
            ≥ {Math.round(settings.autoAccept * 100)}% otomatis diterima ·{" "}
            {Math.round(settings.needsReview * 100)}–
            {Math.round(settings.autoAccept * 100) - 1}% diterima + saran · &lt;{" "}
            {Math.round(settings.needsReview * 100)}% butuh konfirmasi
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Auto-accept (mis. 0.90)"
              icon={Gauge}
              value={autoAccept ?? String(settings.autoAccept)}
              onChange={(value) => setAutoAccept(value)}
            />
            <TextField
              label="Butuh review (mis. 0.70)"
              icon={Gauge}
              value={needsReview ?? String(settings.needsReview)}
              onChange={(value) => setNeedsReview(value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Learning loop (§25 — activated in Phase 2) + classification metrics */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FontAwesomeIcon
              icon={faBrain}
              className="size-4 text-primary"
              aria-hidden="true"
            />
            Pola yang Dipelajari
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ketika Anda mengoreksi klasifikasi, sistem menyimpan pola. Transaksi
            serupa berikutnya otomatis diklasifikasi dengan keyakinan lebih
            tinggi.
          </p>

          <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">
                Otomatis diterima
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {transactions.length > 0
                  ? Math.round(
                      (transactions.filter(
                        (transaction) =>
                          transaction.reviewStatus === "AUTO_ACCEPTED",
                      ).length /
                        transactions.length) *
                        100,
                    )
                  : 0}
                %
              </p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">Butuh review</p>
              <p className="text-sm font-semibold tabular-nums">
                {
                  transactions.filter(
                    (transaction) =>
                      transaction.reviewStatus === "NEEDS_REVIEW",
                  ).length
                }
              </p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">
                Pola dipelajari
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {corrections.length}
              </p>
            </div>
          </div>

          {corrections.length > 0 ? (
            <>
              <div className="divide-y divide-border/40">
                {corrections.map((pattern) => (
                  <div
                    key={pattern.id}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        "{pattern.token}"
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {categoryName(pattern.categoryId)} ·{" "}
                        {CLASSIFICATION_LABELS[pattern.classification]} ·{" "}
                        {pattern.occurrences}×
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCorrection(pattern.id);
                        invalidate();
                      }}
                      className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Hapus pola ${pattern.token}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Hapus semua pola yang dipelajari?")) {
                    clearCorrections();
                    invalidate();
                  }
                }}
                className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
              >
                Hapus semua pola
              </button>
            </>
          ) : (
            <p className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
              Belum ada pola. Koreksi klasifikasi saat menyimpan transaksi dan
              pola akan muncul di sini.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FontAwesomeIcon
              icon={faDatabase}
              className="size-4 text-primary"
              aria-hidden="true"
            />
            Data
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Semua data tersimpan di perangkat ini (offline-ready). Total
            transaksi tercatat: {transactions.length}.
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {storageInfo?.usage !== undefined && storageInfo.quota
              ? `Penyimpanan terpakai ${formatStorageSize(storageInfo.usage)} dari ${formatStorageSize(storageInfo.quota)}.`
              : "Status kapasitas penyimpanan belum tersedia di browser ini."}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={exportData}>
              <Download aria-hidden="true" />
              Unduh backup
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => importInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              Pulihkan backup
            </Button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              void importData(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {dataMessage && (
            <p className="text-xs text-muted-foreground" role="status">
              {dataMessage}
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              if (
                company &&
                window.confirm(
                  `Reset semua data company ${company.name}? Company lain tidak akan terpengaruh.`,
                )
              ) {
                void resetCompany(company)
                  .then(async (updated) => {
                    setCompanyScope(updated.id, updated.dataEpoch, updated.tenantId, updated.membershipRevision);
                    await resetAllData({ remoteAlreadyReset: true });
                    window.location.href = `/companies/${encodeURIComponent(updated.id)}/setup?company=${encodeURIComponent(updated.id)}`;
                  })
                  .catch((cause) =>
                    setDataMessage(
                      cause instanceof Error
                        ? cause.message
                        : "Company gagal direset",
                    ),
                  );
              }
            }}
            className="w-full rounded-xl border border-destructive/40 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            Reset data company ini
          </button>
        </CardContent>
      </Card>
      <div className="fixed inset-x-4 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[568px] rounded-2xl border border-white/70 bg-white/95 p-3 shadow-[0_8px_30px_rgb(27_29_77/0.18)] backdrop-blur">
        {dataMessage && (
          <p className="mb-2 text-center text-xs text-muted-foreground" role="status">
            {dataMessage}
          </p>
        )}
        <Button
          type="button"
          className="w-full"
          disabled={saving}
          onClick={() => void saveAllChanges()}
        >
          <Save aria-hidden="true" />
          {saving
            ? "Menyimpan…"
            : saveComplete
              ? "Perubahan tersimpan"
              : "Simpan perubahan"}
        </Button>
      </div>
    </div>
  );
}

function formatStorageSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1024)
    return `${Math.max(0, Math.round(bytes))} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

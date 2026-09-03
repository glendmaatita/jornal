import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { TextField } from "@/components/ui/text-field"
import { categoryName } from "@/lib/categories"
import { parseAmountInput, formatNumberInput } from "@/lib/format"

import { queryKeys, useAccounts, useCorrections, useProfile, useSettings, useTransactions } from "@/lib/queries"
import { clearCorrections, deleteAccount, deleteCorrection, resetAllData, saveProfile, saveSettings, upsertAccount } from "@/lib/store"
import { allowedTaxSchemes } from "@/lib/tax"
import { BUSINESS_TYPE_LABELS, CLASSIFICATION_LABELS, type AccountType, type BusinessType } from "@/lib/types"

const BUSINESS_TYPES: BusinessType[] = ["INDIVIDUAL", "PT_PERORANGAN", "PT", "CV", "OTHER"]

const SCHEMES = [
  { value: "UMKM_FINAL", label: "UMKM — PPh Final 0,5%" },
  { value: "PROGRESSIVE", label: "Orang Pribadi Progresif" },
  { value: "CORPORATE", label: "Badan — PPh 22%" },
  { value: "NOT_CALCULATED", label: "Tidak dihitung" },
] as const

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHER", label: "Other" },
]

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: profile } = useProfile()
  const { data: accounts = [] } = useAccounts()
  const { data: settings } = useSettings()
  const { data: transactions = [] } = useTransactions()
  const { data: corrections = [] } = useCorrections()

  const [autoAccept, setAutoAccept] = useState<string | null>(null)
  const [needsReview, setNeedsReview] = useState<string | null>(null)
  const [newAccount, setNewAccount] = useState({ name: "", type: "BANK" as AccountType, balance: "" })
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [startDateDraft, setStartDateDraft] = useState<string | null>(null)
  const [fiscalYearDraft, setFiscalYearDraft] = useState<string | null>(null)
  const [openingBalanceDraft, setOpeningBalanceDraft] = useState<string | null>(null)
  const [accountBalanceDrafts, setAccountBalanceDrafts] = useState<Record<string, string>>({})
  const allowedSchemes = allowedTaxSchemes(profile?.businessType ?? "INDIVIDUAL")
  const selectedTaxScheme = profile && allowedSchemes.includes(profile.taxScheme) ? profile.taxScheme : allowedSchemes[0] ?? "NOT_CALCULATED"

  const invalidate = useCallback(() => {
    for (const key of [queryKeys.profile, queryKeys.accounts, queryKeys.settings]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }, [queryClient])

  useEffect(() => {
    if (!profile) return
    if (!allowedSchemes.includes(profile.taxScheme)) {
      saveProfile({ ...profile, taxScheme: allowedSchemes[0] ?? "NOT_CALCULATED" })
      invalidate()
    }
  }, [allowedSchemes, profile, invalidate])

  if (!profile || !settings) return null

  const commitProfile = (patch: Partial<typeof profile>) => {
    saveProfile({ ...profile, ...patch })
    invalidate()
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-xl tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">Profil bisnis, pajak, dan data aplikasi.</p>
      </div>

      {/* Business / tax profile (§41) */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="text-lg tracking-tight">Profil Bisnis & Pajak</h2>
          <TextField
            label="Nama bisnis"
            value={nameDraft ?? profile.businessName}
            onChange={(value) => setNameDraft(value)}
            onBlur={() => nameDraft !== null && commitProfile({ businessName: nameDraft.trim() })}
          />
          <label className="block">
            <span className="field-label">Jenis usaha</span>
            <select
              value={profile.businessType}
              onChange={(event) => commitProfile({ businessType: event.target.value as BusinessType })}
              className="field-shell !min-h-[50px] w-full !py-0 text-sm"
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>{BUSINESS_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Skema pajak (tax rules berversi)</span>
            <select
              value={selectedTaxScheme}
              onChange={(event) => commitProfile({ taxScheme: event.target.value as typeof profile.taxScheme })}
              className="field-shell !min-h-[50px] w-full !py-0 text-sm"
            >
              {SCHEMES.filter((scheme) => allowedSchemes.includes(scheme.value)).map((scheme) => (
                <option key={scheme.value} value={scheme.value}>{scheme.label}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DateField
              label="Mulai usaha"
              value={startDateDraft ?? profile.businessStartDate ?? ""}
              onChange={(value) => {
                setStartDateDraft(value)
                commitProfile({ businessStartDate: value || null })
              }}
            />
            <TextField
              label="Tahun fiskal"
              type="numeric"
              value={fiscalYearDraft ?? String(profile.fiscalYear)}
              onChange={(value) => setFiscalYearDraft(value)}
              onBlur={() => commitProfile({ fiscalYear: parseAmountInput(fiscalYearDraft ?? "") || profile.fiscalYear })}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-3">
            <span>
              <span className="block text-sm font-medium">Status PKP</span>
              <span className="text-xs text-muted-foreground">Pengusaha kena pajak</span>
            </span>
            <input
              type="checkbox"
              checked={profile.pkpStatus}
              onChange={(event) => commitProfile({ pkpStatus: event.target.checked })}
              className="size-4 accent-[var(--primary)]"
            />
          </label>
        </CardContent>
      </Card>

      {/* Accounts & opening balances (§31, §46.4) */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg tracking-tight">Akun & Saldo Awal</h2>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 p-3">
            <span>
              <span className="block text-sm font-medium">Lacak lokasi uang</span>
              <span className="text-xs text-muted-foreground">Meningkatkan akurasi Safe To Spend</span>
            </span>
            <input
              type="checkbox"
              checked={profile.useAccountTracking}
              onChange={(event) => commitProfile({ useAccountTracking: event.target.checked })}
              className="size-4 accent-[var(--primary)]"
            />
          </label>

          {profile.useAccountTracking ? (
            <>
              <div className="divide-y divide-border/40">
                {accounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{ACCOUNT_TYPES.find((type) => type.value === account.type)?.label}</p>
                    </div>
                    <TextField
                      type="amount"
                      prefix="Rp"
                      className="w-36"
                      inputClassName="text-right text-sm"
                      value={accountBalanceDrafts[account.id] ?? (account.openingBalance > 0 ? formatNumberInput(account.openingBalance) : "")}
                      onChange={(value) => setAccountBalanceDrafts((current) => ({ ...current, [account.id]: value }))}
                      onBlur={() => {
                        upsertAccount({ ...account, openingBalance: parseAmountInput(accountBalanceDrafts[account.id] ?? "") })
                        invalidate()
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        deleteAccount(account.id)
                        invalidate()
                      }}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Hapus ${account.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextField label="Nama akun" value={newAccount.name} onChange={(name) => setNewAccount((current) => ({ ...current, name }))} placeholder="Nama akun" />
                <TextField label="Saldo awal" type="amount" prefix="Rp" value={newAccount.balance} onChange={(balance) => setNewAccount((current) => ({ ...current, balance }))} />
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={newAccount.type}
                  onChange={(event) => setNewAccount((current) => ({ ...current, type: event.target.value as AccountType }))}
                  className="field-shell !min-h-[46px] w-full !py-0 text-sm"
                  aria-label="Jenis akun"
                >
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <Button onClick={() => {
                  if (!newAccount.name.trim()) return
                  upsertAccount({
                    name: newAccount.name.trim(),
                    type: newAccount.type,
                    openingBalance: parseAmountInput(newAccount.balance),
                    includedInCash: true,
                  })
                  setNewAccount({ name: "", type: "BANK", balance: "" })
                  invalidate()
                }}>
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
                  value={openingBalanceDraft ?? (profile.openingBalance > 0 ? formatNumberInput(profile.openingBalance) : "")}
                  onChange={(value) => setOpeningBalanceDraft(value)}
                  onBlur={() => commitProfile({ openingBalance: parseAmountInput(openingBalanceDraft ?? "") })}
                  hint="Saldo awal tidak dihitung sebagai omzet."
                />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Classification thresholds (§22) */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg tracking-tight">Ambang Klasifikasi</h2>
          <p className="text-xs text-muted-foreground">
            ≥ {Math.round(settings.autoAccept * 100)}% otomatis diterima · {" "}
            {Math.round(settings.needsReview * 100)}–{Math.round(settings.autoAccept * 100) - 1}% diterima + saran ·{" "}
            &lt; {Math.round(settings.needsReview * 100)}% butuh konfirmasi
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField
              label="Auto-accept (mis. 0.90)"
              value={autoAccept ?? String(settings.autoAccept)}
              onChange={(value) => setAutoAccept(value)}
              onBlur={() => {
                const value = Number(autoAccept)
                if (Number.isFinite(value) && value > 0 && value <= 1) {
                  saveSettings({ ...settings, autoAccept: value })
                  invalidate()
                } else {
                  setAutoAccept(null)
                }
              }}
            />
            <TextField
              label="Butuh review (mis. 0.70)"
              value={needsReview ?? String(settings.needsReview)}
              onChange={(value) => setNeedsReview(value)}
              onBlur={() => {
                const value = Number(needsReview)
                if (Number.isFinite(value) && value > 0 && value <= 1) {
                  saveSettings({ ...settings, needsReview: value })
                  invalidate()
                } else {
                  setNeedsReview(null)
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Learning loop (§25 — activated in Phase 2) + classification metrics */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg tracking-tight">Pola yang Dipelajari</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ketika Anda mengoreksi klasifikasi, sistem menyimpan pola. Transaksi serupa berikutnya otomatis diklasifikasi
            dengan keyakinan lebih tinggi.
          </p>

          <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">Otomatis diterima</p>
              <p className="text-sm font-semibold tabular-nums">
                {transactions.length > 0
                  ? Math.round((transactions.filter((transaction) => transaction.reviewStatus === "AUTO_ACCEPTED").length / transactions.length) * 100)
                  : 0}
                %
              </p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">Butuh review</p>
              <p className="text-sm font-semibold tabular-nums">
                {transactions.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW").length}
              </p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-[10px] text-muted-foreground">Pola dipelajari</p>
              <p className="text-sm font-semibold tabular-nums">{corrections.length}</p>
            </div>
          </div>

          {corrections.length > 0 ? (
            <>
              <div className="divide-y divide-border/40">
                {corrections.map((pattern) => (
                  <div key={pattern.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">"{pattern.token}"</p>
                      <p className="text-xs text-muted-foreground">
                        {categoryName(pattern.categoryId)} · {CLASSIFICATION_LABELS[pattern.classification]} · {pattern.occurrences}×
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        deleteCorrection(pattern.id)
                        invalidate()
                      }}
                      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
                    clearCorrections()
                    invalidate()
                  }
                }}
                className="text-xs font-medium text-muted-foreground underline hover:text-foreground"
              >
                Hapus semua pola
              </button>
            </>
          ) : (
            <p className="rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
              Belum ada pola. Koreksi klasifikasi saat menyimpan transaksi dan pola akan muncul di sini.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Data */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg tracking-tight">Data</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Semua data tersimpan di perangkat ini (offline-ready). Total transaksi tercatat: {transactions.length}.
          </p>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Hapus SEMUA data (profil, transaksi, akun, reserve)? Tindakan ini tidak bisa dibatalkan.")) {
                resetAllData()
                window.location.href = "/onboarding"
              }
            }}
            className="w-full rounded-xl border border-destructive/40 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            Hapus semua data
          </button>
        </CardContent>
      </Card>
    </div>
  )
}

import { useState } from "react"
import { ArrowLeft, ArrowRight, Check, Landmark, Scale, Store, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateField } from "@/components/ui/date-field"
import { TextField } from "@/components/ui/text-field"
import { parseAmountInput } from "@/lib/format"
import { consumeCompanyCreationReturn, createCompanyWithSetup, loadCachedCompanies } from "@/lib/companies"
import { pb } from "@/lib/pb"
import { initializePocketBaseSync, resetPocketBaseSyncState } from "@/lib/pocketbase-sync"
import { emptyProfile, setCompanyScope, setTenantScope } from "@/lib/store"
import { allowedTaxSchemes } from "@/lib/tax"
import { BUSINESS_TYPE_LABELS, type BusinessType, type TaxScheme } from "@/lib/types"
import { cn } from "@/lib/utils"

const BUSINESS_TYPES: BusinessType[] = ["INDIVIDUAL", "PT_PERORANGAN", "PT", "CV", "OTHER"]

const TAX_SCHEMES: { value: TaxScheme; label: string; hint: string; types: BusinessType[] }[] = [
  {
    value: "UMKM_FINAL",
    label: "UMKM — PPh Final 0,5%",
    hint: "Omzet di bawah Rp4,8 M/tahun. Estimasi pajak = 0,5% × omzet.",
    types: ["INDIVIDUAL", "PT_PERORANGAN", "PT", "CV", "OTHER"],
  },
  {
    value: "PROGRESSIVE",
    label: "Orang Pribadi Progresif",
    hint: "Estimasi tarif progresif atas omzet tahunan di atas PTKP.",
    types: ["INDIVIDUAL", "OTHER"],
  },
  {
    value: "CORPORATE",
    label: "Badan — PPh 22%",
    hint: "Estimasi 22% atas laba (omzet − pengeluaran bisnis).",
    types: ["PT", "CV", "PT_PERORANGAN"],
  },
  {
    value: "NOT_CALCULATED",
    label: "Atur nanti",
    hint: "Estimasi pajak dan Safe To Spend akan kurang akurat.",
    types: BUSINESS_TYPES,
  },
]

const DEFAULT_ACCOUNTS = [
  { name: "Cash", type: "CASH" as const },
  { name: "BCA", type: "BANK" as const },
  { name: "Mandiri", type: "BANK" as const },
  { name: "GoPay", type: "EWALLET" as const },
]

export function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [businessName, setBusinessName] = useState("")
  const [businessType, setBusinessType] = useState<BusinessType>("INDIVIDUAL")
  const [businessStartDate, setBusinessStartDate] = useState("")
  const [taxScheme, setTaxScheme] = useState<TaxScheme>("UMKM_FINAL")
  const [pkpStatus, setPkpStatus] = useState(false)
  const [useAccountTracking, setUseAccountTracking] = useState(true)
  const [openingBalance, setOpeningBalance] = useState("")
  const [accountBalances, setAccountBalances] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [creationKey] = useState(() => {
    const key = `jornal.company-setup-key.${window.location.pathname}`
    const existing = window.sessionStorage.getItem(key)
    if (existing) return existing
    const created = crypto.randomUUID()
    window.sessionStorage.setItem(key, created)
    return created
  })
  const allowedSchemes = allowedTaxSchemes(businessType)
  const selectedTaxScheme = allowedSchemes.includes(taxScheme) ? taxScheme : allowedSchemes[0] ?? "NOT_CALCULATED"
  const duplicateName = businessName.trim().length > 0 && loadCachedCompanies().some((company) =>
    company.name.localeCompare(businessName.trim(), "id", { sensitivity: "accent" }) === 0,
  )

  const changeBusinessType = (type: BusinessType) => {
    setBusinessType(type)
    const nextAllowed = allowedTaxSchemes(type)
    setTaxScheme((current) => (nextAllowed.includes(current) ? current : nextAllowed[0] ?? "NOT_CALCULATED"))
  }

  const finish = async () => {
    if (saving) return
    setSaving(true)
    setError("")
    const now = new Date().toISOString()
    const profile = {
      ...emptyProfile(),
      businessName: businessName.trim(),
      businessType,
      businessStartDate: businessStartDate || null,
      taxScheme: selectedTaxScheme,
      pkpStatus,
      useAccountTracking,
      openingBalance: useAccountTracking ? 0 : parseAmountInput(openingBalance),
      onboardingCompletedAt: new Date().toISOString(),
    }
    const accounts = useAccountTracking
      ? DEFAULT_ACCOUNTS.map((account) => ({
          id: crypto.randomUUID(),
          name: account.name,
          type: account.type,
          openingBalance: parseAmountInput(accountBalances[account.name] ?? ""),
          includedInCash: true,
          createdAt: now,
          updatedAt: now,
        }))
      : []
    try {
      const company = await createCompanyWithSetup({
        name: profile.businessName,
        creationKey,
        requestId: crypto.randomUUID(),
        initialSetup: window.location.pathname === "/onboarding",
        companyId: window.location.pathname.match(/^\/companies\/([^/]+)\/setup$/)?.[1],
        profile,
        accounts,
      })
      setTenantScope(pb.authStore.record?.id)
      setCompanyScope(company.id, company.dataEpoch, company.tenantId, company.membershipRevision)
      resetPocketBaseSyncState()
      await initializePocketBaseSync()
      window.sessionStorage.removeItem(`jornal.company-setup-key.${window.location.pathname}`)
      window.sessionStorage.removeItem("jornal.create-company-intent")
      let pendingRoute = ""
      try {
        pendingRoute = window.sessionStorage.getItem("jornal.pending-route") ?? ""
        window.sessionStorage.removeItem("jornal.pending-route")
      } catch { /* continue to home when session storage is unavailable */ }
      let safePending = ""
      try { const parsed = new URL(pendingRoute, window.location.origin); if (parsed.origin === window.location.origin && pendingRoute.startsWith("/") && !pendingRoute.startsWith("//")) safePending = `${parsed.pathname}${parsed.search}${parsed.hash}` } catch { /* discard invalid route */ }
      const destination = window.location.pathname === "/companies/new" ? "/" : safePending || "/"
      const separator = destination.includes("?") ? "&" : "?"
      window.location.assign(`${destination}${separator}company=${encodeURIComponent(company.id)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Company gagal dibuat. Coba lagi.")
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      {window.location.pathname === "/companies/new" && (
        <button type="button" className="mb-5 text-sm font-semibold text-[var(--link)]" onClick={() => window.location.assign(consumeCompanyCreationReturn() ?? "/companies")}>Batal dan kembali</button>
      )}
      <div className="mb-8 flex items-center justify-center gap-2">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn("h-1.5 w-10 rounded-full transition-colors", index <= step ? "bg-primary" : "bg-border")}
          />
        ))}
      </div>

      {step === 0 && (
        <section>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase"><Store className="size-3.5" aria-hidden="true" />Selamat datang</p>
          <h1 className="mt-2 text-3xl tracking-tight">Ceritakan bisnis Anda</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Cukup catat uang masuk dan keluar — sisanya (klasifikasi, omzet, pajak) dihitung sistem.
          </p>
          <div className="mt-6 space-y-4">
            <TextField
              label="Nama bisnis"
              icon={Store}
              value={businessName}
              onChange={setBusinessName}
              placeholder="Kedai Kopi Senja"
              hint={duplicateName ? "Nama ini sudah dipakai company lain. Anda tetap boleh melanjutkan." : undefined}
              required
            />
            <fieldset>
              <legend className="field-label">Jenis usaha</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {BUSINESS_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => changeBusinessType(type)}
                    className={cn(
                      "rounded-[10px] border px-3 py-2.5 text-sm font-semibold transition-colors",
                      businessType === type
                        ? "border-[var(--main-dark)] bg-[var(--main-dark)] text-white"
                        : "border-border bg-white text-[var(--body-text)]",
                    )}
                  >
                    {BUSINESS_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>
            </fieldset>
            <DateField label="Tanggal mulai usaha" value={businessStartDate} onChange={setBusinessStartDate} />
          </div>
          <Button className="mt-7 w-full" size="lg" onClick={() => setStep(1)} disabled={!businessName.trim()}>
            Lanjut
            <ArrowRight aria-hidden="true" />
          </Button>
        </section>
      )}

      {step === 1 && (
        <section>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase"><Scale className="size-3.5" aria-hidden="true" />Profil pajak</p>
          <h1 className="mt-2 text-3xl tracking-tight">Skema perhitungan pajak</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Tax engine memakai aturan berversi — perubahan regulasi tidak mengubah hitungan historis Anda.
          </p>
          <div className="mt-6 space-y-2.5">
            {TAX_SCHEMES.filter((scheme) => allowedSchemes.includes(scheme.value)).map((scheme) => (
              <button
                key={scheme.value}
                type="button"
                onClick={() => setTaxScheme(scheme.value)}
                className={cn(
                  "w-full rounded-xl border p-4 text-left transition-colors",
                  selectedTaxScheme === scheme.value ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-accent",
                )}
              >
                <span className="flex items-center justify-between text-sm font-semibold">
                  {scheme.label}
                  {selectedTaxScheme === scheme.value && <Check className="size-4 text-primary" aria-hidden="true" />}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{scheme.hint}</span>
              </button>
            ))}
          </div>
          <label className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <input
              type="checkbox"
              checked={pkpStatus}
              onChange={(event) => setPkpStatus(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-medium">Saya sudah PKP (pengusaha kena pajak)</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Memengaruhi saran perencanaan pajak.</span>
            </span>
          </label>
          <div className="mt-7 flex gap-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setStep(0)}>
              <ArrowLeft aria-hidden="true" />
              Kembali
            </Button>
            <Button className="flex-1" size="lg" onClick={() => setStep(2)}>
              Lanjut
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase"><Landmark className="size-3.5" aria-hidden="true" />Saldo awal</p>
          <h1 className="mt-2 text-3xl tracking-tight">Dari mana uang Anda sekarang?</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Saldo awal adalah titik awal — <strong>tidak dihitung sebagai omzet</strong>.
          </p>

          <label className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <input
              type="checkbox"
              checked={useAccountTracking}
              onChange={(event) => setUseAccountTracking(event.target.checked)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-medium">Lacak lokasi uang (rekening & kas)</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Disarankan. Tanpa ini, keyakinan data Safe To Spend akan lebih rendah.
              </span>
            </span>
          </label>

          {useAccountTracking ? (
            <div className="mt-4 space-y-2.5">
              {DEFAULT_ACCOUNTS.map((account) => (
                <TextField
                  key={account.name}
                  label={account.name}
                  type="amount"
                  prefix="Rp"
                  value={accountBalances[account.name] ?? ""}
                  onChange={(value) => setAccountBalances((current) => ({ ...current, [account.name]: value }))}
                />
              ))}
              <p className="text-xs text-[var(--body-text)]">Saldo gabungan akun-akun ini menjadi Posisi Kas awal Anda.</p>
            </div>
          ) : (
            <div className="mt-4">
              <TextField label="Saldo bisnis saat ini" type="amount" prefix="Rp" value={openingBalance} onChange={setOpeningBalance} />
            </div>
          )}

          <div className="mt-7 flex gap-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setStep(1)}>
              <ArrowLeft aria-hidden="true" />
              Kembali
            </Button>
            <Button className="flex-1" size="lg" onClick={() => void finish()} disabled={saving}>
              <Wallet aria-hidden="true" />
              {saving ? "Membuat company…" : "Mulai mencatat"}
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        </section>
      )}
    </div>
  )
}

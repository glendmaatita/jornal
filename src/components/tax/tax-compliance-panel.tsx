import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { BellRing, CalendarClock, CheckCircle2, CircleDollarSign, Download, FileCheck2, Plus, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { TextField } from "@/components/ui/text-field"
import { activeCompany } from "@/lib/companies"
import { formatRupiah, parseAmountInput, todayIsoDate } from "@/lib/format"
import { transactionRevenueAmount } from "@/lib/transaction-revenue"
import {
  addTaxRegistration,
  amendTaxFiling,
  completeTaxFiling,
  confirmTaxObligationAmount,
  createTaxSettlement,
  downloadTaxBackup,
  downloadTaxEvidence,
  downloadTaxReport,
  endTaxMembership,
  endTaxRegistration,
  generateTaxObligations,
  linkCompanyToTaxSubject,
  markTaxInboxRead,
  overrideTaxDeadline,
  previewTaxBackup,
  restoreTaxBackup,
  reverseTaxSettlement,
  saveTaxPeriodInput,
  snoozeTaxObligation,
  setupTaxSubject,
  taxComplianceEnabled,
  updateTaxNotificationPreference, saveOwnTaxNotificationPreference,
  updateTaxSubject,
  uploadTaxEvidence,
} from "@/lib/tax-compliance-client"
import { taxQueryKeys, useTaxAgenda, useTaxConfiguration, useTaxInbox } from "@/lib/tax-compliance-queries"
import type { BusinessProfile, Transaction } from "@/lib/types"
import type { TaxFiling, TaxKind, TaxObligation, TaxSubject } from "@/lib/tax-compliance-types"

const TAX_OPTIONS: Array<{ kind: TaxKind; label: string; event?: boolean }> = [
  { kind: "PPH_FINAL_UMKM", label: "PPh Final UMKM 0,5%" },
  { kind: "PPH_21_26_PAYROLL", label: "PPh 21/26 pegawai" },
  { kind: "PPH_23_26", label: "PPh 23/26 non-payroll" },
  { kind: "PPH_4_2_OTHER", label: "PPh 4(2) selain UMKM" },
  { kind: "PPH_15", label: "PPh Pasal 15" },
  { kind: "PPH_22", label: "PPh Pasal 22" },
  { kind: "PPH_25", label: "Angsuran PPh 25" },
  { kind: "PPN_PPNBM", label: "SPT Masa PPN/PPnBM" },
  { kind: "PPN_SPECIAL", label: "PPN khusus", event: true },
  { kind: "PPH_29", label: "PPh 29 tahunan" },
  { kind: "PBB", label: "PBB", event: true },
  { kind: "LOCAL_TAX", label: "Pajak daerah", event: true },
  { kind: "STAMP_DUTY", label: "Bea meterai", event: true },
  { kind: "ASSESSMENT", label: "STP/SKP atau angsuran resmi", event: true },
  { kind: "OTHER", label: "Kewajiban pajak lain", event: true },
]

const KIND_LABEL = Object.fromEntries(TAX_OPTIONS.map((item) => [item.kind, item.label])) as Partial<Record<TaxKind, string>>
const RELEVANCE_QUESTIONS: Array<{ label: string; kinds: TaxKind[] }> = [
  { label: "Memiliki pegawai atau membayar imbalan orang pribadi", kinds: ["PPH_21_26_PAYROLL"] },
  { label: "Membayar jasa, royalti, atau transaksi luar negeri", kinds: ["PPH_23_26"] },
  { label: "Menyewa tanah/bangunan atau memiliki objek final lain", kinds: ["PPH_4_2_OTHER"] },
  { label: "Melakukan impor atau berperan sebagai pemungut", kinds: ["PPH_22"] },
  { label: "Memiliki angsuran PPh 25 yang masih berlaku", kinds: ["PPH_25"] },
  { label: "Berstatus PKP", kinds: ["PPN_PPNBM"] },
  { label: "Memiliki objek PBB atau kewajiban pajak daerah", kinds: ["PBB", "LOCAL_TAX"] },
  { label: "Memiliki STP/SKP atau jadwal angsuran resmi", kinds: ["ASSESSMENT"] },
]

function commandKey(prefix: string) { return `${prefix}-${crypto.randomUUID()}` }
function currentPeriod() { return todayIsoDate().slice(0, 7) }
function dateOnly(value: string | null) { return value ? value.slice(0, 10) : null }

export function TaxCompliancePanel({ profile, transactions }: { profile: BusinessProfile; transactions: Transaction[] }) {
  const queryClient = useQueryClient()
  const company = activeCompany()
  const configuration = useTaxConfiguration()
  const agenda = useTaxAgenda()
  const inbox = useTaxInbox()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayIsoDate()
  const companyMembership = configuration.data?.memberships
    .filter((membership) => membership.company_id === company?.id && membership.effective_from.slice(0, 10) <= today && (!membership.effective_until || membership.effective_until.slice(0, 10) >= today))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
  const subject = configuration.data?.subjects.find((item) => item.id === companyMembership?.subject_id)
  const subjectAgenda = useMemo(() => {
    const subjectId = subject?.id
    if (!subjectId) return { obligations: [] as TaxObligation[], filings: [] as TaxFiling[], settlements: [] as Array<Record<string, unknown>>, evidence: [] as Array<Record<string, unknown>> }
    return {
      obligations: (agenda.data?.obligations ?? []).filter((item) => item.subjectId === subjectId),
      filings: (agenda.data?.filings ?? []).filter((item) => item.subjectId === subjectId),
      settlements: (agenda.data?.settlements ?? []).filter((item) => String(item.subject_id ?? item.subjectId ?? "") === subjectId),
      evidence: (agenda.data?.evidence ?? []).filter((item) => String(item.subject_id ?? item.subjectId ?? "") === subjectId),
    }
  }, [agenda.data, subject?.id])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taxQueryKeys.configuration }),
      queryClient.invalidateQueries({ queryKey: taxQueryKeys.agenda }),
      queryClient.invalidateQueries({ queryKey: taxQueryKeys.inbox }),
    ])
  }
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true); setMessage(null)
    try { await work(); await refresh(); setMessage(success) }
    catch (error) { setMessage(error instanceof Error ? error.message : "Tindakan pajak gagal disimpan.") }
    finally { setBusy(false) }
  }

  if (!taxComplianceEnabled) return null
  if (configuration.isLoading) return <p className="py-4 text-sm text-muted-foreground">Memuat agenda pajak…</p>
  if (configuration.isError && !configuration.data) return (
    <Card><CardContent className="p-5 text-sm text-amber-900">Agenda pajak belum dapat dimuat. Hubungkan ke server dan coba lagi.</CardContent></Card>
  )
  if (!company) return null
  if (configuration.data?.taxCoverage === "RESTRICTED_SHARED_SUBJECT" || agenda.data?.taxCoverage === "RESTRICTED_SHARED_SUBJECT") return (
    <Card><CardContent className="space-y-2 p-5"><h2 className="text-lg tracking-tight">Agenda pajak gabungan dibatasi</h2><p className="text-sm text-muted-foreground">Subjek pajak company ini juga memakai data company lain yang belum Anda akses. Nominal, bukti, laporan, dan tindakan pajak disembunyikan. Safe to Spend tetap menganggap kewajiban pajak belum diketahui.</p></CardContent></Card>
  )
  if (!subject) return (
    <TaxSetup
      profile={profile}
      companyId={company.id}
      existingSubjects={configuration.data?.subjects ?? []}
      busy={busy}
      message={message}
      run={run}
    />
  )

  return (
    <section className="space-y-4" aria-labelledby="tax-agenda-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 id="tax-agenda-title" className="flex items-center gap-2 text-xl tracking-tight"><BellRing className="size-5 text-primary" aria-hidden="true" />Agenda Pajak</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subject.label} · nominal aktual dan status setor/lapor.</p>
        </div>
      </div>
      {message && <p role="status" className="rounded-xl bg-secondary/60 p-3 text-sm">{message}</p>}
      {(inbox.data?.items.length ?? 0) > 0 && <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status"><span>Ada {inbox.data!.items.length} pengingat pajak. Status terbaru ada di agenda.</span><Button size="sm" variant="outline" onClick={() => run(async () => { await markTaxInboxRead(inbox.data!.items.map((item) => String(item.id))); await queryClient.invalidateQueries({ queryKey: taxQueryKeys.inbox }) }, "Pengingat ditandai sudah dibaca.")}>Tandai dibaca</Button></div>}
      <PeriodReconciliation
        subjectId={subject.id}
        companyId={company.id}
        transactions={transactions}
        busy={busy}
        run={run}
      />
      <AgendaList
        obligations={subjectAgenda.obligations}
        filings={subjectAgenda.filings}
        companyId={company.id}
        busy={busy}
        run={run}
      />
      <TaxHistory settlements={subjectAgenda.settlements} evidence={subjectAgenda.evidence} busy={busy} run={run} />
      <TaxSettings
        subject={subject}
        membership={companyMembership}
        registrations={(configuration.data?.registrations ?? []).filter((item) => item.subject_id === subject.id)}
        preference={(configuration.data?.preferences ?? []).find((item) => item.subject_id === subject.id)}
        busy={busy}
        run={run}
      />
      {agenda.isError && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Menampilkan cache terakhir. Status terbaru belum dapat diambil dari server.</p>}
    </section>
  )
}

function TaxSetup({
  profile, companyId, existingSubjects, busy, message, run,
}: {
  profile: BusinessProfile
  companyId: string
  existingSubjects: Array<{ id: string; label: string; type: "INDIVIDUAL" | "ENTITY" }>
  busy: boolean
  message: string | null
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const isIndividual = profile.businessType === "INDIVIDUAL"
  const defaultKinds = useMemo(() => new Set<TaxKind>([
    ...(profile.taxScheme === "UMKM_FINAL" ? ["PPH_FINAL_UMKM" as const] : []),
    ...(profile.pkpStatus ? ["PPN_PPNBM" as const] : []),
  ]), [profile.pkpStatus, profile.taxScheme])
  const [label, setLabel] = useState(profile.businessName || "Wajib Pajak")
  const [maskedTaxId, setMaskedTaxId] = useState("")
  const [fiscalMonth, setFiscalMonth] = useState("1")
  const [fiscalDay, setFiscalDay] = useState("1")
  const [selected, setSelected] = useState<Set<TaxKind>>(defaultKinds)
  const [manual, setManual] = useState<Record<string, { amount: string; dueDate: string; jurisdiction: string }>>({})
  const [umkmEligibility, setUmkmEligibility] = useState<"ELIGIBLE" | "INELIGIBLE" | "NEEDS_REVIEW">("NEEDS_REVIEW")
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [existingSubjectId, setExistingSubjectId] = useState(existingSubjects[0]?.id ?? "")
  const effectiveFrom = profile.businessStartDate ?? `${new Date().getFullYear()}-01-01`

  const toggle = (kind: TaxKind) => setSelected((current) => {
    const next = new Set(current); if (next.has(kind)) next.delete(kind); else next.add(kind); return next
  })
  const create = () => run(async () => {
    for (const option of TAX_OPTIONS.filter((item) => item.event && selected.has(item.kind))) {
      if (!manual[option.kind]?.dueDate) throw new Error(`${option.label} memerlukan tanggal dari dokumen.`)
    }
    await setupTaxSubject({
      commandKey: commandKey("setup"), label: label.trim(), subjectType: isIndividual ? "INDIVIDUAL" : "ENTITY",
      entityForm: profile.businessType, maskedTaxId: maskedTaxId ? `***${maskedTaxId.replace(/\D/g, "").slice(-4)}` : undefined,
      fiscalYearStartMonth: Number(fiscalMonth), fiscalYearStartDay: Number(fiscalDay), companyIds: [companyId], effectiveFrom, umkmEligibility,
      eligibilityAnswers: Object.fromEntries(RELEVANCE_QUESTIONS.map((question) => [question.kinds.join("+"), question.kinds.some((kind) => selected.has(kind))])),
      registrations: TAX_OPTIONS.filter((option) => selected.has(option.kind)).map((option) => ({
        kind: option.kind,
        amountMode: option.event ? "DOCUMENT" : "MANUAL_CONFIRMED",
        defaultAmount: manual[option.kind]?.amount ? parseAmountInput(manual[option.kind].amount) : null,
        defaultDueDate: manual[option.kind]?.dueDate || null,
        jurisdiction: manual[option.kind]?.jurisdiction || undefined,
      })),
      inAppEnabled: true, emailEnabled, timezone: "Asia/Jakarta",
    })
  }, "Agenda pajak berhasil diaktifkan.")

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div><h1 className="text-xl tracking-tight">Aktifkan agenda pajak</h1><p className="mt-1 text-sm text-muted-foreground">Pilih hanya kewajiban yang berlaku. SPT Tahunan ditambahkan otomatis.</p></div>
        {existingSubjects.length > 0 && (
          <div className="rounded-xl border border-border p-3">
            <p className="text-sm font-semibold">Company ini memakai wajib pajak yang sudah ada?</p>
            <div className="mt-2 flex gap-2">
              <select className="field-shell min-h-11 flex-1 text-sm" value={existingSubjectId} onChange={(event) => setExistingSubjectId(event.target.value)}>
                {existingSubjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <Button disabled={busy || !existingSubjectId} variant="outline" onClick={() => run(() => linkCompanyToTaxSubject(existingSubjectId, { commandKey: commandKey("link"), companyId, effectiveFrom }), "Company terhubung ke wajib pajak.")}>Hubungkan</Button>
            </div>
          </div>
        )}
        <TextField label="Nama wajib pajak" value={label} onChange={setLabel} />
        <TextField label="4 digit akhir NPWP/NIK (opsional)" value={maskedTaxId} onChange={setMaskedTaxId} hint="Jornal hanya menyimpan bentuk termasking, bukan nomor lengkap." />
        <div className="grid grid-cols-2 gap-2"><label className="block"><span className="field-label">Awal tahun buku—bulan</span><select className="field-shell min-h-[50px] w-full text-sm" value={fiscalMonth} onChange={(event) => setFiscalMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><TextField label="Awal tahun buku—tanggal" value={fiscalDay} onChange={setFiscalDay} /></div>
        <label className="block"><span className="field-label">Kelayakan PPh Final UMKM</span><select value={umkmEligibility} onChange={(event) => setUmkmEligibility(event.target.value as typeof umkmEligibility)} className="field-shell min-h-[50px] w-full text-sm"><option value="NEEDS_REVIEW">Perlu diperiksa</option><option value="ELIGIBLE">Sudah dikonfirmasi memenuhi syarat</option><option value="INELIGIBLE">Tidak memenuhi syarat</option></select></label>
        <fieldset className="space-y-2 rounded-xl border border-border p-3"><legend className="px-1 text-sm font-semibold">Pemeriksaan relevansi</legend>{RELEVANCE_QUESTIONS.map((question) => <label key={question.label} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={question.kinds.every((kind) => selected.has(kind))} onChange={(event) => setSelected((current) => { const next = new Set(current); for (const kind of question.kinds) { if (event.target.checked) next.add(kind); else next.delete(kind) } return next })} /><span>{question.label}</span></label>)}<p className="text-xs text-muted-foreground">Jawaban adalah screening produk, bukan penetapan kewajiban oleh DJP. Jika ragu, biarkan jenis terkait aktif dan isi nominal setelah diperiksa.</p></fieldset>
        <fieldset className="space-y-2"><legend className="text-sm font-semibold">Jenis kewajiban</legend>
          {TAX_OPTIONS.map((option) => (
            <div key={option.kind} className="rounded-xl bg-secondary/50 p-3">
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={selected.has(option.kind)} onChange={() => toggle(option.kind)} className="size-4 accent-[var(--primary)]" /><span>{option.label}</span></label>
              {selected.has(option.kind) && option.event && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <DateField label="Jatuh tempo dokumen" value={manual[option.kind]?.dueDate ?? ""} onChange={(dueDate) => setManual((value) => ({ ...value, [option.kind]: { amount: value[option.kind]?.amount ?? "", jurisdiction: value[option.kind]?.jurisdiction ?? "", dueDate } }))} />
                  <TextField label="Nominal" type="amount" prefix="Rp" value={manual[option.kind]?.amount ?? ""} onChange={(amount) => setManual((value) => ({ ...value, [option.kind]: { dueDate: value[option.kind]?.dueDate ?? "", jurisdiction: value[option.kind]?.jurisdiction ?? "", amount } }))} />
                  <TextField label="Daerah/sumber" value={manual[option.kind]?.jurisdiction ?? ""} onChange={(jurisdiction) => setManual((value) => ({ ...value, [option.kind]: { dueDate: value[option.kind]?.dueDate ?? "", amount: value[option.kind]?.amount ?? "", jurisdiction } }))} />
                </div>
              )}
            </div>
          ))}
        </fieldset>
        <label className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} className="size-4 accent-[var(--primary)]" /><span>Email reminder ke alamat login yang terverifikasi (opt-in)</span></label>
        <Button disabled={busy || !label.trim()} className="w-full" onClick={create}><Plus className="size-4" />{busy ? "Menyimpan…" : "Aktifkan agenda"}</Button>
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  )
}

function TaxSettings({ subject, membership, registrations, preference, busy, run }: {
  subject: TaxSubject
  membership?: { id: string; revision: number }
  registrations: Array<Record<string, unknown>>
  preference?: Record<string, unknown>
  busy: boolean
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const activeKinds = new Set(registrations.filter((item) => !item.active_until || String(item.active_until).slice(0, 10) >= todayIsoDate()).map((item) => String(item.kind)))
  const available = TAX_OPTIONS.filter((option) => !activeKinds.has(option.kind))
  const [kind, setKind] = useState<TaxKind>(available[0]?.kind ?? "OTHER")
  const selectedOption = TAX_OPTIONS.find((option) => option.kind === kind)
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [jurisdiction, setJurisdiction] = useState("")
  const [eligibility, setEligibility] = useState(subject.umkmEligibility)
  const [emailEnabled, setEmailEnabled] = useState(Boolean(preference?.email_enabled))
  const [includeAmount, setIncludeAmount] = useState(Boolean(preference?.include_amount_in_email))
  const [deliveryHour, setDeliveryHour] = useState(String(preference?.delivery_hour ?? 9))
  const [backup, setBackup] = useState<unknown>(null)
  const [backupPreview, setBackupPreview] = useState<{ counts: Record<string, number>; subjects: Array<{ label: string; action: "CREATE" | "MERGE" }>; warnings: string[] } | null>(null)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)
  const [endDate, setEndDate] = useState(todayIsoDate())
  const [lifecycleReason, setLifecycleReason] = useState("")
  const currentYear = new Date().getFullYear()
  const addRegistration = () => run(async () => {
    if (selectedOption?.event && !dueDate) throw new Error("Jenis berbasis dokumen memerlukan tanggal jatuh tempo.")
    await addTaxRegistration(subject.id, {
      commandKey: commandKey("registration"), kind, activeFrom: todayIsoDate(), amountMode: selectedOption?.event ? "DOCUMENT" : "MANUAL_CONFIRMED",
      defaultAmount: amount ? parseAmountInput(amount) : null, defaultDueDate: dueDate || null, jurisdiction: jurisdiction || undefined,
    })
  }, "Jenis kewajiban berhasil ditambahkan.")
  const saveIdentity = () => run(() => updateTaxSubject(subject.id, {
    commandKey: commandKey("subject"), revision: subject.revision, umkmEligibility: eligibility,
    umkmEligibilityEffectiveFrom: todayIsoDate(), reason: "Diperbarui dari pengaturan agenda pajak",
  }), "Status wajib pajak diperbarui.")
  const savePreference = () => {
    if (!preference) return run(() => saveOwnTaxNotificationPreference(subject.id, {
      commandKey: commandKey("preference-create"), inAppEnabled: true, emailEnabled,
      includeAmountInEmail: includeAmount, deliveryHour: Math.max(0, Math.min(23, Number(deliveryHour))), reason: "Diaktifkan oleh pengguna",
    }), "Pengaturan reminder disimpan.")
    return run(() => updateTaxNotificationPreference(String(preference.id), {
      commandKey: commandKey("preference"), revision: Number(preference.revision), inAppEnabled: true,
      emailEnabled, includeAmountInEmail: includeAmount, deliveryHour: Math.max(0, Math.min(23, Number(deliveryHour))),
      reason: "Diperbarui oleh pengguna",
    }), "Pengaturan reminder disimpan.")
  }
  return <Card><CardContent className="p-5">
    <button type="button" className="flex w-full items-center justify-between gap-3 text-left" aria-expanded={open} onClick={() => setOpen(!open)}><span><span className="flex items-center gap-2 text-lg"><Settings2 className="size-4 text-primary" />Pengaturan dan rekap</span><span className="mt-1 block text-xs text-muted-foreground">Tambah kewajiban, atur reminder, dan unduh arsip.</span></span><span aria-hidden="true">{open ? "−" : "+"}</span></button>
    {open && <div className="mt-4 space-y-5 border-t border-border pt-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="block"><span className="field-label">Kelayakan PPh Final UMKM</span><select className="field-shell min-h-[50px] w-full text-sm" value={eligibility} onChange={(event) => setEligibility(event.target.value as typeof eligibility)}><option value="NEEDS_REVIEW">Perlu diperiksa</option><option value="ELIGIBLE">Memenuhi syarat—dikonfirmasi</option><option value="INELIGIBLE">Tidak memenuhi syarat</option></select></label><Button className="self-end" variant="outline" disabled={busy || eligibility === subject.umkmEligibility} onClick={saveIdentity}>Simpan status</Button></div>
      {available.length > 0 && <div className="space-y-2 rounded-xl border border-border p-3"><p className="text-sm font-semibold">Tambah jenis pajak</p><select className="field-shell min-h-11 w-full text-sm" value={kind} onChange={(event) => setKind(event.target.value as TaxKind)}>{available.map((option) => <option key={option.kind} value={option.kind}>{option.label}</option>)}</select><div className="grid gap-2 sm:grid-cols-3"><TextField label="Nominal default (opsional)" type="amount" prefix="Rp" value={amount} onChange={setAmount} /><DateField label={selectedOption?.event ? "Jatuh tempo dokumen" : "Tanggal manual (opsional)"} value={dueDate} onChange={setDueDate} /><TextField label="Daerah/sumber" value={jurisdiction} onChange={setJurisdiction} /></div><Button disabled={busy} onClick={addRegistration}><Plus className="size-4" />Tambah kewajiban</Button></div>}
      <div className="space-y-3 rounded-xl border border-border p-3"><p className="text-sm font-semibold">Reminder {preference ? "" : "(belum aktif untuk akun Anda)"}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emailEnabled} onChange={(event) => setEmailEnabled(event.target.checked)} />Email reminder (hanya alamat login terverifikasi)</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeAmount} disabled={!emailEnabled} onChange={(event) => setIncludeAmount(event.target.checked)} />Sertakan nominal dalam email</label><TextField label="Jam kirim (0–23, zona waktu wajib pajak)" value={deliveryHour} onChange={setDeliveryHour} /><Button variant="outline" disabled={busy} onClick={savePreference}>Simpan reminder</Button></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => run(() => downloadTaxReport(subject.id, currentYear), "Rekap CSV diunduh.")}><Download className="size-4" />Rekap CSV {currentYear}</Button><Button variant="outline" disabled={busy} onClick={() => run(() => downloadTaxBackup(subject.id), "Backup pajak diunduh.")}><Download className="size-4" />Backup JSON</Button></div>
      <div className="space-y-2 rounded-xl border border-border p-3"><p className="text-sm font-semibold">Pulihkan backup pajak</p><input type="file" accept="application/json,.json" className="block max-w-full text-xs" onChange={(event) => {
        const file = event.target.files?.[0]; setBackup(null); setBackupPreview(null); if (!file) return
        void run(async () => { const parsed = JSON.parse(await file.text()) as unknown; const preview = await previewTaxBackup(parsed); setBackup(parsed); setBackupPreview(preview) }, "Backup valid. Periksa preview sebelum memulihkan.")
      }} />{backupPreview && <div className="rounded-lg bg-secondary/60 p-3 text-xs"><p>{backupPreview.subjects.map((item) => `${item.label}: ${item.action === "CREATE" ? "buat baru" : "gabungkan"}`).join(" · ") || "Tidak ada subject"}</p><p className="mt-1 text-muted-foreground">Notifikasi akan tetap nonaktif dan relasi transaksi ledger tidak dipulihkan otomatis.</p><Button className="mt-2" size="sm" disabled={busy || !backup} onClick={() => backup && run(() => restoreTaxBackup(backup, commandKey("restore")), "Backup pajak dipulihkan; aktifkan kembali reminder setelah ditinjau.").then(() => { setBackup(null); setBackupPreview(null) })}>Konfirmasi pemulihan</Button></div>}</div>
      <div className="rounded-xl border border-border p-3"><button type="button" className="text-sm font-semibold text-muted-foreground" onClick={() => setLifecycleOpen(!lifecycleOpen)}>Perubahan status dan masa berlaku {lifecycleOpen ? "−" : "+"}</button>{lifecycleOpen && <div className="mt-3 space-y-3"><DateField label="Efektif sampai" value={endDate} onChange={setEndDate} /><TextField label="Alasan perubahan" value={lifecycleReason} onChange={setLifecycleReason} placeholder="Contoh: registrasi dicabut atau company pindah NPWP" /><div className="space-y-2">{registrations.filter((item) => !item.active_until).map((item) => <div key={String(item.id)} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 p-2 text-xs"><span>{KIND_LABEL[String(item.kind) as TaxKind] ?? String(item.label)}</span><Button size="sm" variant="outline" disabled={busy || !lifecycleReason.trim()} onClick={() => run(() => endTaxRegistration(String(item.id), { commandKey: commandKey("end-registration"), revision: Number(item.revision), activeUntil: endDate, reason: lifecycleReason }), "Masa berlaku registrasi diakhiri; histori tetap tersimpan.")}>Akhiri</Button></div>)}</div>{membership && <Button size="sm" variant="outline" disabled={busy || !lifecycleReason.trim()} onClick={() => run(() => endTaxMembership(membership.id, { commandKey: commandKey("end-membership"), revision: membership.revision, effectiveUntil: endDate, reason: lifecycleReason }), "Hubungan company dengan wajib pajak diakhiri; histori tetap tersimpan.")}>Akhiri hubungan company</Button>}<Button size="sm" variant="outline" disabled={busy || !lifecycleReason.trim() || subject.status === "INACTIVE"} onClick={() => run(() => updateTaxSubject(subject.id, { commandKey: commandKey("inactive-subject"), revision: subject.revision, status: "INACTIVE", reason: lifecycleReason }), "Wajib pajak dinonaktifkan; kewajiban dan bukti lama tetap tersimpan.")}>Nonaktifkan wajib pajak</Button></div>}</div>
      <p className="text-xs text-muted-foreground">Nominal terkonfirmasi berarti dikonfirmasi dari data atau dokumen Anda, bukan diverifikasi DJP. Proyeksi pada bagian bawah bukan nilai SPT aktual.</p>
    </div>}
  </CardContent></Card>
}

function PeriodReconciliation({ subjectId, companyId, transactions, busy, run }: {
  subjectId: string; companyId: string; transactions: Transaction[]; busy: boolean
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [period, setPeriod] = useState(currentPeriod())
  const ledgerRevenue = transactions.filter((item) => item.classification === "REVENUE" && item.direction === "MONEY_IN" && item.transactionDate.startsWith(period)).reduce((sum, item) => sum + transactionRevenueAmount(item), 0)
  const [external, setExternal] = useState("")
  const [openingYtd, setOpeningYtd] = useState("")
  const reconcile = () => run(async () => {
    await saveTaxPeriodInput({ commandKey: commandKey("company-input"), subjectId, companyId, period, taxableRevenue: ledgerRevenue, externalRevenue: 0, openingYtdRevenue: 0, adjustments: 0, dataStatus: "COMPLETE", sourceRevision: `ledger-${period}-${transactions.length}` })
    await saveTaxPeriodInput({ commandKey: commandKey("external-input"), subjectId, companyId: null, period, taxableRevenue: 0, externalRevenue: parseAmountInput(external), openingYtdRevenue: parseAmountInput(openingYtd), adjustments: 0, dataStatus: "COMPLETE", sourceRevision: `user-${period}` })
    await generateTaxObligations({ commandKey: commandKey("generate"), subjectId, period })
  }, `Masa ${period} direkonsiliasi dan agenda diperbarui.`).then(() => setOpeningYtd(""))
  return <Card><CardContent className="space-y-3 p-5"><div><h2 className="flex items-center gap-2 text-lg"><CalendarClock className="size-4 text-primary" />Rekonsiliasi {period}</h2><p className="text-xs text-muted-foreground">Omzet company di Jornal: {formatRupiah(ledgerRevenue)}. Konfirmasi omzet usaha lain agar batas kumulatif tidak keliru.</p></div><label className="block"><span className="field-label">Masa pajak</span><input type="month" max={currentPeriod()} value={period} onChange={(event) => setPeriod(event.target.value)} className="field-shell min-h-[50px] w-full text-sm" /></label><TextField label="Omzet usaha di luar company Jornal bulan ini" type="amount" prefix="Rp" value={external} onChange={setExternal} /><TextField label="Saldo omzet YTD sebelum masa pertama di Jornal (isi sekali)" type="amount" prefix="Rp" value={openingYtd} onChange={setOpeningYtd} hint="Termasuk omzet company/usaha lain sebelum Anda mulai merekonsiliasi di Jornal." /><Button disabled={busy || !/^\d{4}-\d{2}$/.test(period)} onClick={reconcile}>{busy ? "Memproses…" : "Konfirmasi dan buat agenda"}</Button></CardContent></Card>
}

function AgendaList({ obligations, filings, companyId, busy, run }: {
  obligations: TaxObligation[]; filings: TaxFiling[]; companyId: string; busy: boolean
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [scope, setScope] = useState<"ALL" | "MONTHLY" | "ANNUAL" | "EVENT">("ALL")
  const [year, setYear] = useState("ALL")
  const eventKinds = new Set<TaxKind>(TAX_OPTIONS.filter((item) => item.event).map((item) => item.kind))
  const years = [...new Set(obligations.map((item) => item.period.slice(0, 4)).concat(filings.map((item) => item.period.slice(0, 4))))].sort().reverse()
  const matches = (period: string, kind?: TaxKind) => (year === "ALL" || period.startsWith(year)) && (scope === "ALL" || scope === "MONTHLY" && period.length === 7 && (!kind || !eventKinds.has(kind)) || scope === "ANNUAL" && period.length === 4 && (!kind || !eventKinds.has(kind)) || scope === "EVENT" && Boolean(kind && eventKinds.has(kind)))
  const visibleObligations = obligations.filter((item) => matches(item.period, item.kind))
  const visibleFilings = filings.filter((item) => matches(item.period))
  if (obligations.length === 0 && filings.length === 0) return <Card><CardContent className="p-5 text-sm text-muted-foreground">Belum ada periode yang dibuat. Rekonsiliasi bulan ini untuk membuat agenda.</CardContent></Card>
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" aria-label="Filter agenda pajak">{(["ALL", "MONTHLY", "ANNUAL", "EVENT"] as const).map((value) => <Button key={value} size="sm" variant={scope === value ? "default" : "outline"} onClick={() => setScope(value)}>{value === "ALL" ? "Semua" : value === "MONTHLY" ? "Bulanan" : value === "ANNUAL" ? "Tahunan" : "Lainnya"}</Button>)}{years.length > 1 && <select aria-label="Tahun agenda" className="field-shell min-h-9 text-sm" value={year} onChange={(event) => setYear(event.target.value)}><option value="ALL">Semua tahun</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>}</div>
    <Card><CardContent className="p-5"><h2 className="flex items-center gap-2 text-lg"><CircleDollarSign className="size-4 text-primary" />Setor dan nominal</h2><div className="mt-3 space-y-3">{visibleObligations.map((item) => <ObligationRow key={item.id} item={item} companyId={companyId} busy={busy} run={run} />)}{visibleObligations.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada kewajiban pada filter ini.</p>}</div></CardContent></Card>
    <Card><CardContent className="p-5"><h2 className="flex items-center gap-2 text-lg"><FileCheck2 className="size-4 text-primary" />Pelaporan</h2><div className="mt-3 space-y-3">{visibleFilings.map((item) => <FilingRow key={item.id} item={item} busy={busy} run={run} />)}{visibleFilings.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pelaporan pada filter ini.</p>}</div></CardContent></Card>
  </div>
}

function ObligationRow({ item, companyId, busy, run }: { item: TaxObligation; companyId: string; busy: boolean; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [mode, setMode] = useState<"NONE" | "AMOUNT" | "PAY" | "SNOOZE" | "DEADLINE">("NONE")
  const [amount, setAmount] = useState(item.proposedLiabilityAmount === null ? (item.remainingPayable === null ? "" : String(item.remainingPayable)) : String(item.proposedLiabilityAmount))
  const [source, setSource] = useState("")
  const [date, setDate] = useState(todayIsoDate())
  const [reference, setReference] = useState("")
  const [createLedger, setCreateLedger] = useState(true)
  const due = dateOnly(item.effectiveDueDate)
  return <article className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{KIND_LABEL[item.kind] ?? item.kind} · {item.period}</p><p className="mt-1 text-xs text-muted-foreground">{due ? `Jatuh tempo ${due}` : "Tanggal perlu dikonfirmasi"} · bayar {item.paymentStatus} · data {item.dataStatus}</p>{item.deadlineStatus === "PROVISIONAL" && <p className="mt-1 text-xs font-medium text-amber-700">Tanggal provisional—kalender libur resmi belum tersedia untuk tahun ini.</p>}{item.statutoryDueDate && item.effectiveDueDate && dateOnly(item.statutoryDueDate) !== dateOnly(item.effectiveDueDate) && <p className="mt-1 text-xs text-muted-foreground">Tanggal dasar {dateOnly(item.statutoryDueDate)} digeser ke hari kerja berikutnya.</p>}</div><p className="shrink-0 font-semibold tabular-nums">{item.remainingPayable === null ? "Belum tersedia" : formatRupiah(item.remainingPayable)}</p></div>
    {item.proposedLiabilityAmount !== null && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Perubahan data menghasilkan usulan {formatRupiah(item.proposedLiabilityAmount)}. Tinjau sebelum mengganti nominal terkonfirmasi.</p>}
    <div className="mt-3 flex flex-wrap gap-2">{item.amountState !== "CONFIRMED" && <Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(mode === "AMOUNT" ? "NONE" : "AMOUNT")}>{item.amountState === "NEEDS_REVIEW" ? "Tinjau nominal" : "Isi nominal"}</Button>}{item.remainingPayable !== null && item.remainingPayable > 0 && <Button size="sm" disabled={busy} onClick={() => setMode(mode === "PAY" ? "NONE" : "PAY")}>Catat pembayaran</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(mode === "SNOOZE" ? "NONE" : "SNOOZE")}>Tunda reminder</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setMode(mode === "DEADLINE" ? "NONE" : "DEADLINE")}>Ubah tenggat</Button>{item.paymentStatus === "PAID" && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="size-4" />Lunas</span>}</div>
    {mode === "AMOUNT" && <div className="mt-3 grid gap-2"><TextField label="Nominal terutang" type="amount" prefix="Rp" value={amount} onChange={setAmount} /><TextField label="Sumber nominal" value={source} onChange={setSource} placeholder="Coretax, payroll, SPPT, atau dokumen" /><Button disabled={busy || !source.trim()} onClick={() => run(() => confirmTaxObligationAmount(item.id, { commandKey: commandKey("amount"), revision: item.revision, liabilityAmount: parseAmountInput(amount), source }), "Nominal terkonfirmasi disimpan.")}>Simpan nominal</Button></div>}
    {mode === "PAY" && <div className="mt-3 grid gap-2"><TextField label="Jumlah dibayar" type="amount" prefix="Rp" value={amount} onChange={setAmount} /><DateField label="Tanggal arus kas" value={date} onChange={setDate} /><TextField label="Referensi/NTPN" value={reference} onChange={setReference} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createLedger} onChange={(event) => setCreateLedger(event.target.checked)} />Buat transaksi pembayaran pajak di cashflow</label><Button disabled={busy || parseAmountInput(amount) <= 0} onClick={() => run(() => createTaxSettlement({ commandKey: commandKey("payment"), subjectId: item.subjectId, type: createLedger ? "SELF_PAYMENT" : "OUTSIDE_LEDGER", amount: parseAmountInput(amount), settlementDate: date, reference, source: "Dikonfirmasi pengguna", validatedPayment: Boolean(reference), allocations: [{ obligationId: item.id, amount: parseAmountInput(amount) }], ledgerTransaction: createLedger ? { id: crypto.randomUUID(), companyId, description: `${KIND_LABEL[item.kind] ?? item.kind} ${item.period}`, accountId: null } : undefined }), "Pembayaran dan alokasi berhasil disimpan.").then(() => setMode("NONE"))}>Simpan pembayaran</Button></div>}
    {mode === "SNOOZE" && <div className="mt-3 grid gap-2"><DateField label="Tunda pengingat sampai" value={date} onChange={setDate} /><TextField label="Alasan tunda" value={source} onChange={setSource} /><Button disabled={busy} onClick={() => run(() => snoozeTaxObligation(item.id, { commandKey: commandKey("snooze"), revision: item.revision, snoozedUntil: date, reason: source }), "Reminder ditunda tanpa mengubah tenggat hukum.").then(() => setMode("NONE"))}>Simpan penundaan</Button></div>}
    {mode === "DEADLINE" && <div className="mt-3 grid gap-2"><DateField label="Tenggat efektif baru" value={date} onChange={setDate} /><TextField label="Sumber perubahan tenggat" value={source} onChange={setSource} placeholder="Surat perpanjangan atau ketentuan resmi" /><TextField label="Referensi perubahan" value={reference} onChange={setReference} /><Button disabled={busy || !source.trim() || !reference.trim()} onClick={() => run(() => overrideTaxDeadline(item.id, { commandKey: commandKey("deadline"), revision: item.revision, effectiveDueDate: date, source, reference }), "Tenggat efektif diperbarui; tanggal dasar dan histori tetap tersimpan.").then(() => setMode("NONE"))}>Simpan tenggat</Button></div>}
    <EvidenceUpload subjectId={item.subjectId} parentType="obligation" parentId={item.id} busy={busy} run={run} />
  </article>
}

function FilingRow({ item, busy, run }: { item: TaxFiling; busy: boolean; run: (work: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [date, setDate] = useState(todayIsoDate()); const [reference, setReference] = useState(""); const [reason, setReason] = useState("")
  const done = item.status === "FILED" || item.status === "FULFILLED_BY_PAYMENT" || item.status === "NOT_REQUIRED"
  const amendable = item.status === "FILED" || item.status === "FULFILLED_BY_PAYMENT"
  return <article className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.filingGroup.replaceAll("_", " ")} · {item.period}</p><p className="text-xs text-muted-foreground">{dateOnly(item.effectiveDueDate) ? `Batas ${dateOnly(item.effectiveDueDate)}` : "Tanggal perlu dikonfirmasi"}</p>{item.deadlineStatus === "PROVISIONAL" && <p className="mt-1 text-xs font-medium text-amber-700">Tanggal provisional—periksa kembali kalender resmi.</p>}{item.amendmentNumber > 0 && <p className="mt-1 text-xs text-muted-foreground">Pembetulan ke-{item.amendmentNumber}</p>}</div><span className={`text-xs font-semibold ${done ? "text-emerald-700" : "text-amber-700"}`}>{item.status}</span></div>{(!done || amendable) && <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(!open)}>{amendable ? "Catat pembetulan" : "Catat pelaporan"}</Button>}{open && <div className="mt-3 grid gap-2"><DateField label={amendable ? "Tanggal pembetulan" : "Tanggal lapor"} value={date} onChange={setDate} /><TextField label="Nomor BPE/referensi" value={reference} onChange={setReference} />{amendable && <TextField label="Alasan pembetulan" value={reason} onChange={setReason} />}<Button disabled={busy || amendable && !reason.trim()} onClick={() => run(() => amendable ? amendTaxFiling(item.id, { commandKey: commandKey("amend-filing"), revision: item.revision, filedAt: date, reference, reason }) : completeTaxFiling(item.id, { commandKey: commandKey("filing"), revision: item.revision, filedAt: date, reference }), amendable ? "Pembetulan pelaporan disimpan dalam histori." : "Status pelaporan berhasil disimpan.").then(() => setOpen(false))}>{amendable ? "Simpan pembetulan" : "Tandai sudah dilaporkan"}</Button></div>}<EvidenceUpload subjectId={item.subjectId} parentType="filing" parentId={item.id} busy={busy} run={run} /></article>
}

function TaxHistory({ settlements, evidence, busy, run }: {
  settlements: Array<Record<string, unknown>>; evidence: Array<Record<string, unknown>>; busy: boolean
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [reverseId, setReverseId] = useState(""); const [reason, setReason] = useState("")
  if (settlements.length === 0 && evidence.length === 0) return null
  return <Card><CardContent className="space-y-4 p-5"><h2 className="text-lg">Histori pembayaran dan bukti</h2>{settlements.length > 0 && <div className="space-y-2">{settlements.map((item) => {
    const status = String(item.status || "ACTIVE"); const id = String(item.id)
    return <div key={id} className="rounded-xl border border-border p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{String(item.settlement_type).replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{String(item.settlement_date).slice(0, 10)} · {String(item.reference || "Tanpa referensi")}</p></div><div className="text-right"><p className="font-semibold">{formatRupiah(Number(item.amount || 0))}</p><p className={status === "REVERSED" ? "text-xs text-red-700" : "text-xs text-emerald-700"}>{status}</p></div></div>{status !== "REVERSED" && <Button className="mt-2" size="sm" variant="outline" disabled={busy} onClick={() => setReverseId(reverseId === id ? "" : id)}>Koreksi alokasi</Button>}{reverseId === id && <div className="mt-2 grid gap-2"><TextField label="Alasan koreksi" value={reason} onChange={setReason} /><Button size="sm" disabled={busy || !reason.trim()} onClick={() => run(() => reverseTaxSettlement(id, { commandKey: commandKey("reverse"), revision: Number(item.revision), reason }), "Alokasi pembayaran dibatalkan; transaksi kas historis tetap tersimpan.").then(() => { setReverseId(""); setReason("") })}>Konfirmasi koreksi</Button></div>}</div>
  })}</div>}{evidence.length > 0 && <div><p className="text-sm font-semibold">Arsip bukti</p><div className="mt-2 space-y-2">{evidence.map((item) => <div key={String(item.id)} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/50 p-2 text-xs"><span className="truncate">{String(item.original_name || "Bukti pajak")}</span><Button size="sm" variant="outline" onClick={() => run(() => downloadTaxEvidence(String(item.id), String(item.original_name || "bukti-pajak")), "Bukti diunduh.")}>Unduh</Button></div>)}</div></div>}</CardContent></Card>
}

function EvidenceUpload({ subjectId, parentType, parentId, busy, run }: {
  subjectId: string; parentType: "obligation" | "filing"; parentId: string; busy: boolean
  run: (work: () => Promise<unknown>, success: string) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  return <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"><label className="min-w-0 flex-1 text-xs text-muted-foreground"><span className="mb-1 block">Bukti PDF/JPG/PNG (maks. 10 MB)</span><input type="file" accept="application/pdf,image/jpeg,image/png" className="block max-w-full text-xs" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><Button size="sm" variant="outline" disabled={busy || !file} onClick={() => file && run(() => uploadTaxEvidence({ commandKey: commandKey("evidence"), subjectId, parentType, parentId, file }), "Bukti tersimpan aman.").then(() => setFile(null))}>Unggah bukti</Button></div>
}

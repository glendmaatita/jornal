import { useMemo, useState } from "react"
import { Link, useSearch } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpLeft,
  Building2,
  CheckCircle2,
  Landmark,
  Pencil,
  Plus,
  Power,
  Save,
  Trash2,
  UserRound,
  Wallet,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppDialog } from "@/components/ui/app-dialog-context"
import { Card, CardContent } from "@/components/ui/card"
import { SelectField } from "@/components/ui/select-field"
import { TextField } from "@/components/ui/text-field"
import { currentAccountBalance } from "@/lib/account-balance"
import { formatDateShort, formatRupiah, formatSignedRupiah, parseAmountInput } from "@/lib/format"
import { queryKeys, useAccounts, useProfile, useTransactions } from "@/lib/queries"
import { deleteAccount, isCompanyWritable, upsertAccount } from "@/lib/store"
import { isAccountEnabled, type Account, type AccountType } from "@/lib/types"

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "BANK", label: "Bank" },
  { value: "CASH", label: "Cash" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHER", label: "Lainnya" },
]

type AccountFilter = "ENABLED" | "DISABLED" | "ALL"
type AccountDraft = {
  name: string
  type: AccountType
  bankName: string
  accountHolder: string
  accountNumber: string
  openingBalance: string
  enabled: boolean
}

const EMPTY_DRAFT: AccountDraft = {
  name: "",
  type: "BANK",
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  openingBalance: "",
  enabled: true,
}

function draftFrom(account: Account): AccountDraft {
  return {
    name: account.name,
    type: account.type,
    bankName: account.bankName || "",
    accountHolder: account.accountHolder || "",
    accountNumber: account.accountNumber || "",
    openingBalance: account.openingBalance ? String(account.openingBalance) : "",
    enabled: isAccountEnabled(account),
  }
}

function requiresPaymentIdentity(type: AccountType) {
  return type === "BANK" || type === "EWALLET"
}

export function AccountsPage() {
  const dialog = useAppDialog()
  const search = useSearch({ from: "/_app/accounts" }) as { account?: string }
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const { data: transactions = [] } = useTransactions()
  const { data: profile } = useProfile()
  const [filter, setFilter] = useState<AccountFilter>("ENABLED")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AccountDraft>(EMPTY_DRAFT)
  const writable = isCompanyWritable()

  const visibleAccounts = useMemo(() => accounts.filter((account) => {
    if (filter === "ALL") return true
    return filter === "ENABLED" ? isAccountEnabled(account) : !isAccountEnabled(account)
  }), [accounts, filter])
  const requested = accounts.find((account) => account.id === search.account)
  const selected = requested && visibleAccounts.some((account) => account.id === requested.id)
    ? requested
    : visibleAccounts[0] ?? null

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.accounts })
    void queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
  }

  const mutations = useMemo(() => {
    if (!selected) return []
    return transactions
      .filter((transaction) => transaction.accountId === selected.id || transaction.transferAccountId === selected.id)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt))
      .map((transaction) => {
        const isIncoming = transaction.transferAccountId === selected.id && transaction.accountId !== selected.id
          ? true
          : transaction.direction === "MONEY_IN"
        const isTransfer = transaction.classification === "INTERNAL_TRANSFER"
        return { transaction, isIncoming, isTransfer }
      })
  }, [selected, transactions])

  const needsIdentity = requiresPaymentIdentity(draft.type)
  const formComplete = Boolean(
    draft.name.trim()
    && (!needsIdentity || (draft.bankName.trim() && draft.accountHolder.trim() && draft.accountNumber.trim())),
  )

  const resetForm = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
  }

  const beginEditing = (account: Account) => {
    setEditingId(account.id)
    setDraft(draftFrom(account))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const saveAccount = () => {
    if (!formComplete) return
    const account = upsertAccount({
      ...(editingId ? { id: editingId } : {}),
      name: draft.name.trim(),
      type: draft.type,
      bankName: draft.bankName.trim() || null,
      accountHolder: draft.accountHolder.trim() || null,
      accountNumber: draft.accountNumber.trim() || null,
      enabled: draft.enabled,
      openingBalance: parseAmountInput(draft.openingBalance),
      includedInCash: editingId
        ? accounts.find((item) => item.id === editingId)?.includedInCash !== false
        : true,
    })
    resetForm()
    if (!isAccountEnabled(account)) setFilter("DISABLED")
    invalidate()
  }

  const toggleAccount = (account: Account) => {
    upsertAccount({ ...account, enabled: !isAccountEnabled(account) })
    invalidate()
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl tracking-tight"><Wallet className="size-5 text-primary" aria-hidden="true" />Rekening</h1>
        <p className="text-sm text-muted-foreground">Kelola identitas rekening dan lihat mutasi uang masuk-keluar.</p>
      </div>

      {writable && <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            {editingId ? <Pencil className="size-4 text-primary" aria-hidden="true" /> : <Plus className="size-4 text-primary" aria-hidden="true" />}
            {editingId ? "Edit rekening" : "Tambah rekening"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nama rekening" icon={Landmark} value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} placeholder="Contoh: BCA Operasional" />
            <SelectField label="Jenis rekening" value={draft.type} onChange={(value) => setDraft((current) => ({ ...current, type: value as AccountType }))} options={ACCOUNT_TYPES.map((item) => ({ value: item.value, label: item.label }))} />
            <TextField label={draft.type === "EWALLET" ? "Penyedia" : "Nama bank"} icon={Building2} value={draft.bankName} onChange={(bankName) => setDraft((current) => ({ ...current, bankName }))} placeholder={draft.type === "EWALLET" ? "Contoh: GoPay" : "Contoh: BCA"} />
            <TextField label="Nomor rekening" icon={Landmark} value={draft.accountNumber} onChange={(accountNumber) => setDraft((current) => ({ ...current, accountNumber }))} placeholder="Nomor rekening / e-wallet" />
            <TextField label="Nama pemilik rekening" icon={UserRound} value={draft.accountHolder} onChange={(accountHolder) => setDraft((current) => ({ ...current, accountHolder }))} placeholder="Sesuai nama pada rekening" />
            <TextField label="Saldo awal" type="amount" prefix="Rp" value={draft.openingBalance} onChange={(openingBalance) => setDraft((current) => ({ ...current, openingBalance }))} hint="Saldo sebelum mutasi pertama." />
          </div>
          {editingId && (
            <button type="button" onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))} className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left">
              <span><span className="block text-sm font-semibold">Rekening aktif</span><span className="block text-xs text-muted-foreground">Rekening aktif tersedia untuk transaksi baru.</span></span>
              <span className={`relative h-6 w-11 rounded-full transition-colors ${draft.enabled ? "bg-primary" : "bg-slate-300"}`} aria-label={draft.enabled ? "Aktif" : "Nonaktif"}><span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${draft.enabled ? "translate-x-6" : "translate-x-1"}`} /></span>
            </button>
          )}
          {needsIdentity && !formComplete && draft.name.trim() && <p className="text-xs text-amber-700">Nama bank/penyedia, nomor rekening, dan nama pemilik wajib diisi.</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveAccount} disabled={!formComplete}>{editingId ? <Save aria-hidden="true" /> : <Plus aria-hidden="true" />}{editingId ? "Simpan perubahan" : "Tambah"}</Button>
            {editingId && <Button variant="outline" onClick={resetForm}><X aria-hidden="true" />Batal</Button>}
          </div>
          {!profile?.useAccountTracking && (
            <p className="text-xs text-muted-foreground">Aktifkan “Lacak lokasi uang” di <Link to="/settings" className="font-semibold text-primary underline">Pengaturan</Link> agar saldo rekening masuk ke Safe To Spend.</p>
          )}
        </CardContent>
      </Card>}

      <div className="flex items-end justify-between gap-3">
        <div><h2 className="font-semibold">Daftar rekening</h2><p className="text-xs text-muted-foreground">Rekening nonaktif tetap menyimpan histori mutasi.</p></div>
        <SelectField aria-label="Filter status rekening" className="w-36" value={filter} onChange={(value) => setFilter(value as AccountFilter)} options={[{ value: "ENABLED", label: "Aktif" }, { value: "DISABLED", label: "Nonaktif" }, { value: "ALL", label: "Semua" }]} />
      </div>

      {visibleAccounts.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{filter === "DISABLED" ? "Tidak ada rekening nonaktif." : "Belum ada rekening aktif. Tambahkan atau aktifkan rekening untuk menampilkannya di sini."}</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visibleAccounts.map((account) => (
            <div
              key={account.id}
              className={selected?.id === account.id
                ? "relative min-w-0 rounded-[10px] after:pointer-events-none after:absolute after:inset-0 after:z-20 after:rounded-[10px] after:border-2 after:border-primary"
                : "relative min-w-0 rounded-[10px]"}
            >
              <Card className="h-full transition-colors hover:border-primary/50"><CardContent className="relative flex items-start justify-between gap-3 p-5">
                <Link to="/accounts" search={{ account: account.id }} className="absolute inset-0 rounded-[10px]" aria-label={`Lihat mutasi ${account.name}`} />
                <span className="pointer-events-none min-w-0">
                  <span className="flex items-center gap-2"><span className="block truncate font-semibold">{account.name}</span>{!isAccountEnabled(account) && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Nonaktif</span>}</span>
                  <span className="block text-xs text-muted-foreground">{account.bankName || ACCOUNT_TYPES.find((item) => item.value === account.type)?.label}{account.accountNumber ? ` · ${account.accountNumber}` : ""}</span>
                  {account.accountHolder && <span className="block truncate text-xs text-muted-foreground">a.n. {account.accountHolder}</span>}
                </span>
                <span className={`pointer-events-none shrink-0 text-right ${writable ? "pr-8" : ""}`}><span className="block text-sm font-semibold tabular-nums">{formatRupiah(currentAccountBalance(account, transactions))}</span><span className="text-xs text-muted-foreground">saldo saat ini</span></span>
                {writable && <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-30 size-8 bg-white/90" aria-label={`Edit ${account.name}`} title={`Edit ${account.name}`} onClick={() => beginEditing(account)}><Pencil aria-hidden="true" /></Button>}
              </CardContent></Card>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0"><h2 className="flex min-w-0 items-center gap-2 text-lg tracking-tight"><ArrowLeftRight className="size-4 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">Mutasi {selected.name}</span></h2><p className="text-xs text-muted-foreground">Saldo awal {formatRupiah(selected.openingBalance)}</p></div>
              {writable && <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => beginEditing(selected)}><Pencil className="size-4" aria-hidden="true" />Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => toggleAccount(selected)}>{isAccountEnabled(selected) ? <Power className="size-4" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}{isAccountEnabled(selected) ? "Nonaktifkan" : "Aktifkan"}</Button>
                <Button variant="ghost" size="sm" aria-label={`Hapus ${selected.name}`} onClick={() => void dialog.confirm({ title: `Hapus rekening ${selected.name}?`, description: "Rekening akan dihapus permanen bila belum dipakai transaksi. Untuk menyimpan histori, pilih Nonaktifkan.", confirmLabel: "Hapus rekening", tone: "destructive" }).then((confirmed) => { if (confirmed) { deleteAccount(selected.id); invalidate() } })}><Trash2 className="size-4" aria-hidden="true" /></Button>
              </div>}
            </div>
            {mutations.length === 0 ? <p className="rounded-xl bg-secondary/50 p-4 text-sm text-muted-foreground">Belum ada mutasi untuk rekening ini.</p> : (
              <div className="divide-y divide-border/50">
                {mutations.map(({ transaction, isIncoming, isTransfer }) => (
                  <Link key={transaction.id} to="/transactions/$transactionId" params={{ transactionId: transaction.id }} className="flex items-center gap-3 py-3 hover:bg-accent/40">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-full ${isTransfer ? "bg-secondary" : isIncoming ? "bg-emerald-50" : "bg-secondary"}`}>
                      {isTransfer ? <ArrowLeftRight className="size-4" aria-hidden="true" /> : isIncoming ? <ArrowDownLeft className="size-4 text-emerald-600" aria-hidden="true" /> : <ArrowUpLeft className="size-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{transaction.description || "(tanpa deskripsi)"}</span><span className="text-xs text-muted-foreground">{formatDateShort(transaction.transactionDate)}{isTransfer ? " · Transfer antar rekening" : ""}</span></span>
                    <span className={`shrink-0 text-sm font-semibold tabular-nums ${isIncoming ? "money-in" : "text-foreground"}`}>{formatSignedRupiah(isIncoming ? transaction.amount : -transaction.amount)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

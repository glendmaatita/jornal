import { useMemo, useState } from "react"
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowDownLeft, ArrowLeftRight, ArrowUpLeft, Plus, Trash2, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { currentAccountBalance } from "@/lib/account-balance"
import { formatDateShort, formatRupiah, formatSignedRupiah, parseAmountInput } from "@/lib/format"
import { queryKeys, useAccounts, useProfile, useTransactions } from "@/lib/queries"
import { deleteAccount, isCompanyWritable, upsertAccount } from "@/lib/store"
import { type AccountType } from "@/lib/types"
import { useQueryClient } from "@tanstack/react-query"

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "BANK", label: "Bank" },
  { value: "CASH", label: "Cash" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHER", label: "Lainnya" },
]

export function AccountsPage() {
  const search = useSearch({ from: "/_app/accounts" }) as { account?: string }
  const queryClient = useQueryClient()
  const { data: accounts = [] } = useAccounts()
  const { data: transactions = [] } = useTransactions()
  const { data: profile } = useProfile()
  const [name, setName] = useState("")
  const [type, setType] = useState<AccountType>("BANK")
  const [openingBalance, setOpeningBalance] = useState("")
  const selected = accounts.find((account) => account.id === search.account) ?? accounts[0] ?? null
  const writable = isCompanyWritable()

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

  const addAccount = () => {
    const trimmedName = name.trim()
    if (!trimmedName) return
    upsertAccount({ name: trimmedName, type, openingBalance: parseAmountInput(openingBalance), includedInCash: true })
    setName("")
    setOpeningBalance("")
    setType("BANK")
    invalidate()
  }

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl tracking-tight"><Wallet className="size-5 text-primary" aria-hidden="true" />Rekening</h1>
        <p className="text-sm text-muted-foreground">Kelola rekening dan lihat mutasi uang masuk-keluar.</p>
      </div>

      {writable && <Card>
        <CardContent className="space-y-3 p-5">
          <h2 className="text-lg tracking-tight">Tambah rekening</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Nama rekening" value={name} onChange={setName} placeholder="Contoh: BCA Operasional" />
            <TextField label="Saldo awal" type="amount" prefix="Rp" value={openingBalance} onChange={setOpeningBalance} hint="Saldo sebelum mutasi pertama." />
          </div>
          <div className="flex gap-2">
            <select value={type} onChange={(event) => setType(event.target.value as AccountType)} className="field-shell !min-h-[46px] w-full !py-0 text-sm" aria-label="Jenis rekening">
              {ACCOUNT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <Button onClick={addAccount} disabled={!name.trim()}><Plus aria-hidden="true" />Tambah</Button>
          </div>
          {!profile?.useAccountTracking && (
            <p className="text-xs text-muted-foreground">Aktifkan “Lacak lokasi uang” di <Link to="/settings" className="font-semibold text-primary underline">Pengaturan</Link> agar saldo rekening masuk ke Safe To Spend.</p>
          )}
        </CardContent>
      </Card>}

      {accounts.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Belum ada rekening. Tambahkan rekening untuk mulai melihat mutasinya.</CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {accounts.map((account) => (
            <Link
              key={account.id}
              to="/accounts"
              search={{ account: account.id }}
              className={selected?.id === account.id
                ? "relative block rounded-[10px] after:pointer-events-none after:absolute after:inset-0 after:rounded-[10px] after:border-2 after:border-primary"
                : "block rounded-[10px]"}
            >
              <Card className="h-full transition-colors hover:border-primary/50"><CardContent className="flex items-start justify-between gap-3 p-5">
                <span className="min-w-0"><span className="block truncate font-semibold">{account.name}</span><span className="text-xs text-muted-foreground">{ACCOUNT_TYPES.find((item) => item.value === account.type)?.label}</span></span>
                <span className="shrink-0 text-right"><span className="block text-sm font-semibold tabular-nums">{formatRupiah(currentAccountBalance(account, transactions))}</span><span className="text-xs text-muted-foreground">saldo saat ini</span></span>
              </CardContent></Card>
            </Link>
          ))}
        </div>
      )}

      {selected && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="text-lg tracking-tight">Mutasi {selected.name}</h2><p className="text-xs text-muted-foreground">Saldo awal {formatRupiah(selected.openingBalance)}</p></div>
              {writable && <Button variant="ghost" size="sm" aria-label={`Hapus ${selected.name}`} onClick={() => { if (window.confirm(`Hapus rekening ${selected.name}?`)) { deleteAccount(selected.id); invalidate() } }}><Trash2 className="size-4" aria-hidden="true" /></Button>}
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

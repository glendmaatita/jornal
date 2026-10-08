import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ArrowUpRight, Plus, Save, Trash2, User, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DateField } from "@/components/ui/date-field"
import { SelectField } from "@/components/ui/select-field"
import { TextField } from "@/components/ui/text-field"
import { accountOptionLabel } from "@/lib/account-display"
import { formatInvoiceNumber, formatRupiah, parseAmountInput, todayIsoDate } from "@/lib/format"
import type { Invoice } from "@/lib/invoice-types"
import { queryKeys } from "@/lib/queries"
import { createTransactions, isCompanyWritable } from "@/lib/store"
import { isAccountEnabled, type Account } from "@/lib/types"

interface PaymentRow {
  id: string
  supplier: string
  amount: string
  paidOn: string
  accountId: string
}

export function InvoiceSupplierPayments({ invoice, accounts, defaultAccountId }: {
  invoice: Invoice
  accounts: Account[]
  defaultAccountId: string
}) {
  const client = useQueryClient()
  const formRef = useRef<HTMLFormElement>(null)
  const savingRef = useRef(false)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [saving, setSaving] = useState(false)
  const enabledAccounts = accounts.filter(isAccountEnabled)
  const invoiceNumber = formatInvoiceNumber(invoice.invoiceNumber, invoice.sequence, invoice.issueDate) || invoice.id
  const readOnly = invoice.status !== "PAID" || !isCompanyWritable()
  const today = todayIsoDate()

  const errorsFor = (row: PaymentRow) => ({
    supplier: row.supplier.trim().length > 255 ? "Nama supplier maksimal 255 karakter." : undefined,
    amount: !Number.isSafeInteger(parseAmountInput(row.amount)) || parseAmountInput(row.amount) <= 0
      ? "Masukkan nominal rupiah utuh yang lebih dari nol." : undefined,
    paidOn: !/^\d{4}-\d{2}-\d{2}$/.test(row.paidOn) || row.paidOn > today
      ? "Pilih tanggal pembayaran hari ini atau sebelumnya." : undefined,
    accountId: !enabledAccounts.some((account) => account.id === row.accountId)
      ? "Pilih rekening asal pembayaran." : undefined,
  })
  const total = rows.reduce((sum, row) => sum + (parseAmountInput(row.amount) || 0), 0)
  const validTotal = Number.isSafeInteger(total) && total > 0
  const updateRow = (id: string, patch: Partial<PaymentRow>) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    setError("")
  }
  const addRow = () => {
    const previous = rows[rows.length - 1]
    const preferredAccount = previous?.accountId || defaultAccountId
    setRows((current) => [...current, {
      id: crypto.randomUUID(), supplier: "", amount: "", paidOn: previous?.paidOn || today,
      accountId: enabledAccounts.some((account) => account.id === preferredAccount) ? preferredAccount : "",
    }])
    setNotice("")
    setError("")
  }
  const save = async () => {
    if (savingRef.current || readOnly || !rows.length) return
    if (rows.some((row) => Object.values(errorsFor(row)).some(Boolean)) || !validTotal) {
      setShowErrors(true)
      if (!validTotal) setError("Periksa nominal pembayaran. Total harus berupa rupiah utuh yang valid.")
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    savingRef.current = true
    setSaving(true)
    setError("")
    try {
      const saved = createTransactions(rows.map((row) => ({
        direction: "MONEY_OUT", amount: parseAmountInput(row.amount), currency: "IDR",
        transactionDate: row.paidOn,
        description: `Bayar supplier${row.supplier.trim() ? ` ${row.supplier.trim()}` : ""} untuk invoice ${invoiceNumber}`,
        notes: "", categoryId: null, paymentMethod: "Transfer", supplierCustomer: row.supplier.trim(),
        tags: "supplier,invoice", accountId: row.accountId, transferAccountId: null,
        attachmentName: null, attachmentDataUrl: null, relatedInvoiceId: invoice.id,
        classification: "OPERATING_EXPENSE", taxClassification: "OPERATING_EXPENSE",
        businessRelevance: "BUSINESS", classificationSource: "USER", classificationConfidence: 1,
        reviewStatus: "ACCEPTED",
      })))
      // Clear saved entries before refreshing so they cannot be submitted twice.
      setRows([])
      setShowErrors(false)
      setNotice(`${saved.length} pembayaran supplier tersimpan · Total ${formatRupiah(total)}. Anda bisa menambahkan pembayaran lagi untuk invoice ini.`)
      await client.invalidateQueries({ queryKey: queryKeys.transactions })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pembayaran supplier belum tersimpan. Coba lagi.")
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <section className="grid gap-3 rounded-xl border bg-white p-4" aria-label="Pembayaran supplier">
      <h2 className="flex items-center gap-2 font-semibold"><ArrowUpRight className="size-4 text-primary" aria-hidden="true" />Pembayaran supplier</h2>
      <p className="text-sm text-muted-foreground">Satu invoice bisa digunakan untuk beberapa supplier. Catat setiap pembayaran dengan nominal dan rekening asal masing-masing.</p>
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      <form ref={formRef} className="grid gap-3" noValidate onSubmit={(event) => { event.preventDefault(); void save() }}>
        {rows.map((row, index) => {
          const errors: Partial<ReturnType<typeof errorsFor>> = showErrors ? errorsFor(row) : {}
          return (
            <fieldset key={row.id} disabled={saving || readOnly} className="min-w-0 space-y-3 rounded-xl border p-3">
              <legend className="px-1 text-sm font-semibold">Pembayaran supplier {index + 1}</legend>
              <TextField label="Nama supplier (opsional)" icon={User} value={row.supplier} onChange={(supplier) => updateRow(row.id, { supplier })} placeholder="Nama supplier" error={errors.supplier} autoFocus />
              <TextField label="Nominal pembayaran supplier" type="amount" prefix="Rp" value={row.amount} onChange={(amount) => updateRow(row.id, { amount })} error={errors.amount} required />
              <DateField label="Tanggal pembayaran supplier" value={row.paidOn} onChange={(paidOn) => updateRow(row.id, { paidOn })} error={errors.paidOn} />
              <SelectField label="Rekening asal" icon={Wallet} value={row.accountId} onChange={(accountId) => updateRow(row.id, { accountId })} placeholder="Pilih rekening" searchable searchPlaceholder="Cari rekening…" options={enabledAccounts.map((account) => ({ value: account.id, label: accountOptionLabel(account) }))} error={errors.accountId} required />
              <Button type="button" variant="ghost" size="sm" aria-label={`Hapus pembayaran supplier ${index + 1}`} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><Trash2 aria-hidden="true" />Hapus pembayaran</Button>
            </fieldset>
          )
        })}
        <Button type="button" variant="outline" disabled={saving || readOnly} onClick={addRow}><Plus aria-hidden="true" />{rows.length ? "Tambah supplier / pembayaran" : "Tambah pembayaran supplier"}</Button>
        {rows.length > 0 && <>
          <p className="flex flex-wrap justify-between gap-2 text-sm"><span>{rows.length} pembayaran baru</span><strong>Total {validTotal ? formatRupiah(total) : "—"}</strong></p>
          <Button type="submit" disabled={saving || readOnly}><Save aria-hidden="true" />{saving ? "Menyimpan…" : "Simpan pembayaran supplier"}</Button>
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>
      {!rows.length && !readOnly && <Link to="/add" search={{ supplierInvoiceId: invoice.id, direction: "MONEY_OUT", description: `Bayar supplier untuk invoice ${invoiceNumber}`, account: defaultAccountId || undefined }} className="w-fit text-xs font-semibold text-[var(--link)] underline">Catat transfer ke supplier</Link>}
    </section>
  )
}

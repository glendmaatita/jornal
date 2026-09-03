import { useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, ChevronDown, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { RichTextField } from "@/components/ui/rich-text-field"
import { TextField } from "@/components/ui/text-field"
import { categoriesForKind, ALL_CATEGORIES } from "@/lib/categories"
import {
  classifyTransaction,
  confidenceLevel,
  detectDirection,
  reviewStatusFor,
  suggestFromPatterns,
  DEFAULT_THRESHOLDS,
} from "@/lib/classification"
import { formatDateShort, formatNumberInput, parseNumberValue, todayIsoDate } from "@/lib/format"
import { parseTransactionInput } from "@/lib/nlp"
import { queryKeys, useAccounts, useCorrections, useSettings, useTransactions } from "@/lib/queries"
import { createTransaction, updateTransaction } from "@/lib/store"
import type { ClassificationSource, TransactionClassification, TransactionDirection } from "@/lib/types"
import { CLASSIFICATION_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"

type Mode = "money_in" | "money_out" | "transfer"

const reviewStatusMeta: Record<string, { label: string; className: string }> = {
  AUTO_ACCEPTED: { label: "Otomatis dikonfirmasi", className: "bg-[color-mix(in_oklab,var(--mint)_12%,white)] text-[var(--mint)]" },
  ACCEPTED: { label: "Diterima — mohon periksa", className: "bg-amber-50 text-amber-800 border-amber-200" },
  NEEDS_REVIEW: { label: "Butuh konfirmasi", className: "bg-red-50 text-red-800 border-red-200" },
}

export function TransactionFormPage() {
  const { transactionId } = useParams({ strict: false }) as { transactionId?: string }
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: corrections = [] } = useCorrections()
  const { data: settings } = useSettings()

  const editing = useMemo(() => transactions.find((transaction) => transaction.id === transactionId) ?? null, [transactions, transactionId])
  const thresholds = settings ?? DEFAULT_THRESHOLDS

  const [mode, setMode] = useState<Mode>("money_out")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [transactionDate, setTransactionDate] = useState(todayIsoDate())
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState("Transfer")
  const [supplierCustomer, setSupplierCustomer] = useState("")
  const [tags, setTags] = useState("")
  const [notes, setNotes] = useState("")
  const [attachmentName, setAttachmentName] = useState<string | null>(null)
  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | null>(null)
  const [attachmentMode, setAttachmentMode] = useState<"upload" | "camera">("upload")
  const [showMore, setShowMore] = useState(false)
  const [classificationOverride, setClassificationOverride] = useState<TransactionClassification | null>(null)
  const [smartText, setSmartText] = useState("")
  const [showSmart, setShowSmart] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const [paymentMethodListId] = useState(() => `payment-methods-${crypto.randomUUID()}`)
  const [supplierCustomerListId] = useState(() => `supplier-customer-${crypto.randomUUID()}`)

  // Load the transaction being edited — adapted during render (no effect needed)
  if (editing && editing.id !== loadedId) {
    setLoadedId(editing.id)
    setMode(editing.classification === "INTERNAL_TRANSFER" ? "transfer" : editing.direction === "MONEY_IN" ? "money_in" : "money_out")
    setAmount(editing.amount > 0 ? formatNumberInput(editing.amount) : "")
    setDescription(editing.description)
    setTransactionDate(editing.transactionDate)
    setCategoryId(editing.categoryId)
    setAccountId(editing.accountId)
    setTransferAccountId(editing.transferAccountId)
    setPaymentMethod(editing.paymentMethod)
    setSupplierCustomer(editing.supplierCustomer)
    setTags(editing.tags)
    setNotes(editing.notes)
    setAttachmentName(editing.attachmentName)
    setAttachmentDataUrl(editing.attachmentDataUrl)
    if (editing.classificationSource === "USER") setClassificationOverride(editing.classification)
  }

  const direction: TransactionDirection = mode === "money_in" ? "MONEY_IN" : "MONEY_OUT"

  // Live auto-classification (§21–23): learned patterns first, then rules
  const suggestion = useMemo(() => {
    if (mode === "transfer") {
      return { categoryId: null, classification: "INTERNAL_TRANSFER" as const, confidence: 1, source: "USER" as const, businessRelevance: "NON_BUSINESS" as const }
    }
    const learned = suggestFromPatterns(description, direction, corrections)
    if (learned) return learned
    return classifyTransaction(description, direction)
  }, [description, direction, corrections, mode])

  const effectiveClassification: TransactionClassification =
    classificationOverride ?? suggestion.classification
  const effectiveCategoryId = categoryId ?? suggestion.categoryId
  const effectiveConfidence = classificationOverride ? 1 : suggestion.confidence
  const effectiveSource: ClassificationSource =
    classificationOverride || categoryId ? "USER" : suggestion.source
  const reviewStatus = reviewStatusFor(effectiveConfidence, thresholds)
  const suggestionLevel = confidenceLevel(effectiveConfidence, thresholds)

  // Validation (shown after first submit attempt)
  const amountValue = parseNumberValue(amount)
  const amountError = amountValue <= 0 ? "Jumlah wajib diisi (lebih dari nol)." : undefined
  const transferError =
    mode === "transfer" && (!accountId || !transferAccountId || accountId === transferAccountId)
      ? "Pilih akun asal dan tujuan yang berbeda."
      : undefined
  const descriptionError = mode !== "transfer" && !description.trim() ? "Keterangan membantu sistem mengklasifikasi transaksi." : undefined
  const canSave = !amountError && !transferError && !descriptionError

  const applySmartInput = () => {
    const parsed = parseTransactionInput(smartText)
    setMode(parsed.direction === "MONEY_IN" ? "money_in" : "money_out")
    if (parsed.amount) setAmount(formatNumberInput(parsed.amount))
    setDescription(parsed.description)
    setTransactionDate(parsed.transactionDate)
    setClassificationOverride(null)
    setCategoryId(null)
  }

  const openAttachmentPicker = (mode: "upload" | "camera") => {
    setAttachmentMode(mode)
    attachmentInputRef.current?.click()
  }

  const handleAttachmentSelected = async (file: File | null) => {
    if (!file) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })
    setAttachmentName(file.name)
    setAttachmentDataUrl(dataUrl)
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        direction,
        amount: amountValue,
        currency: "IDR",
        transactionDate,
        description: description.trim(),
        notes: notes.trim(),
        categoryId: effectiveCategoryId,
        paymentMethod: paymentMethod.trim(),
        supplierCustomer: supplierCustomer.trim(),
        tags: tags.trim(),
        accountId,
        transferAccountId: mode === "transfer" ? transferAccountId : null,
        attachmentName,
        attachmentDataUrl: attachmentDataUrl ?? editing?.attachmentDataUrl ?? null,
        taxClassification: effectiveClassification,
        classification: effectiveClassification,
        businessRelevance: mode === "transfer" ? "NON_BUSINESS" : suggestion.businessRelevance,
        classificationSource: effectiveSource,
        classificationConfidence: effectiveConfidence,
        reviewStatus,
      } as const

      if (editing) {
        updateTransaction(editing.id, payload)
      } else {
        createTransaction(payload)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      await queryClient.invalidateQueries({ queryKey: queryKeys.corrections })
      void navigate({ to: "/transactions" })
    },
  })

  const submit = () => {
    if (!canSave) {
      setShowErrors(true)
      return
    }
    save.mutate()
  }

  const categoryOptions = categoriesForKind(direction === "MONEY_IN" ? "income" : "expense")
  const paymentMethodOptions = useMemo(() => {
    const values = [paymentMethod, ...transactions.map((transaction) => transaction.paymentMethod)]
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  }, [paymentMethod, transactions])
  const supplierCustomerOptions = useMemo(() => {
    const values = [supplierCustomer, ...transactions.map((transaction) => transaction.supplierCustomer)]
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  }, [supplierCustomer, transactions])

  return (
    <div className="pb-8">
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft aria-hidden="true" />
          Kembali
        </Button>
        <span className="text-xs text-muted-foreground">{editing ? "Ubah transaksi" : "Transaksi baru"}</span>
      </div>

      {!editing && (
        <button
          type="button"
          onClick={() => setShowSmart((current) => !current)}
          className="mb-3 flex w-full items-center gap-2 rounded-[10px] border border-[#16579d]/25 bg-white px-4 py-3 text-left text-sm font-medium text-[#16579d]"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Tulis cepat: "bayar iklan meta 3jt"
        </button>
      )}
      {showSmart && !editing && (
        <Card className="mb-3">
          <CardContent className="p-3">
            <TextField
              value={smartText}
              onChange={setSmartText}
              placeholder="penjualan hari ini 12.5jt"
              hint="Contoh: bayar iklan meta 3jt, penjualan 12.5jt, bensin 500rb"
            />
            <Button size="sm" type="button" className="mt-2 w-full" onClick={applySmartInput} disabled={!smartText.trim()}>
              Parse
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Transaction type (§12) */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => {
            setMode("money_in")
            setClassificationOverride(null)
            setCategoryId(null)
          }}
          className={cn(
            "rounded-[10px] border py-3 text-sm font-semibold transition-colors",
            mode === "money_in"
              ? "border-[var(--mint)] bg-[var(--mint)] text-white shadow-sm"
              : "border-border bg-white text-[var(--body-text)]",
          )}
        >
          Masuk
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("money_out")
            setClassificationOverride(null)
            setCategoryId(null)
          }}
          className={cn(
            "rounded-[10px] border py-3 text-sm font-semibold transition-colors",
            mode === "money_out"
              ? "border-[var(--main-dark)] bg-[var(--main-dark)] text-white shadow-sm"
              : "border-border bg-white text-[var(--body-text)]",
          )}
        >
          Uang Keluar
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("transfer")
            setClassificationOverride(null)
            setCategoryId(null)
          }}
          className={cn(
            "rounded-[10px] border py-3 text-sm font-semibold transition-colors",
            mode === "transfer"
              ? "border-[var(--main-dark)] bg-[var(--main-dark)] text-white shadow-sm"
              : "border-border bg-white text-[var(--body-text)]",
          )}
        >
          Transfer
        </button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <TextField
            label="Jumlah"
            required
            type="amount"
            size="amount"
            prefix="Rp"
            value={amount}
            onChange={(value) => {
              setAmount(value)
              setShowErrors(false)
            }}
            error={showErrors ? amountError : undefined}
            hint="Nominal transaksi"
            autoFocus
          />

          {mode === "transfer" ? (
            <div className="space-y-3 rounded-[10px] bg-[#f1f5fd] p-3">
              <p className="text-sm font-medium">Transfer antar rekening — tidak dihitung sebagai omzet atau biaya (§32)</p>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--body-text)]">Dari akun</span>
                <select value={accountId ?? ""} onChange={(event) => setAccountId(event.target.value || null)} className="field-shell !min-h-[46px] w-full !py-0 text-sm">
                  <option value="">Pilih akun</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--body-text)]">Ke akun</span>
                <select value={transferAccountId ?? ""} onChange={(event) => setTransferAccountId(event.target.value || null)} className="field-shell !min-h-[46px] w-full !py-0 text-sm">
                  <option value="">Pilih akun</option>
                  {accounts.filter((account) => account.id !== accountId).map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              {showErrors && transferError && <p className="field-error">{transferError}</p>}
            </div>
          ) : (
            <TextField
              label="Keterangan"
              value={description}
              onChange={(value) => {
                setDescription(value)
                const detected = detectDirection(value)
                if (detected) {
                  setMode(detected === "MONEY_IN" ? "money_in" : "money_out")
                }
                setClassificationOverride(null)
                setCategoryId(null)
              }}
              placeholder="Misal: iklan meta, bensin, penjualan"
              error={showErrors ? descriptionError : undefined}
              hint="Sistem mengklasifikasi otomatis dari keterangan ini"
            />
          )}

          <DateField
            label="Tanggal"
            value={transactionDate}
            onChange={setTransactionDate}
          />

          {/* Classification preview (§22–23) */}
          {mode !== "transfer" && (
            <div className="rounded-[10px] bg-[#f1f5fd] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={reviewStatusMeta[reviewStatus].className}>{reviewStatusMeta[reviewStatus].label}</Badge>
                <Badge>{CLASSIFICATION_LABELS[effectiveClassification]}</Badge>
                <Badge>{suggestion.source === "HISTORICAL_PATTERN" ? "Pola Anda" : suggestion.source === "RULE" ? "Aturan" : "Anda"}</Badge>
              </div>
              <p className="mt-2 text-xs text-[var(--body-text)]">
                Kategori: <strong>{ALL_CATEGORIES.find((category) => category.id === effectiveCategoryId)?.name ?? "belum ada"}</strong>
                {suggestionLevel === "accept_with_suggestion" && " — saran sistem, silakan periksa"}
              </p>
            </div>
          )}

          {/* More Options (§15) */}
          <button
            type="button"
            onClick={() => setShowMore((current) => !current)}
            className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-[var(--link)]"
          >
            {showMore ? "Sembunyikan" : "More Options"}
            <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} aria-hidden="true" />
          </button>

          {showMore && (
            <div className="space-y-3 rounded-[10px] bg-[#f1f5fd] p-3">
              {mode !== "transfer" && (
                <>
                  <label className="block">
                    <span className="field-label !mb-1 !text-xs">Kategori</span>
                    <select
                      value={effectiveCategoryId ?? ""}
                      onChange={(event) => {
                        setCategoryId(event.target.value || null)
                        setClassificationOverride(null)
                      }}
                      className="field-shell !min-h-[46px] w-full !py-0 text-sm"
                    >
                      <option value="">Otomatis ({suggestion.categoryId ? ALL_CATEGORIES.find((category) => category.id === suggestion.categoryId)?.name : "tidak yakin"})</option>
                      {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="field-label !mb-1 !text-xs">Jenis klasifikasi</span>
                    <select
                      value={effectiveClassification}
                      onChange={(event) => setClassificationOverride(event.target.value as TransactionClassification)}
                      className="field-shell !min-h-[46px] w-full !py-0 text-sm"
                    >
                      {(direction === "MONEY_IN"
                        ? ["REVENUE", "CAPITAL_INJECTION", "LOAN_RECEIVED", "REFUND", "OTHER_INCOME", "INTERNAL_TRANSFER"]
                        : ["OPERATING_EXPENSE", "OWNER_WITHDRAWAL", "ASSET_PURCHASE", "LOAN_PAYMENT", "TAX_PAYMENT", "OTHER_OUTFLOW", "INTERNAL_TRANSFER"]
                      ).map((classification) => (
                        <option key={classification} value={classification}>{CLASSIFICATION_LABELS[classification as TransactionClassification]}</option>
                      ))}
                    </select>
                    {effectiveClassification === "INTERNAL_TRANSFER" && (
                      <button
                        type="button"
                        onClick={() => setMode("transfer")}
                        className="mt-1.5 text-xs font-semibold text-[var(--link)] underline"
                      >
                        Isi akun asal & tujuan transfer
                      </button>
                    )}
                  </label>
                </>
              )}
              <label className="block">
                <span className="field-label !mb-1 !text-xs">Akun</span>
                <select value={accountId ?? ""} onChange={(event) => setAccountId(event.target.value || null)} className="field-shell !min-h-[46px] w-full !py-0 text-sm">
                  <option value="">Tanpa akun</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
              <TextField
                label="Metode pembayaran"
                value={paymentMethod}
                onChange={setPaymentMethod}
                placeholder="Transfer, QRIS, tunai…"
                list={paymentMethodListId}
              />
              <datalist id={paymentMethodListId}>
                {paymentMethodOptions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <TextField
                label="Supplier / Customer"
                value={supplierCustomer}
                onChange={setSupplierCustomer}
                placeholder="Nama supplier atau pelanggan"
                list={supplierCustomerListId}
              />
              <datalist id={supplierCustomerListId}>
                {supplierCustomerOptions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <TextField label="Tag" value={tags} onChange={setTags} placeholder="project-alpha, penting" hint="Pisahkan dengan koma" />
              <RichTextField label="Catatan" value={notes} onChange={setNotes} placeholder="Catatan tambahan…" minHeight={80} />
              <div className="space-y-2">
                <span className="field-label">Lampiran</span>
                <input
                  ref={attachmentInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  capture={attachmentMode === "camera" ? "environment" : undefined}
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null
                    await handleAttachmentSelected(file)
                    event.target.value = ""
                  }}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" onClick={() => openAttachmentPicker("upload")}>
                    Upload file
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openAttachmentPicker("camera")}>
                    Buka kamera
                  </Button>
                </div>
                {attachmentName && (
                  <div className="rounded-[10px] border border-border bg-white p-3 text-xs text-[var(--body-text)]">
                    <div className="font-medium">{attachmentName}</div>
                    <div className="mt-1 text-muted-foreground">
                      {attachmentDataUrl ? "Lampiran siap disimpan" : "Belum ada data lampiran"}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button size="lg" className="w-full" disabled={save.isPending} onClick={submit}>
            Simpan
          </Button>
          {editing && (
            <Link to="/transactions/$transactionId" params={{ transactionId: editing.id }} className="block text-center text-xs font-medium text-[var(--link)] underline">
              Batal
            </Link>
          )}
        </CardContent>
      </Card>

      {editing && (
        <p className="mt-3 text-center text-xs text-[var(--body-text)]">
          Terakhir diubah {formatDateShort(editing.transactionDate)}
        </p>
      )}
    </div>
  )
}

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, ChevronDown, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
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
import { formatDateShort, formatNumberInput, formatRupiah, parseNumberValue, todayIsoDate } from "@/lib/format"
import { parseTransactionInput } from "@/lib/nlp"
import { queryKeys, useAccounts, useCorrections, useSettings, useTransactions } from "@/lib/queries"
import { createTransaction, updateTransaction } from "@/lib/store"
import type { ClassificationSource, TransactionClassification, TransactionDirection } from "@/lib/types"
import { CLASSIFICATION_LABELS } from "@/lib/types"
import { cn } from "@/lib/utils"
import { activeCompany } from "@/lib/companies"
import { scopedStorageKey } from "@/lib/store"
import { clearMirroredState, mirrorState, restoreState } from "@/lib/local-db"

type Mode = "money_in" | "money_out" | "receivable" | "owner_withdrawal" | "transfer"

const RichTextField = lazy(() => import("@/components/ui/rich-text-field").then((module) => ({ default: module.RichTextField })))

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
  const receivableIdFromUrl = new URLSearchParams(window.location.search).get("receivable")
  const repaymentSource = useMemo(
    () => receivableIdFromUrl && receivableIdFromUrl !== "new" ? transactions.find((transaction) => transaction.id === receivableIdFromUrl && transaction.classification === "RECEIVABLE_CREATED") ?? null : null,
    [receivableIdFromUrl, transactions],
  )
  const thresholds = settings ?? DEFAULT_THRESHOLDS

  const [mode, setMode] = useState<Mode>(() => {
    const direction = new URLSearchParams(window.location.search).get("direction")
    if (new URLSearchParams(window.location.search).get("receivable") === "new") return "receivable"
    return direction === "MONEY_IN" ? "money_in" : direction === "MONEY_OUT" ? "money_out" : "money_out"
  })
  const [amount, setAmount] = useState(() => new URLSearchParams(window.location.search).get("amount") || "")
  const [description, setDescription] = useState(() => new URLSearchParams(window.location.search).get("description") || "")
  const [transactionDate, setTransactionDate] = useState(() => new URLSearchParams(window.location.search).get("date") || todayIsoDate())
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(() => readEntryPreference("account"))
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState(() => readEntryPreference("payment") || "Transfer")
  const [supplierCustomer, setSupplierCustomer] = useState("")
  const [tags, setTags] = useState("")
  const [notes, setNotes] = useState("")
  const [attachmentName, setAttachmentName] = useState<string | null>(null)
  const [attachmentDataUrl, setAttachmentDataUrl] = useState<string | null>(null)
  const [attachmentRemoved, setAttachmentRemoved] = useState(false)
  const [showMore, setShowMore] = useState(() => new URLSearchParams(window.location.search).get("receivable") === "new")
  const [captureRequested, setCaptureRequested] = useState(false)
  const [classificationOverride, setClassificationOverride] = useState<TransactionClassification | null>(null)
  const [receivableDueDate, setReceivableDueDate] = useState<string | null>(null)
  const [smartText, setSmartText] = useState("")
  const [showSmart, setShowSmart] = useState(false)
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const [paymentMethodListId] = useState(() => `payment-methods-${crypto.randomUUID()}`)
  const [supplierCustomerListId] = useState(() => `supplier-customer-${crypto.randomUUID()}`)
  const draftKey = scopedStorageKey(`jornal.transaction-draft.${transactionId ?? "new"}.v1`)
  const draftRestoredRef = useRef(false)

  // Keep an unfinished entry available across navigation, refresh, and a
  // service-worker update. Drafts are tenant-scoped through scopedStorageKey.
  useEffect(() => {
    if (draftRestoredRef.current) return
    let active = true
    const restoreDraft = (draft: Partial<{
          mode: Mode; amount: string; description: string; transactionDate: string; categoryId: string | null
          accountId: string | null; transferAccountId: string | null; paymentMethod: string; supplierCustomer: string
          tags: string; notes: string; attachmentName: string | null; attachmentDataUrl: string | null
          classificationOverride: TransactionClassification | null; receivableDueDate: string | null
        }> | null) => {
      if (!draft || !active) return
      if (draft.mode) setMode(draft.mode)
      if (typeof draft.amount === "string") setAmount(draft.amount)
      if (typeof draft.description === "string") setDescription(draft.description)
      if (typeof draft.transactionDate === "string") setTransactionDate(draft.transactionDate)
      if ("categoryId" in draft) setCategoryId(draft.categoryId ?? null)
      if ("accountId" in draft) setAccountId(draft.accountId ?? null)
      if ("transferAccountId" in draft) setTransferAccountId(draft.transferAccountId ?? null)
      if (typeof draft.paymentMethod === "string") setPaymentMethod(draft.paymentMethod)
      if (typeof draft.supplierCustomer === "string") setSupplierCustomer(draft.supplierCustomer)
      if (typeof draft.tags === "string") setTags(draft.tags)
      if (typeof draft.notes === "string") setNotes(draft.notes)
      if ("attachmentName" in draft) setAttachmentName(draft.attachmentName ?? null)
      if ("attachmentDataUrl" in draft) setAttachmentDataUrl(draft.attachmentDataUrl ?? null)
      if ("classificationOverride" in draft) setClassificationOverride(draft.classificationOverride ?? null)
      if ("receivableDueDate" in draft) setReceivableDueDate(draft.receivableDueDate ?? null)
    }
    void (async () => {
      try {
        const raw = window.localStorage.getItem(draftKey)
        if (raw) restoreDraft(JSON.parse(raw))
        else restoreDraft(await restoreState(draftKey).catch(() => null) as Partial<{ mode: Mode; amount: string; description: string; transactionDate: string; categoryId: string | null; accountId: string | null; transferAccountId: string | null; paymentMethod: string; supplierCustomer: string; tags: string; notes: string; attachmentName: string | null; attachmentDataUrl: string | null; classificationOverride: TransactionClassification | null; receivableDueDate: string | null }> | null)
      } catch {
        window.localStorage.removeItem(draftKey)
      } finally {
        if (active) draftRestoredRef.current = true
      }
    })()
    return () => { active = false }
  }, [draftKey])
  /* eslint-disable react-hooks/set-state-in-effect -- prefill a repayment from its selected receivable */
  useEffect(() => {
    if (!repaymentSource || editing) return
    setMode("money_in")
    setDescription((current) => current || `Pelunasan piutang: ${repaymentSource.supplierCustomer || repaymentSource.description}`)
    setSupplierCustomer((current) => current || repaymentSource.supplierCustomer)
  }, [repaymentSource, editing])
  /* eslint-enable react-hooks/set-state-in-effect */
  /* eslint-disable react-hooks/set-state-in-effect -- consume validated shortcut/share intent once */
  useEffect(() => {
    if (editing) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("capture") === "receipt") {
      setCaptureRequested(true)
      setShowMore(true)
    }
    if (params.get("shared") === "1") {
      const sharedText = [params.get("title"), params.get("text"), params.get("url")]
        .filter((value): value is string => Boolean(value?.trim())).join("\n")
      if (sharedText) setDescription((current) => current || sharedText)
      const token = params.get("shareToken")
      if (token) {
        void fetch(`/share-target?token=${encodeURIComponent(token)}`).then(async (response) => {
          if (!response.ok) return
          const shared = await response.json() as { file?: { name: string; type: string; data: string } }
          if (!shared.file) return
          setAttachmentName(shared.file.name)
          setAttachmentDataUrl(`data:${shared.file.type};base64,${shared.file.data}`)
          setAttachmentRemoved(false)
        }).catch(() => undefined)
      }
    }
  }, [editing])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!draftRestoredRef.current || editing) return
    const draft = {
        mode, amount, description, transactionDate, categoryId, accountId, transferAccountId,
        paymentMethod, supplierCustomer, tags, notes, attachmentName, attachmentDataUrl,
        classificationOverride, receivableDueDate,
      }
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(draft))
      void mirrorState(draftKey, draft).catch(() => undefined)
    } catch {
      // Save still reports its own durable result; draft persistence is best effort.
    }
  }, [draftKey, editing, mode, amount, description, transactionDate, categoryId, accountId, transferAccountId, paymentMethod, supplierCustomer, tags, notes, attachmentName, attachmentDataUrl, classificationOverride, receivableDueDate])

  // Load the transaction being edited — adapted during render (no effect needed)
  if (editing && editing.id !== loadedId) {
    setLoadedId(editing.id)
    setMode(
      editing.classification === "INTERNAL_TRANSFER"
        ? "transfer"
        : editing.classification === "OWNER_WITHDRAWAL"
          ? "owner_withdrawal"
          : editing.direction === "MONEY_IN"
            ? "money_in"
            : "money_out",
    )
    if (editing.classification === "RECEIVABLE_CREATED") setMode("receivable")
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
    setAttachmentRemoved(false)
    setReceivableDueDate(editing.receivableDueDate ?? null)
    if (editing.classificationSource === "USER") setClassificationOverride(editing.classification)
  }

  const isReceivableCreation = mode === "receivable"
  const isReceivablePayment = Boolean(repaymentSource) || editing?.classification === "RECEIVABLE_PAYMENT"
  const repaymentRemaining = useMemo(() => {
    const sourceId = repaymentSource?.id ?? editing?.receivableTransactionId
    if (!sourceId) return null
    const source = transactions.find((transaction) => transaction.id === sourceId)
    if (!source) return null
    const paid = transactions
      .filter((transaction) => transaction.id !== editing?.id && transaction.classification === "RECEIVABLE_PAYMENT" && transaction.receivableTransactionId === sourceId)
      .reduce((sum, transaction) => sum + transaction.amount, 0)
    return Math.max(0, source.amount - paid)
  }, [repaymentSource, editing?.id, editing?.receivableTransactionId, transactions])
  const direction: TransactionDirection = mode === "money_in" || isReceivablePayment ? "MONEY_IN" : "MONEY_OUT"

  // Live auto-classification (§21–23): learned patterns first, then rules
  const suggestion = useMemo(() => {
    if (mode === "transfer") {
      return { categoryId: null, classification: "INTERNAL_TRANSFER" as const, confidence: 1, source: "USER" as const, businessRelevance: "NON_BUSINESS" as const }
    }
    if (mode === "owner_withdrawal") {
      return { categoryId: null, classification: "OWNER_WITHDRAWAL" as const, confidence: 1, source: "USER" as const, businessRelevance: "NON_BUSINESS" as const }
    }
    if (isReceivableCreation) return { categoryId: null, classification: "RECEIVABLE_CREATED" as const, confidence: 1, source: "USER" as const, businessRelevance: "NON_BUSINESS" as const }
    if (isReceivablePayment) return { categoryId: null, classification: "RECEIVABLE_PAYMENT" as const, confidence: 1, source: "USER" as const, businessRelevance: "NON_BUSINESS" as const }
    const learned = suggestFromPatterns(description, direction, corrections)
    if (learned) return learned
    return classifyTransaction(description, direction)
  }, [description, direction, corrections, mode, isReceivableCreation, isReceivablePayment])

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
  const selectedAccountId = accountId && accounts.some((account) => account.id === accountId) ? accountId : null
  const selectedTransferAccountId = transferAccountId && accounts.some((account) => account.id === transferAccountId) ? transferAccountId : null
  const transferError =
    mode === "transfer" && (!selectedAccountId || !selectedTransferAccountId || selectedAccountId === selectedTransferAccountId)
      ? "Pilih akun asal dan tujuan yang berbeda."
      : undefined
  const descriptionError = mode !== "transfer" && !description.trim() ? "Keterangan wajib diisi." : undefined
  const debtorError = isReceivableCreation && !supplierCustomer.trim() ? "Masukkan nama orang yang meminjam." : undefined
  const repaymentError = isReceivablePayment && repaymentRemaining !== null && amountValue > repaymentRemaining
    ? `Pembayaran melebihi sisa piutang (${formatNumberInput(repaymentRemaining)}).`
    : undefined
  const canSave = !amountError && !transferError && !descriptionError && !debtorError && !repaymentError

  useEffect(() => {
    if (!showErrors) return
    const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]')
    firstInvalid?.focus()
  }, [showErrors, amountError, transferError, descriptionError])

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
    // Invoke the preconfigured input during the user's gesture. Waiting for a
    // state commit can lose mobile browser user activation and open no picker.
    if (mode === "camera") cameraInputRef.current?.click()
    else uploadInputRef.current?.click()
  }

  const handleAttachmentSelected = async (file: File | null) => {
    if (!file) return
    const maxBytes = 8 * 1024 * 1024
    if (file.size > maxBytes) {
      setAttachmentError("Lampiran terlalu besar. Pilih file sampai 8 MB.")
      return
    }
    setAttachmentError(null)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ""))
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })
    setAttachmentName(file.name)
    setAttachmentDataUrl(dataUrl)
    setAttachmentRemoved(false)
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
        accountId: selectedAccountId,
        transferAccountId: mode === "transfer" ? selectedTransferAccountId : null,
        attachmentName,
        attachmentDataUrl: attachmentDataUrl ?? editing?.attachmentDataUrl ?? null,
        attachmentRemoteUrl: attachmentRemoved ? null : attachmentDataUrl ? null : editing?.attachmentRemoteUrl ?? null,
        taxClassification: effectiveClassification,
        classification: effectiveClassification,
        businessRelevance: mode === "transfer" ? "NON_BUSINESS" : suggestion.businessRelevance,
        classificationSource: effectiveSource,
        classificationConfidence: effectiveConfidence,
        reviewStatus,
        receivableTransactionId: isReceivablePayment ? (repaymentSource?.id ?? editing?.receivableTransactionId ?? null) : null,
        receivableDueDate: isReceivableCreation ? receivableDueDate : null,
      } as const

      if (editing) {
        updateTransaction(editing.id, payload)
      } else {
        createTransaction(payload)
      }
      writeEntryPreference("account", selectedAccountId)
      writeEntryPreference("payment", paymentMethod.trim())
    },
    onSuccess: async () => {
      try { window.localStorage.removeItem(draftKey) } catch { /* ignore */ }
      await clearMirroredState(draftKey).catch(() => undefined)
      await queryClient.invalidateQueries({ queryKey: queryKeys.transactions })
      await queryClient.invalidateQueries({ queryKey: queryKeys.corrections })
      void navigate({ to: "/transactions" })
    },
  })

  const submit = () => {
    if (save.isPending) return
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
        <span className="text-right text-xs text-muted-foreground">{editing ? "Ubah transaksi" : "Transaksi baru"}<br />{activeCompany()?.name}</span>
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
              Terapkan
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Transaction type (§12) */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
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
            setMode("receivable")
            setClassificationOverride("RECEIVABLE_CREATED")
            setCategoryId(null)
            setShowMore(true)
          }}
          className={cn(
            "rounded-[10px] border py-3 text-sm font-semibold transition-colors",
            mode === "receivable"
              ? "border-[#df1769] bg-[#df1769] text-white shadow-sm"
              : "border-border bg-white text-[var(--body-text)]",
          )}
        >
          Piutang
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("owner_withdrawal")
            setClassificationOverride(null)
            setCategoryId(null)
          }}
          className={cn(
            "rounded-[10px] border py-3 text-sm font-semibold transition-colors",
            mode === "owner_withdrawal"
              ? "border-[#df1769] bg-[#df1769] text-white shadow-sm"
              : "border-border bg-white text-[var(--body-text)]",
          )}
        >
          Prive
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

      {isReceivablePayment && repaymentSource && (
        <div className="mb-4 rounded-[10px] border border-[#df1769]/25 bg-[#fff1f7] p-3 text-sm text-[#8c1249]">
          Mencatat pelunasan dari <strong>{repaymentSource.supplierCustomer || repaymentSource.description}</strong>. Sisa piutang {formatRupiah(repaymentRemaining ?? repaymentSource.amount)}. Ini bukan omzet.
        </div>
      )}

      {mode === "owner_withdrawal" && (
        <div className="mb-4 rounded-[10px] border border-[#df1769]/25 bg-[#fff1f7] p-3 text-sm text-[#8c1249]">
          Pengambilan uang perusahaan untuk keperluan pribadi. Saldo kas berkurang, tetapi transaksi ini bukan biaya bisnis dan tidak mengurangi pajak.
        </div>
      )}

      <Card>
        <form onSubmit={(event) => { event.preventDefault(); submit() }}>
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
            error={showErrors ? amountError ?? repaymentError : undefined}
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
                if (detected && mode !== "owner_withdrawal") {
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

          {isReceivableCreation && (
            <DateField
              label="Jatuh tempo (opsional)"
              value={receivableDueDate ?? ""}
              onChange={(value) => setReceivableDueDate(value || null)}
              hint="Tanggal yang disepakati untuk mengembalikan uang"
            />
          )}

          {/* Classification preview (§22–23) */}
          {mode !== "transfer" && !isReceivableCreation && !isReceivablePayment && (
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

          {/* Opsi tambahan (§15) */}
          <button
            type="button"
            onClick={() => setShowMore((current) => !current)}
            className="flex w-full items-center justify-center gap-1 text-sm font-semibold text-[var(--link)]"
          >
            {showMore ? "Sembunyikan" : "Opsi tambahan"}
            <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} aria-hidden="true" />
          </button>

          {showMore && (
            <div className="space-y-3 rounded-[10px] bg-[#f1f5fd] p-3">
              {mode !== "transfer" && !isReceivableCreation && !isReceivablePayment && (
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
                      onChange={(event) => {
                        const next = event.target.value as TransactionClassification
                        setClassificationOverride(next)
                        if (next === "INTERNAL_TRANSFER") setMode("transfer")
                        else if (next === "OWNER_WITHDRAWAL") setMode("owner_withdrawal")
                        else if (mode === "owner_withdrawal") setMode("money_out")
                      }}
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
                placeholder={isReceivableCreation ? "Nama orang yang meminjam" : "Nama supplier atau pelanggan"}
                list={supplierCustomerListId}
              />
              {showErrors && debtorError && <p className="field-error">{debtorError}</p>}
              <datalist id={supplierCustomerListId}>
                {supplierCustomerOptions.map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              <TextField label="Tag" value={tags} onChange={setTags} placeholder="project-alpha, penting" hint="Pisahkan dengan koma" />
              <Suspense fallback={<div className="field-shell text-sm text-muted-foreground">Memuat editor…</div>}>
                <RichTextField label="Catatan" value={notes} onChange={setNotes} placeholder="Catatan tambahan…" minHeight={80} />
              </Suspense>
              <div className="space-y-2">
                <span className="field-label">Lampiran</span>
                {captureRequested && !attachmentDataUrl && (
                  <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground" role="status">
                    Mode foto siap. Tekan “Ambil foto” untuk mengambil struk.
                  </p>
                )}
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null
                    await handleAttachmentSelected(file)
                    event.target.value = ""
                  }}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null
                    await handleAttachmentSelected(file)
                    event.target.value = ""
                  }}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" onClick={() => openAttachmentPicker("upload")}>
                    Pilih file
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openAttachmentPicker("camera")}>
                    Ambil foto
                  </Button>
                </div>
                {attachmentName && (
                  <div className="rounded-[10px] border border-border bg-white p-3 text-xs text-[var(--body-text)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{attachmentName}</div>
                        <div className="mt-1 text-muted-foreground">
                          {attachmentDataUrl ? "Lampiran siap disimpan" : "Lampiran tersimpan"}
                        </div>
                      </div>
                      <button type="button" className="font-semibold text-[var(--link)] underline" onClick={() => {
                        setAttachmentName(null)
                        setAttachmentDataUrl(null)
                        setAttachmentRemoved(true)
                      }}>Hapus</button>
                    </div>
                  </div>
                )}
                {attachmentError && <p className="field-error" role="alert">{attachmentError}</p>}
              </div>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={save.isPending}>
            Simpan
          </Button>
          {save.isError && (
            <p className="field-error text-center" role="alert">
              Transaksi belum tersimpan. Data isian tetap ada; coba lagi.
            </p>
          )}
          {editing && (
            <Link to="/transactions/$transactionId" params={{ transactionId: editing.id }} className="block text-center text-xs font-medium text-[var(--link)] underline">
              Batal
            </Link>
          )}
        </CardContent>
        </form>
      </Card>

      {editing && (
        <p className="mt-3 text-center text-xs text-[var(--body-text)]">
          Terakhir diubah {formatDateShort(editing.transactionDate)}
        </p>
      )}
    </div>
  )
}

function readEntryPreference(kind: "account" | "payment") {
  try {
    return window.localStorage.getItem(scopedStorageKey(`jornal.entry-default.${kind}.v1`))
  } catch {
    return null
  }
}

function writeEntryPreference(kind: "account" | "payment", value: string | null) {
  try {
    const key = scopedStorageKey(`jornal.entry-default.${kind}.v1`)
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch { /* preferences are optional; the transaction itself is already saved */ }
}

import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ArrowLeft, CalendarClock, ClipboardCheck, PiggyBank, Plus, Repeat, Sparkles, Trash2, TrendingDown, TrendingUp } from "lucide-react"

import { ConfidenceBadge } from "@/components/transaction-item"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DateField } from "@/components/ui/date-field"
import { TextField } from "@/components/ui/text-field"
import { formatRupiah, formatDateShort, parseAmountInput } from "@/lib/format"
import { formatWeeklyChangeText, stsWeeklyChange } from "@/lib/history"
import { recommendReserves } from "@/lib/forecast"
import { detectRecurring } from "@/lib/trends"
import { queryKeys, useAccounts, useProfile, useReserves, useSafeToSpendResult, useTransactions } from "@/lib/queries"
import { createReserve, removeReserve, saveProfile, updateReserve } from "@/lib/store"

function daysUntil(date: string, today = new Date()): number {
  const target = new Date(`${date}T00:00:00`)
  const start = new Date(today)
  start.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - start.getTime()) / 86_400_000)
}

export function SafeToSpendPage() {
  const queryClient = useQueryClient()
  const { data: result } = useSafeToSpendResult()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()

  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [confirmedReserve, setConfirmedReserve] = useState<string | null>(null)
  const [actualBalance, setActualBalance] = useState<string | null>(null)

  const invalidate = () => {
    for (const key of [queryKeys.reserves, queryKeys.profile]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  // Phase 3 — read-only balance check-in (never reconciliation; ROADMAP §6)
  const checkInBalance = useMutation({
    mutationFn: async () => {
      if (!profile || !result) return
      const actual = parseAmountInput(actualBalance ?? "")
      saveProfile({
        ...profile,
        lastBalanceCheckIn: new Date().toISOString().slice(0, 10),
        lastCheckedBalance: actual,
        lastCheckInDelta: actual - result.cashPosition,
      })
    },
    onSuccess: () => {
      setActualBalance(null)
      invalidate()
    },
  })

  const addReserve = useMutation({
    mutationFn: async (input?: { name: string; amount: number }) => {
      const finalName = input?.name ?? (name.trim() || "Reserve")
      const finalAmount = input?.amount ?? parseAmountInput(amount)
      createReserve({ name: finalName, amount: finalAmount, dueDate: dueDate || null })
    },
    onSuccess: () => {
      setName("")
      setAmount("")
      setDueDate("")
      invalidate()
    },
  })

  const saveConfirmed = useMutation({
    mutationFn: async () => {
      if (!profile) return
      saveProfile({ ...profile, taxReserveConfirmed: parseAmountInput(confirmedReserve ?? String(profile.taxReserveConfirmed)) })
    },
    onSuccess: invalidate,
  })

  const weeklyChange = useMemo(
    () => (profile ? stsWeeklyChange({ transactions, accounts, profile, reserves }) : null),
    [transactions, accounts, profile, reserves],
  )

  // §64 P1 — recurring reserve suggestions from detected monthly obligations
  const recurringSuggestions = useMemo(() => {
    const candidates = detectRecurring(transactions).filter((candidate) => candidate.direction === "MONEY_OUT")
    const activeNames = new Set(
      reserves.filter((reserve) => reserve.status === "ACTIVE").map((reserve) => reserve.name.toLowerCase()),
    )
    return candidates
      .filter((candidate) => !activeNames.has(candidate.description.toLowerCase()))
      .slice(0, 3)
  }, [transactions, reserves])

  // Phase 3 — AI reserve recommendations (§64 P2)
  const reserveRecommendations = useMemo(
    () => (profile ? recommendReserves({ transactions, accounts, profile, reserves }) : []),
    [transactions, accounts, profile, reserves],
  )

  const isLow = result?.confidence === "LOW_CONFIDENCE"
  const isMedium = result?.confidence === "MEDIUM_CONFIDENCE"

  if (!result || !profile) return null

  const activeReserves = reserves.filter((reserve) => reserve.status === "ACTIVE")
  const dueSoon = activeReserves
    .filter((reserve) => reserve.dueDate && daysUntil(reserve.dueDate) <= 7)
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))

  return (
    <div className="space-y-4 pb-8">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Home
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-xl tracking-tight">Safe To Spend</h1>
            <ConfidenceBadge status={result.confidence} />
          </div>

          <p className={`mt-3 text-4xl font-medium tracking-tight tabular-nums ${result.safeToSpend < 0 ? "text-destructive" : ""}`}>
            {(isLow || isMedium) && result.safeToSpend >= 0 && "~"}
            {formatRupiah(result.safeToSpend)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimasi dana yang tersedia setelah reserve yang diketahui — bukan saldo rekening.
          </p>

          {/* §55 — contextual weekly insight with reason breakdown */}
          {weeklyChange && weeklyChange.delta !== 0 && (
            <div className="mt-4 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed">
              <p className={`flex items-center gap-1.5 font-semibold ${weeklyChange.delta > 0 ? "money-in" : "text-foreground"}`}>
                {weeklyChange.delta > 0 ? (
                  <TrendingUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <TrendingDown className="size-3.5" aria-hidden="true" />
                )}
                {formatWeeklyChangeText(weeklyChange)}
              </p>
              {weeklyChange.reasons.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                  {weeklyChange.reasons.map((reason) => (
                    <li key={reason.label} className="flex justify-between gap-2">
                      <span>{reason.label}</span>
                      <span className="tabular-nums">
                        {reason.amount >= 0 ? "+" : "−"}
                        {formatRupiah(Math.abs(reason.amount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isLow && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-900">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Estimasi ini mungkin belum akurat
              </p>
              <ul className="mt-1.5 list-inside list-disc">
                {result.confidenceReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Link to="/settings" className="mt-2 inline-block font-semibold underline">
                Lengkapi di Pengaturan
              </Link>
            </div>
          )}
          {isMedium && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              <p className="font-semibold">Data mungkin belum lengkap</p>
              <ul className="mt-1.5 list-inside list-disc">
                {result.confidenceReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Link to="/transactions" search={{ filter: "review" }} className="mt-2 inline-block font-semibold underline">
                Review Transactions
              </Link>
            </div>
          )}

          {result.safeToSpend < 0 && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-900">
              <p className="font-semibold">Kewajiban yang direservasi melebihi kas yang tersedia sebesar {formatRupiah(-result.safeToSpend)}.</p>
            </div>
          )}

          {/* Fully explainable breakdown (§49) */}
          <div className="mt-5 border-t border-border/60 pt-4">
            {result.breakdown.map((line) => (
              <div key={line.label} className="flex items-center justify-between py-1.5 text-sm">
                <span className={line.amount < 0 ? "text-muted-foreground" : "font-medium"}>{line.label}</span>
                <span className={`tabular-nums ${line.amount < 0 ? "text-muted-foreground" : "font-semibold"}`}>
                  {line.amount < 0 ? `− ${formatRupiah(-line.amount)}` : formatRupiah(line.amount)}
                </span>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2.5 text-sm font-semibold">
              <span>Safe To Spend</span>
              <span className={`tabular-nums ${result.safeToSpend < 0 ? "text-destructive" : ""}`}>{formatRupiah(result.safeToSpend)}</span>
            </div>
          </div>

          {/* Phase 3 — forecast entry point (§61) */}
          <Link
            to="/forecast"
            className="mt-4 flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary"
          >
            Lihat Proyeksi Safe To Spend
            <TrendingUp className="size-4" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>

      {/* Phase 3 — balance check-in (read-only, ROADMAP §6: not a reconciliation engine) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <ClipboardCheck className="size-4 text-primary" aria-hidden="true" />
            Check-in Saldo Aktual
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Bandingkan saldo asli Anda dengan posisi kas yang dihitung sistem — untuk menjaga akurasi Safe To Spend.
          </p>

          {profile.lastBalanceCheckIn && profile.lastCheckedBalance !== null && (
            <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs">
              <p className="font-medium">
                Terakhir dicek {formatDateShort(profile.lastBalanceCheckIn)}: {formatRupiah(profile.lastCheckedBalance)}
              </p>
              {profile.lastCheckInDelta !== null && profile.lastCheckInDelta !== 0 && (
                <p className="mt-0.5 text-muted-foreground">
                  Selisih saat itu {profile.lastCheckInDelta > 0 ? "+" : "−"}
                  {formatRupiah(Math.abs(profile.lastCheckInDelta))}{" "}
                  {profile.lastCheckInDelta > 0
                    ? "(kemungkinan ada pemasukan yang belum dicatat)"
                    : "(kemungkinan ada pengeluaran yang belum dicatat)"}
                </p>
              )}
              {profile.lastCheckInDelta === 0 && <p className="mt-0.5 money-in">Cocok dengan catatan sistem.</p>}
            </div>
          )}

          <div className="mt-3">
            <TextField
              type="amount"
              prefix="Rp"
              placeholder={formatRupiah(result.cashPosition)}
              value={actualBalance ?? ""}
              onChange={setActualBalance}
              hint="Masukkan total saldo dari rekening & kas Anda"
            />
            <Button className="mt-2 w-full" onClick={() => checkInBalance.mutate()} disabled={parseAmountInput(actualBalance ?? "") <= 0}>
              Cek
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tax reserve: recommended vs confirmed (§44, §46.6) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <PiggyBank className="size-4 text-primary" aria-hidden="true" />
            Dana Pajak
          </h2>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Disarankan (dari tax engine)</span>
              <span className="font-medium tabular-nums">{formatRupiah(result.recommendedTaxReserve)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sudah Anda sisihkan</span>
              <TextField
                type="amount"
                prefix="Rp"
                className="w-40"
                inputClassName="text-right text-sm"
                value={confirmedReserve ?? formatRupiah(profile.taxReserveConfirmed)}
                onChange={(value) => {
                  setConfirmedReserve(value)
                }}
                onBlur={() => saveConfirmed.mutate()}
              />
            </div>
            <div className="flex justify-between border-t border-border/60 pt-2">
              <span className="font-medium">Masih perlu disisihkan</span>
              <span className="font-semibold tabular-nums">
                {formatRupiah(Math.max(0, result.recommendedTaxReserve - profile.taxReserveConfirmed))}
              </span>
            </div>
          </div>
          <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            Reserve adalah <strong>alokasi virtual</strong> — sistem tidak memindahkan uang Anda. Gunakan angka ini sebagai
            pengingat berapa yang sebaiknya tidak dibelanjakan.
          </p>
        </CardContent>
      </Card>

      {/* Other reserves (§47) with due dates (§64 P1) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg tracking-tight">Reserve Lainnya</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Dana yang sudah diketahui akan dibutuhkan (payroll, sewa, bayar supplier) — tidak dianggap tersedia.
          </p>

          {dueSoon.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                Pengingat jatuh tempo
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
                {dueSoon.map((reserve) => {
                  const days = daysUntil(reserve.dueDate!)
                  return (
                    <li key={reserve.id} className="flex justify-between gap-2">
                      <span>
                        {reserve.name} — {days < 0 ? `terlewat ${-days} hari` : days === 0 ? "hari ini" : `${days} hari lagi`}
                      </span>
                      <span className="tabular-nums">{formatRupiah(reserve.amount)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {recurringSuggestions.length > 0 && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Repeat className="size-3.5" aria-hidden="true" />
                Terlihat berulang setiap bulan — buat reserve?
              </p>
              <div className="mt-2 space-y-1.5">
                {recurringSuggestions.map((candidate) => (
                  <div key={candidate.description} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">
                      {candidate.description} · ~{formatRupiah(candidate.amount)} ({candidate.occurrences}×)
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addReserve.mutate({ name: candidate.description, amount: candidate.amount })}
                    >
                      Buat Reserve
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase 3 — AI reserve recommendations (§64 P2, on-device heuristics) */}
          {reserveRecommendations.length > 0 && (
            <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Rekomendasi reserve
              </p>
              <div className="mt-2 space-y-1.5">
                {reserveRecommendations.map((recommendation) => (
                  <div key={recommendation.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{recommendation.name}</span> — {formatRupiah(recommendation.amount)}/bulan
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addReserve.mutate({ name: recommendation.name, amount: recommendation.amount })}
                      >
                        Buat Reserve
                      </Button>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{recommendation.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeReserves.length > 0 && (
            <div className="mt-3 divide-y divide-border/40">
              {activeReserves.map((reserve) => (
                <div key={reserve.id} className="flex items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{reserve.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {reserve.dueDate ? `Jatuh tempo ${formatDateShort(reserve.dueDate)}` : "Tanpa jatuh tempo"}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatRupiah(reserve.amount)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      updateReserve(reserve.id, { status: "USED" })
                      invalidate()
                    }}
                    className="rounded-full px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"
                  >
                    Terpakai
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeReserve(reserve.id)
                      invalidate()
                    }}
                    className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Hapus reserve ${reserve.name}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TextField label="Nama" value={name} onChange={setName} placeholder="Mis. Payroll" />
            <TextField label="Nominal" type="amount" prefix="Rp" value={amount} onChange={setAmount} placeholder="Rp0" />
          </div>
          <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-2">
            <DateField label="Jatuh tempo (opsional)" value={dueDate} onChange={setDueDate} />
            <Button className="h-[50px]" onClick={() => addReserve.mutate()} disabled={parseAmountInput(amount) <= 0}>
              <Plus aria-hidden="true" />
              Tambah Reserve
            </Button>
          </div>

          {reserves.some((reserve) => reserve.status === "USED") && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <p className="text-xs font-medium text-muted-foreground">Riwayat terpakai</p>
              {reserves
                .filter((reserve) => reserve.status === "USED")
                .map((reserve) => (
                  <div key={reserve.id} className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Badge className="bg-[color-mix(in_oklab,var(--mint)_16%,white)] text-[var(--mint)]">USED</Badge>
                      {reserve.name}
                    </span>
                    <span className="tabular-nums">{formatRupiah(reserve.amount)}</span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

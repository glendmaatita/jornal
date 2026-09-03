import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"

import { AlertTriangle, ArrowRight, CalendarClock, PiggyBank, Sparkles } from "lucide-react"

import { ConfidenceBadge, TransactionItem } from "@/components/transaction-item"
import { PeriodSelector } from "@/components/period-selector"
import { inPeriod, resolvePeriod, type PeriodPreset } from "@/lib/period"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button-variants"
import { Card, CardContent } from "@/components/ui/card"
import { formatRupiah, formatSignedRupiah, todayIsoDate } from "@/lib/format"
import { useAccounts, useProfile, useReserves, useTransactions } from "@/lib/queries"
import { computeSafeToSpend } from "@/lib/safe-to-spend"
import { computeTaxOverview, businessExpenseYTD, revenueYTD, taxPaidYTD } from "@/lib/tax"
import { monthsElapsedThisYear } from "@/lib/format"
export function HomePage() {
  const [preset, setPreset] = useState<PeriodPreset>("month")
  const [custom, setCustom] = useState(() => ({ start: todayIsoDate(), end: todayIsoDate() }))

  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()

  const period = useMemo(() => resolvePeriod(preset, custom), [preset, custom])
  const periodTransactions = useMemo(
    () => transactions.filter((transaction) => inPeriod(transaction.transactionDate, period) && transaction.classification !== "INTERNAL_TRANSFER"),
    [transactions, period],
  )
  const recent = useMemo(() => [...transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [transactions])
  const needsReview = useMemo(() => transactions.filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW"), [transactions])

  // §64 P1 — reserve due reminders on Home
  const dueReserves = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return reserves
      .filter((reserve) => reserve.status === "ACTIVE" && reserve.dueDate)
      .map((reserve) => ({
        reserve,
        days: Math.round((new Date(`${reserve.dueDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000),
      }))
      .filter(({ days }) => days <= 7)
      .sort((a, b) => a.days - b.days)
  }, [reserves])

  const moneyIn = periodTransactions.filter((t) => t.direction === "MONEY_IN").reduce((sum, t) => sum + t.amount, 0)
  const moneyOut = periodTransactions.filter((t) => t.direction === "MONEY_OUT").reduce((sum, t) => sum + t.amount, 0)
  const netCashFlow = moneyIn - moneyOut

  const revenue = periodTransactions.filter((t) => t.classification === "REVENUE").reduce((sum, t) => sum + t.amount, 0)
  const businessExpense = periodTransactions.filter((t) => t.classification === "OPERATING_EXPENSE").reduce((sum, t) => sum + t.amount, 0)

  const safeToSpend = useMemo(
    () =>
      profile
        ? computeSafeToSpend({ transactions, accounts, profile, reserves })
        : null,
    [transactions, accounts, profile, reserves],
  )

  const taxReserve = useMemo(() => {
    if (!profile) return null
    return computeTaxOverview({
      scheme: profile.taxScheme,
      businessType: profile.businessType,
      onDate: todayIsoDate(),
      revenueYTD: revenueYTD(transactions, profile.fiscalYear),
      businessExpenseYTD: businessExpenseYTD(transactions, profile.fiscalYear),
      taxPaid: taxPaidYTD(transactions, profile.fiscalYear),
      monthsElapsed: monthsElapsedThisYear(),
    })
  }, [profile, transactions])

  if (!profile) return null

  return (
    <div className="space-y-4 pb-8">
      <PeriodSelector preset={preset} custom={custom} onChange={setPreset} onCustomChange={setCustom} />

      {/* Safe To Spend — the core differentiator (§46, §48), teofin gradient card */}
      {safeToSpend && (
        <Link to="/safe-to-spend" className="block" aria-label="Lihat rincian Safe To Spend">
          <Card
            className="border border-[#e2a9cb]/60 text-white shadow-lg transition-transform active:scale-[0.99]"
            style={{ background: "var(--gradient-card)", backdropFilter: "blur(11px)" }}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[2px] text-white/75 uppercase">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    Safe To Spend
                  </p>
                  <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums">
                    {safeToSpend.confidence !== "HIGH_CONFIDENCE" && "~"}
                    {formatRupiah(safeToSpend.safeToSpend)}
                  </p>
                  <p className="mt-1 text-xs text-white/75">Estimasi dana yang aman digunakan hari ini</p>
                </div>
                <ArrowRight className="mt-1 size-5 shrink-0 text-white/60" aria-hidden="true" />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/20 pt-3.5 text-xs sm:grid-cols-2">
                <div>
                  <p className="text-white/60">Kas tersedia</p>
                  <p className="mt-0.5 font-semibold tabular-nums">{formatRupiah(safeToSpend.cashPosition)}</p>
                </div>
                <div>
                  <p className="text-white/60">Direservasi</p>
                  <p className="mt-0.5 font-semibold tabular-nums">
                    {formatRupiah(safeToSpend.recommendedTaxReserve + safeToSpend.otherReservedFunds)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Reserve due reminders (§64 P1) */}
      {dueReserves.length > 0 && (
        <Link to="/safe-to-spend" className="block">
          <Card className="border-primary/30 bg-primary/5 transition-transform active:scale-[0.99]">
            <CardContent className="p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                <CalendarClock className="size-3.5" aria-hidden="true" />
                Pengingat reserve
              </p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {dueReserves.slice(0, 3).map(({ reserve, days }) => (
                  <li key={reserve.id} className="flex justify-between gap-2">
                    <span>
                      {reserve.name} — {days < 0 ? `terlewat ${-days} hari` : days === 0 ? "jatuh tempo hari ini" : `jatuh tempo ${days} hari lagi`}
                    </span>
                    <span className="tabular-nums">{formatRupiah(reserve.amount)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Needs attention (§10.7) */}
      {needsReview.length > 0 && (
        <Link to="/transactions" search={{ filter: "review" }} className="block">
          <Card className="border-amber-300/70 bg-amber-50 transition-transform active:scale-[0.99]">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-100">
                <AlertTriangle className="size-4 text-amber-700" aria-hidden="true" />
              </span>
              <p className="flex-1 text-sm font-medium text-amber-900">
                {needsReview.length} transaksi membutuhkan konfirmasi
              </p>
              <ArrowRight className="size-4 text-amber-700" aria-hidden="true" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Cash summary (§10.2) */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg tracking-tight">{period.label}</h2>
            {safeToSpend && <ConfidenceBadge status={safeToSpend.confidence} />}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-secondary/60 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Uang Masuk</p>
              <p className="mt-1 text-sm font-semibold money-in tabular-nums">{formatRupiah(moneyIn)}</p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Uang Keluar</p>
              <p className="mt-1 text-sm font-semibold tabular-nums">{formatRupiah(moneyOut)}</p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-3">
              <p className="text-[11px] font-medium text-muted-foreground">Net Cash Flow</p>
              <p className={cnNet(netCashFlow, "mt-1 text-sm font-semibold tabular-nums")}>{formatSignedRupiah(netCashFlow)}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border/60 pt-3.5 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Omzet</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatRupiah(revenue)}</p>
              <p className="text-[11px] text-muted-foreground">bukan semua uang masuk adalah omzet</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Pengeluaran Bisnis</p>
              <p className="mt-0.5 font-semibold tabular-nums">{formatRupiah(businessExpense)}</p>
              <p className="text-[11px] text-muted-foreground">bukan semua uang keluar adalah biaya</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tax reserve widget (§10.5) */}
      {taxReserve && (
        <Link to="/tax" className="block">
          <Card className="transition-transform active:scale-[0.99]">
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10">
                <PiggyBank className="size-5 text-primary" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Estimasi Dana Pajak</p>
                <p className="font-semibold tabular-nums">{formatRupiah(taxReserve.recommendedTaxReserve)}</p>
                <p className="text-[11px] text-muted-foreground">Disarankan untuk disisihkan — alokasi virtual, bukan transfer uang</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Recent transactions (§10.6) */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <h2 className="text-lg tracking-tight">Transaksi Terbaru</h2>
            <Badge>{transactions.length} total</Badge>
          </div>
          {recent.length > 0 ? (
            <div className="divide-y divide-border/40">
              {recent.map((transaction) => (
                <TransactionItem key={transaction.id} transaction={transaction} />
              ))}
            </div>
          ) : (
            <div className="px-2 py-8 text-center">
              <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
              <Link to="/add" className={buttonVariants({ size: "sm", className: "mt-3" })}>
                Catat transaksi pertama
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function cnNet(value: number, base: string) {
  return `${base} ${value >= 0 ? "money-in" : "text-destructive"}`
}

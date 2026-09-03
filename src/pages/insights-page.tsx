import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Info, Lightbulb, Repeat, Trash2, TrendingDown, TrendingUp } from "lucide-react"

import { BarChart, DualBarChart, LineChart } from "@/components/charts"
import { PeriodSelector } from "@/components/period-selector"
import { inPeriod, resolvePeriod, type PeriodPreset } from "@/lib/period"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ALL_CATEGORIES } from "@/lib/categories"
import { classifyTransaction } from "@/lib/classification"
import { nextOccurrenceAfter } from "@/lib/forecast"
import { formatRupiah, formatCompactRupiah, formatShortDateLabel, formatDateShort, todayIsoDate } from "@/lib/format"
import { stsHistory } from "@/lib/history"
import { queryKeys, useAccounts, useProfile, useRecurringRules, useReserves, useTransactions } from "@/lib/queries"
import { createRecurringRule, deleteRecurringRule, updateRecurringRule } from "@/lib/store"
import { detectRecurring, generateInsights, monthlyTrends, type RecurringCandidate } from "@/lib/trends"

export function InsightsPage() {
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()
  const [preset, setPreset] = useState<PeriodPreset>("month")
  const [custom, setCustom] = useState(() => ({ start: todayIsoDate(), end: todayIsoDate() }))

  const period = useMemo(() => resolvePeriod(preset, custom), [preset, custom])
  const periodTransactions = useMemo(
    () => transactions.filter((transaction) => inPeriod(transaction.transactionDate, period)),
    [transactions, period],
  )

  const revenue = periodTransactions
    .filter((transaction) => transaction.classification === "REVENUE")
    .reduce((sum, transaction) => sum + transaction.amount, 0)
  const businessExpense = periodTransactions
    .filter((transaction) => transaction.classification === "OPERATING_EXPENSE")
    .reduce((sum, transaction) => sum + transaction.amount, 0)
  const cashSurplus = revenue - businessExpense

  const trends = useMemo(() => monthlyTrends(transactions, 6), [transactions])
  const insights = useMemo(() => generateInsights(transactions, 6), [transactions])

  const stsSeries = useMemo(() => {
    if (!profile) return []
    const history = stsHistory({ transactions, accounts, profile, reserves }, 30)
    return history.map((snapshot) => ({ label: formatShortDateLabel(snapshot.date), value: snapshot.safeToSpend }))
  }, [transactions, accounts, profile, reserves])

  const stsDeltaMonth = useMemo(() => {
    if (!profile) return null
    const history = stsHistory({ transactions, accounts, profile, reserves }, 30)
    if (history.length === 0) return null
    const current = history[history.length - 1]
    const monthStart = history.find((snapshot) => snapshot.date >= current.date.slice(0, 7) + "-01") ?? current
    return { delta: current.safeToSpend - monthStart.safeToSpend, current: current.safeToSpend }
  }, [transactions, accounts, profile, reserves])

  const expenseBreakdown = useMemo(() => {
    const byCategory = new Map<string, number>()
    for (const transaction of periodTransactions) {
      if (transaction.classification !== "OPERATING_EXPENSE") continue
      const name = ALL_CATEGORIES.find((category) => category.id === transaction.categoryId)?.name ?? "Tanpa Kategori"
      byCategory.set(name, (byCategory.get(name) ?? 0) + transaction.amount)
    }
    const total = [...byCategory.values()].reduce((sum, value) => sum + value, 0)
    return [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({ name, amount, percent: total > 0 ? Math.round((amount / total) * 100) : 0 }))
  }, [periodTransactions])

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="text-xl tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">Apa yang sedang terjadi dengan bisnis Anda?</p>
      </div>

      {/* Automated financial insights (§39) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <Lightbulb className="size-4 text-primary" aria-hidden="true" />
            Insight Otomatis
          </h2>
          {!insights.sufficientData ? (
            <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-sm leading-relaxed text-muted-foreground">
              Butuh minimal 3 bulan histori transaksi sebelum insight otomatis ditampilkan — agar angkanya tidak menyesatkan.
            </p>
          ) : insights.insights.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Semua terlihat stabil bulan ini.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {insights.insights.map((insight) => (
                <li
                  key={insight.id}
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm leading-relaxed ${
                    insight.severity === "warning"
                      ? "bg-amber-50 text-amber-900"
                      : insight.severity === "positive"
                        ? "bg-[color-mix(in_oklab,var(--mint)_10%,white)] text-[var(--main-dark)]"
                        : "bg-secondary/60"
                  }`}
                >
                  {insight.severity === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  ) : insight.severity === "positive" ? (
                    <TrendingUp className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  )}
                  {insight.text}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PeriodSelector preset={preset} custom={custom} onChange={setPreset} onCustomChange={setCustom} />

      {/* Monthly overview (§34) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{period.label}</h2>
          <div className="mt-3 space-y-3">
            <OverviewRow label="Revenue" value={formatRupiah(revenue)} />
            <OverviewRow label="Business Expense" value={formatRupiah(businessExpense)} />
            <OverviewRow label="Cash Surplus" value={formatRupiah(cashSurplus)} strong />
          </div>
        </CardContent>
      </Card>

      {/* Trends (§36–38) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg tracking-tight">Tren Omzet — 6 bulan</h2>
          <div className="mt-3">
            <BarChart data={trends.map((point) => ({ label: point.label, value: point.revenue }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg tracking-tight">Tren Pengeluaran Bisnis — 6 bulan</h2>
          <div className="mt-3">
            <BarChart data={trends.map((point) => ({ label: point.label, value: point.businessExpense }))} color="#b45309" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg tracking-tight">Tren Cashflow — 6 bulan</h2>
          <div className="mt-3">
            <DualBarChart data={trends.map((point) => ({ label: point.label, in: point.moneyIn, out: point.moneyOut }))} />
          </div>
        </CardContent>
      </Card>

      {/* Safe To Spend trend (§60) */}
      {stsSeries.length >= 2 && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg tracking-tight">Safe To Spend — 30 hari</h2>
              {stsDeltaMonth && (
                <span className={`flex items-center gap-1 text-xs font-medium ${stsDeltaMonth.delta >= 0 ? "money-in" : "text-destructive"}`}>
                  {stsDeltaMonth.delta >= 0 ? (
                    <TrendingUp className="size-3.5" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="size-3.5" aria-hidden="true" />
                  )}
                  {formatCompactRupiah(Math.abs(stsDeltaMonth.delta))} bulan ini
                </span>
              )}
            </div>
            <div className="mt-3">
              <LineChart data={stsSeries} />
            </div>
            <Link to="/safe-to-spend" className="mt-2 inline-block text-xs font-medium text-primary underline">
              Lihat rincian Safe To Spend
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Expense breakdown (§35) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="text-lg tracking-tight">Pengeluaran Bisnis</h2>
          {expenseBreakdown.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Belum ada pengeluaran bisnis pada periode ini.</p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {expenseBreakdown.map((item) => (
                <div key={item.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.name}</span>
                    <span className="tabular-nums">
                      {formatCompactRupiah(item.amount)} <span className="text-muted-foreground">· {item.percent}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${item.percent}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <RecurringAutomationCard />
    </div>
  )
}

// ── §30 Phase 3 — recurring transactions: detection → automation (confirmation-gated) ──

function RecurringAutomationCard() {
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()
  const { data: rules = [] } = useRecurringRules()

  const candidates = useMemo(() => {
    const automated = new Set(rules.map((rule) => rule.description.toLowerCase()))
    return detectRecurring(transactions).filter((candidate) => !automated.has(candidate.description.toLowerCase())).slice(0, 3)
  }, [transactions, rules])

  const enableAutomation = (candidate: RecurringCandidate) => {
    const confirmed = window.confirm(
      `Aktifkan otomatis untuk "${candidate.description}"?\n\n` +
        `Sistem akan membuat transaksi ${candidate.direction === "MONEY_IN" ? "pemasukan" : "pengeluaran"} sebesar ~${formatRupiah(candidate.amount)} ` +
        `setiap bulan secara otomatis (transaksi pertama pada tanggal berikutnya). ` +
        `Anda bisa menjeda atau menghapusnya kapan saja di halaman ini.`,
    )
    if (!confirmed) return
    const today = todayIsoDate()
    const suggestion = classifyTransaction(candidate.description, candidate.direction)
    createRecurringRule({
      direction: candidate.direction,
      description: candidate.description,
      amount: candidate.amount,
      categoryId: suggestion.categoryId,
      classification: suggestion.classification,
      paymentMethod: "",
      accountId: null,
      dayOfMonth: Math.min(Math.max(Number(candidate.lastDate.slice(8, 10)), 1), 28),
      nextRun: nextOccurrenceAfter(candidate.lastDate, today),
      autoCreate: true,
    })
    void queryClient.invalidateQueries({ queryKey: queryKeys.recurringRules })
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="flex items-center gap-2 text-lg tracking-tight">
          <Repeat className="size-4 text-primary" aria-hidden="true" />
          Transaksi Berulang
        </h2>

        {candidates.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">Sistem mendeteksi pola berulang — aktifkan otomatisasi jika ingin:</p>
            {candidates.map((candidate) => (
              <div key={candidate.description} className="flex items-center gap-2 rounded-xl bg-secondary/40 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{candidate.description}</p>
                  <p className="text-xs text-muted-foreground">
                    ~{formatRupiah(candidate.amount)} · {candidate.occurrences}× dalam {candidate.months.length} bulan
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => enableAutomation(candidate)}>
                  Aktifkan Otomatis
                </Button>
              </div>
            ))}
          </div>
        )}

        {rules.length > 0 ? (
          <div className="mt-3 divide-y divide-border/40">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {rule.description}{" "}
                    {rule.autoCreate ? (
                      <Badge className="bg-[color-mix(in_oklab,var(--mint)_16%,white)] text-[var(--mint)]">aktif</Badge>
                    ) : (
                      <Badge>jeda</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ~{formatRupiah(rule.amount)} · berikutnya {formatDateShort(rule.nextRun)} · {rule.createdCount}× dibuat
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    updateRecurringRule(rule.id, { autoCreate: !rule.autoCreate })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.recurringRules })
                  }}
                  className="rounded-full px-2 py-1 text-[11px] font-medium text-primary hover:bg-accent"
                >
                  {rule.autoCreate ? "Jeda" : "Lanjutkan"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteRecurringRule(rule.id)
                    void queryClient.invalidateQueries({ queryKey: queryKeys.recurringRules })
                  }}
                  className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Hapus otomatisasi ${rule.description}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          candidates.length === 0 && (
            <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs text-muted-foreground">
              Belum ada pola berulang. Setelah Anda mencatat transaksi yang sama beberapa bulan berturut-turut, pola akan
              muncul di sini.
            </p>
          )
        )}
      </CardContent>
    </Card>
  )
}

function OverviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-border/60 pt-3" : ""}`}>
      <span className={strong ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-lg font-semibold" : "font-medium"}`}>{value}</span>
    </div>
  )
}

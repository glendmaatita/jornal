import { useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ArrowLeft, CalendarClock, FlaskConical, ShieldCheck } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { formatRupiah, formatDateShort, formatNumberInput, parseAmountInput } from "@/lib/format"
import { computeForecast, detectUpcomingObligations, EMPTY_SCENARIO, type ScenarioInput } from "@/lib/forecast"
import { useAccounts, useProfile, useReserves, useTransactions } from "@/lib/queries"
import { cn } from "@/lib/utils"

const HORIZONS = [
  { days: 14, label: "14 hari" },
  { days: 30, label: "30 hari" },
  { days: 60, label: "60 hari" },
]

export function ForecastPage() {
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()

  const [horizonDays, setHorizonDays] = useState(30)
  const [scenario, setScenario] = useState<ScenarioInput>(EMPTY_SCENARIO)

  const input = useMemo(
    () => (profile ? { transactions, accounts, profile, reserves } : null),
    [transactions, accounts, profile, reserves],
  )

  const baseline = useMemo(
    () => (input ? computeForecast(input, { horizonDays }) : null),
    [input, horizonDays],
  )
  const withScenario = useMemo(() => {
    const active =
      scenario.extraIncome > 0 || scenario.extraExpense > 0 || scenario.extraReserve > 0
    return input && active ? computeForecast(input, { horizonDays, scenario }) : null
  }, [input, horizonDays, scenario])

  const obligations = useMemo(
    () => (input ? detectUpcomingObligations(input, horizonDays) : []),
    [input, horizonDays],
  )

  if (!input || !baseline) return null

  const scenarioDelta = withScenario ? withScenario.projectedSafeToSpend - baseline.projectedSafeToSpend : 0

  return (
    <div className="space-y-4 pb-8">
      <Link to="/safe-to-spend" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Safe To Spend
      </Link>

      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl tracking-tight">Proyeksi Safe To Spend</h1>
          <p className="text-xs text-muted-foreground">Estimasi ke depan — bukan jaminan (§61, §63).</p>
        </div>
        <div className="flex gap-1">
          {HORIZONS.map((horizon) => (
            <button
              key={horizon.days}
              type="button"
              onClick={() => setHorizonDays(horizon.days)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                horizonDays === horizon.days
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {horizon.label}
            </button>
          ))}
        </div>
      </div>

      {/* Projection (§61 formula) */}
      <Card>
        <CardContent className="p-6">
          <p className="text-xs text-muted-foreground">Proyeksi Safe To Spend ({horizonDays} hari)</p>
          <p
            className={cn(
              "mt-2 text-4xl font-medium tracking-tight tabular-nums",
              baseline.projectedSafeToSpend < 0 && "text-destructive",
            )}
          >
            ~{formatRupiah(baseline.projectedSafeToSpend)}
          </p>

          <div className="mt-5 space-y-1.5 border-t border-border/60 pt-4 text-sm">
            <Row label="Posisi kas hari ini" value={formatRupiah(baseline.cashPosition)} />
            <Row label={`Pemasukan diharapkan (${baseline.flows.filter((flow) => flow.direction === "MONEY_IN").length})`} value={`+ ${formatRupiah(baseline.expectedIn)}`} />
            <Row label={`Pengeluaran diharapkan (${baseline.flows.filter((flow) => flow.direction === "MONEY_OUT").length})`} value={`− ${formatRupiah(baseline.expectedOut)}`} />
            <Row label="Proyeksi dana pajak" value={`− ${formatRupiah(baseline.projectedTaxReserve)}`} />
            <Row label="Kewajiban tereservasi" value={`− ${formatRupiah(baseline.reservedObligations)}`} />
            <div className="flex items-center justify-between border-t border-border/60 pt-2.5 font-semibold">
              <span>Proyeksi Safe To Spend</span>
              <span className={cn("tabular-nums", baseline.projectedSafeToSpend < 0 && "text-destructive")}>
                {formatRupiah(baseline.projectedSafeToSpend)}
              </span>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">Safe To Spend hari ini: {formatRupiah(baseline.currentSafeToSpend)}</p>
          </div>

          {/* Expected flows (explainability, §49 spirit) */}
          {baseline.flows.length > 0 && (
            <div className="mt-4 divide-y divide-border/40 rounded-xl bg-secondary/40 p-3">
              <p className="pb-2 text-xs font-semibold text-muted-foreground">Asumsi arus kas</p>
              {baseline.flows.map((flow) => (
                <div key={flow.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">
                    {formatDateShort(flow.expectedDate)} · {flow.label}
                  </span>
                  <span className={cn("shrink-0 tabular-nums", flow.direction === "MONEY_IN" ? "money-in" : "")}>
                    {flow.direction === "MONEY_IN" ? "+" : "−"}
                    {formatRupiah(flow.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <ul className="mt-4 list-inside list-disc space-y-1 rounded-xl bg-secondary/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {baseline.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Upcoming obligations (§64 P2 — automatic detection) */}
      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Kewajiban Mendatang
          </h2>
          {obligations.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Tidak ada kewajiban terdeteksi dalam {horizonDays} hari ke depan.
            </p>
          ) : (
            <div className="mt-3 divide-y divide-border/40">
              {obligations.map((obligation) => (
                <div key={obligation.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-xs text-muted-foreground">{formatDateShort(obligation.date)}</span>{" "}
                    {obligation.label}
                  </span>
                  <span className="shrink-0 tabular-nums">{formatRupiah(obligation.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenario simulation (§64 P2) — transient, never saved */}
      <Card>
        <CardContent className="p-5">
          <h2 className="flex items-center gap-2 text-lg tracking-tight">
            <FlaskConical className="size-4 text-primary" aria-hidden="true" />
            Simulasi Skenario
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Uji "bagaimana jika" — angka hanya untuk simulasi ini dan tidak disimpan.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TextField
              label="Pemasukan ekstra"
              type="amount"
              prefix="Rp"
              value={scenario.extraIncome ? formatNumberInput(scenario.extraIncome) : ""}
              onChange={(value) => setScenario((current) => ({ ...current, extraIncome: parseAmountInput(value) }))}
            />
            <TextField
              label="Pengeluaran ekstra"
              type="amount"
              prefix="Rp"
              value={scenario.extraExpense ? formatNumberInput(scenario.extraExpense) : ""}
              onChange={(value) => setScenario((current) => ({ ...current, extraExpense: parseAmountInput(value) }))}
            />
            <TextField
              label="Reserve baru"
              type="amount"
              prefix="Rp"
              value={scenario.extraReserve ? formatNumberInput(scenario.extraReserve) : ""}
              onChange={(value) => setScenario((current) => ({ ...current, extraReserve: parseAmountInput(value) }))}
            />
          </div>

          {withScenario && (
            <div className="mt-4 rounded-xl bg-primary/10 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Proyeksi dengan skenario</span>
                <span className="font-semibold tabular-nums">~{formatRupiah(withScenario.projectedSafeToSpend)}</span>
              </div>
              <p className={cn("mt-1 text-xs font-medium", scenarioDelta >= 0 ? "money-in" : "text-destructive")}>
                {scenarioDelta >= 0 ? "+" : "−"}
                {formatRupiah(Math.abs(scenarioDelta))} dibanding proyeksi tanpa skenario
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Proyeksi dihitung konservatif: pemasukan diharapkan sudah dipotong estimasi pajak, dan kewajiban yang belum
        selesai tetap dianggap tereservasi. Sistem tidak mengetahui tagihan yang belum Anda catat.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}

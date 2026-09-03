import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, Info } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { formatRupiah, parseAmountInput, todayIsoDate } from "@/lib/format"
import { queryKeys, useProfile, useTransactions } from "@/lib/queries"
import { businessExpenseYTD, computeTaxOverview, revenueYTD, taxPaidYTD, taxAlerts } from "@/lib/tax"
import { monthsElapsedThisYear } from "@/lib/format"
import { saveProfile } from "@/lib/store"

export function TaxPage() {
  const queryClient = useQueryClient()
  const { data: transactions = [] } = useTransactions()
  const { data: profile } = useProfile()
  const [confirmed, setConfirmed] = useState<string | null>(null)

  const overview = useMemo(() => {
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

  const alerts = useMemo(
    () => (profile ? taxAlerts(profile, transactions) : []),
    [profile, transactions],
  )

  if (!profile || !overview) return null

  const alreadyReserved = profile.taxReserveConfirmed
  const additionalNeeded = Math.max(0, overview.recommendedTaxReserve - alreadyReserved)

  const saveConfirmed = () => {
    saveProfile({ ...profile, taxReserveConfirmed: parseAmountInput(confirmed ?? String(alreadyReserved)) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile })
  }

  return (
    <div className="space-y-4 pb-8">
      <Card>
        <CardContent className="p-6">
          <h1 className="text-xl tracking-tight">Tax Overview {profile.fiscalYear}</h1>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Revenue YTD" value={formatRupiah(overview.revenueYTD)} />
            <Row label="Proyeksi Omzet Setahun" value={formatRupiah(overview.projectedAnnualRevenue)} />
            <Row label="Estimasi Pajak" value={formatRupiah(overview.estimatedTax)} strong />
            <Row label="Pajak Terbayar" value={formatRupiah(overview.taxPaid)} />
            <Row label="Sisa Estimasi Pajak" value={formatRupiah(overview.remainingEstimatedTax)} strong />
          </dl>
          <div className="mt-4 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {overview.explanation}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Proactive tax awareness (§5.1 #9 — ROADMAP Phase 2 D) */}
      {alerts.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="text-lg tracking-tight">Peringatan Pajak</h2>
            <ul className="mt-3 space-y-2">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm leading-relaxed ${
                    alert.level === "warning" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"
                  }`}
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {alert.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
          <h2 className="text-lg tracking-tight">Tax Reserve</h2>
          <p className="mt-1 text-xs text-muted-foreground">Rekomendasi dana pajak yang sebaiknya disisihkan.</p>

          <div className="mt-4 rounded-xl bg-primary/10 p-4">
            <p className="text-xs text-muted-foreground">Recommended Tax Reserve</p>
            <p className="mt-1 text-3xl font-medium tabular-nums text-primary">
              {formatRupiah(overview.recommendedTaxReserve)}
            </p>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex flex-col items-end justify-between gap-1">
              <span className="text-muted-foreground">Already Reserved</span>
              <TextField
                type="amount"
                prefix="Rp"
                className="w-44"
                inputClassName="text-right text-sm"
                value={confirmed ?? formatRupiah(alreadyReserved)}
                onChange={(value) => setConfirmed(value)}
                onBlur={saveConfirmed}
              />
            </div>
            <div className="flex justify-between border-t border-border/60 pt-2">
              <span className="font-medium">Additional Reserve Needed</span>
              <span className="font-semibold tabular-nums">{formatRupiah(additionalNeeded)}</span>
            </div>
          </div>

          <p className="mt-4 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            Reserve adalah <strong>alokasi virtual</strong> — bukan transfer uang nyata. Angka ini otomatis ikut ketika Anda
            mencatat transaksi baru.
          </p>
        </CardContent>
      </Card>

      {profile.taxScheme === "NOT_CALCULATED" && (
        <Card className="border-amber-300/70 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900">
            Skema pajak belum diatur sehingga estimasi tidak bisa dihitung.{" "}
            <Link to="/settings" className="font-semibold underline">
              Atur di Pengaturan
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? "border-t border-border/60 pt-3" : ""}`}>
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "text-base font-semibold" : ""}`}>{value}</dd>
    </div>
  )
}

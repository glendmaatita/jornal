import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import { faCircleInfo } from "@fortawesome/free-solid-svg-icons/faCircleInfo"
import { faPiggyBank } from "@fortawesome/free-solid-svg-icons/faPiggyBank"
import { faScaleBalanced } from "@fortawesome/free-solid-svg-icons/faScaleBalanced"
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons/faTriangleExclamation"

import { Card, CardContent } from "@/components/ui/card"
import { PageLoading } from "@/components/loading-screen"
import { TaxCompliancePanel } from "@/components/tax/tax-compliance-panel"
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
      taxPaid: taxPaidYTD(transactions, profile.fiscalYear, profile.taxScheme),
      monthsElapsed: monthsElapsedThisYear(),
    })
  }, [profile, transactions])

  const alerts = useMemo(
    () => (profile ? taxAlerts(profile, transactions) : []),
    [profile, transactions],
  )

  if (!profile || !overview) return <PageLoading label="Memuat data pajak…" />

  const alreadyReserved = profile.taxReserveConfirmed
  const additionalNeeded = Math.max(0, overview.recommendedTaxReserve - alreadyReserved)

  const saveConfirmed = () => {
    saveProfile({ ...profile, taxReserveConfirmed: parseAmountInput(confirmed ?? String(alreadyReserved)) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile })
  }

  return (
    <div className="space-y-4 pb-8">
      <TaxCompliancePanel profile={profile} transactions={transactions} />
      <div className="pt-2">
        <h2 className="flex items-center gap-2 text-lg tracking-tight"><FontAwesomeIcon icon={faPiggyBank} className="size-4 text-primary" aria-hidden="true" />Proyeksi dan cadangan</h2>
        <p className="text-xs text-muted-foreground">Perkiraan ini bukan nominal tagihan pada agenda di atas.</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <h2 className="flex items-center gap-2 text-xl tracking-tight"><FontAwesomeIcon icon={faScaleBalanced} className="size-5 text-primary" aria-hidden="true" />Proyeksi Pajak {profile.fiscalYear}</h2>
          <dl className="mt-4 space-y-3 text-sm">
              <Row label="Omzet tahun ini" value={formatRupiah(overview.revenueYTD)} />
            <Row label="Proyeksi Omzet Setahun" value={formatRupiah(overview.projectedAnnualRevenue)} />
            <Row label="Estimasi Pajak" value={formatRupiah(overview.estimatedTax)} strong />
            <Row label="Pajak Terbayar" value={formatRupiah(overview.taxPaid)} />
            <Row label="Sisa Estimasi Pajak" value={formatRupiah(overview.remainingEstimatedTax)} strong />
          </dl>
          <div className="mt-4 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-start gap-1.5">
              <FontAwesomeIcon icon={faCircleInfo} className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {overview.explanation}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Proactive tax awareness (§5.1 #9 — ROADMAP Phase 2 D) */}
      {alerts.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <h2 className="flex items-center gap-2 text-lg tracking-tight"><FontAwesomeIcon icon={faTriangleExclamation} className="size-4 text-amber-600" aria-hidden="true" />Peringatan Pajak</h2>
            <ul className="mt-3 space-y-2">
              {alerts.map((alert) => (
                <li
                  key={alert.id}
                  className={`flex items-start gap-2 rounded-xl p-3 text-sm leading-relaxed ${
                    alert.level === "warning" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"
                  }`}
                >
                  <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {alert.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6">
            <h2 className="flex items-center gap-2 text-lg tracking-tight"><FontAwesomeIcon icon={faPiggyBank} className="size-4 text-primary" aria-hidden="true" />Cadangan Pajak</h2>
          <p className="mt-1 text-xs text-muted-foreground">Rekomendasi dana pajak yang sebaiknya disisihkan.</p>

          <div className="mt-4 rounded-xl bg-primary/10 p-4">
            <p className="text-xs text-muted-foreground">Saran cadangan pajak</p>
            <p className="mt-1 text-3xl font-medium tabular-nums text-primary">
              {formatRupiah(overview.recommendedTaxReserve)}
            </p>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex flex-col items-end justify-between gap-1">
              <span className="text-muted-foreground">Sudah disisihkan</span>
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
              <span className="font-medium">Tambahan yang perlu disisihkan</span>
              <span className="font-semibold tabular-nums">{formatRupiah(additionalNeeded)}</span>
            </div>
          </div>

          <p className="mt-4 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground">
            Reserve adalah <strong>alokasi virtual</strong>. Angka ini ikut dihitung saat Anda
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

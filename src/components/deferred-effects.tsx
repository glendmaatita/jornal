import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { queryKeys, useFinancialEvents } from "@/lib/queries"
import { initializePocketBaseSync, syncPendingCompanies } from "@/lib/pocketbase-sync"
import { processRecurringRulesForCachedCompanies } from "@/lib/recurring-scheduler"
import { refreshCompanyMemberships } from "@/lib/companies"

// Loaded lazily from AppShell after the first paint so the sync/query graph
// stays off the critical rendering path.
export function DeferredEffects() {
  useFinancialEvents()
  const queryClient = useQueryClient()

  useEffect(() => {
    let checkingAccess = false
    let lastResumeAt = 0
    const refreshAccess = async () => {
      if (checkingAccess) return
      checkingAccess = true
      try {
        const result = await refreshCompanyMemberships()
        if (result.removed) {
          const destination = result.companies.length ? "/companies?access=ended" : "/companies/empty?access=ended"
          window.location.assign(destination)
        } else if (result.scopeChanged) {
          window.location.reload()
        }
      } catch { /* network errors never imply revoked access */ }
      finally { checkingAccess = false }
    }
    const retry = (force = false) => {
      const now = Date.now()
      if (!force && now - lastResumeAt < 30_000) return
      lastResumeAt = now
      void syncPendingCompanies()
      void import("@/lib/invoice-client").then(({ syncPendingInvoiceData }) => syncPendingInvoiceData()).catch(() => undefined)
      void refreshAccess()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") retry()
    }
    const onOnline = () => retry(true)
    const onFocus = () => retry()
    window.addEventListener("online", onOnline)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibilityChange)
    void (async () => {
      const hydrated = await initializePocketBaseSync()
      if (hydrated) for (const key of Object.values(queryKeys)) {
        await queryClient.invalidateQueries({ queryKey: key })
      }
      await processRecurringRulesForCachedCompanies()
      await syncPendingCompanies()
      await import("@/lib/invoice-client").then(({ syncPendingInvoiceData }) => syncPendingInvoiceData()).catch(() => undefined)
    })()
    const interval = window.setInterval(() => void refreshAccess(), 5 * 60_000)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [queryClient])

  return null
}

import { useEffect } from "react"

import { useFinancialEvents } from "@/lib/queries"
import { initializePocketBaseSync, schedulePocketBaseSync, syncPendingCompanies } from "@/lib/pocketbase-sync"
import { processRecurringRulesForCachedCompanies } from "@/lib/recurring-scheduler"
import { refreshCompanyMemberships } from "@/lib/companies"
import { CHANGED_EVENT } from "@/lib/types"

// Loaded lazily from AppShell after the first paint so the sync/query graph
// stays off the critical rendering path.
export function DeferredEffects() {
  useFinancialEvents()

  useEffect(() => {
    let checkingAccess = false
    const refreshAccess = async () => {
      if (checkingAccess) return
      checkingAccess = true
      try {
        const result = await refreshCompanyMemberships()
        if (result.removed) {
          const destination = result.companies.length ? "/companies?access=ended" : "/companies/empty?access=ended"
          window.location.assign(destination)
        }
      } catch { /* network errors never imply revoked access */ }
      finally { checkingAccess = false }
    }
    const retry = () => {
      schedulePocketBaseSync()
      void syncPendingCompanies()
      void refreshAccess()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") retry()
    }
    window.addEventListener("online", retry)
    window.addEventListener("focus", retry)
    document.addEventListener("visibilitychange", onVisibilityChange)
    void (async () => {
      await initializePocketBaseSync()
      await processRecurringRulesForCachedCompanies()
      await syncPendingCompanies()
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    })()
    const interval = window.setInterval(() => void refreshAccess(), 30_000)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("online", retry)
      window.removeEventListener("focus", retry)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  return null
}

import { useEffect } from "react"

import { useFinancialEvents } from "@/lib/queries"
import { initializePocketBaseSync, schedulePocketBaseSync, syncPendingCompanies } from "@/lib/pocketbase-sync"
import { processRecurringRulesForCachedCompanies } from "@/lib/recurring-scheduler"
import { CHANGED_EVENT } from "@/lib/types"

// Loaded lazily from AppShell after the first paint so the sync/query graph
// stays off the critical rendering path.
export function DeferredEffects() {
  useFinancialEvents()

  useEffect(() => {
    const retry = () => {
      schedulePocketBaseSync()
      void syncPendingCompanies()
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
    return () => {
      window.removeEventListener("online", retry)
      window.removeEventListener("focus", retry)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  return null
}

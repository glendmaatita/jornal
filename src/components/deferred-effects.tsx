import { useEffect } from "react"

import { useFinancialEvents } from "@/lib/queries"
import { initializePocketBaseSync } from "@/lib/pocketbase-sync"
import { processRecurringRules } from "@/lib/store"
import { CHANGED_EVENT } from "@/lib/types"

// Loaded lazily from AppShell after the first paint so the sync/query graph
// stays off the critical rendering path.
export function DeferredEffects() {
  useFinancialEvents()

  useEffect(() => {
    void (async () => {
      await initializePocketBaseSync()
      processRecurringRules()
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    })()
  }, [])

  return null
}

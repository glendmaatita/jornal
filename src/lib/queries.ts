// React data layer: reads from the local store and invalidates on any
// financial event (§57) or cross-tab storage change.

import { useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  loadAccounts,
  loadCorrections,
  loadProfile,
  loadRecurringRules,
  loadReserves,
  loadSettings,
  loadTransactions,
  subscribeFinancialEvents,
  getDataScope,
  getCompanyScope,
  invalidateLocalMemory,
} from "@/lib/store"
import { ALL_CATEGORIES } from "@/lib/categories"
import { computeSafeToSpend } from "@/lib/safe-to-spend"
import type { SafeToSpendInput } from "@/lib/safe-to-spend"
import { loadCachedTaxInbox, taxComplianceEnabled } from "@/lib/tax-compliance-client"
import { useTaxAgenda, useTaxConfiguration } from "@/lib/tax-compliance-queries"
import { PERSISTENT_CACHE_UPDATED_EVENT } from "@/lib/persistent-cache"
import type { FinancialEvent } from "@/lib/types"

// Keys include the active tenant. This prevents React Query from briefly
// rendering the previous account while auth and local storage switch.
export const queryKeys = {
  get transactions() { return ["jornal", getDataScope(), "transactions"] as const },
  get accounts() { return ["jornal", getDataScope(), "accounts"] as const },
  get reserves() { return ["jornal", getDataScope(), "reserves"] as const },
  get profile() { return ["jornal", getDataScope(), "profile"] as const },
  get settings() { return ["jornal", getDataScope(), "settings"] as const },
  get corrections() { return ["jornal", getDataScope(), "corrections"] as const },
  get recurringRules() { return ["jornal", getDataScope(), "recurring-rules"] as const },
}

/** Global invalidation whenever any financial state changes (event architecture, §57). */
export function useFinancialEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    let badgeTimer: ReturnType<typeof setTimeout> | undefined
    const syncBadge = async () => {
      const badge = (navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void> }).setAppBadge
      if (!badge) return
      const pending = loadTransactions().filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW").length
      let taxPending = 0
      if (taxComplianceEnabled) {
        taxPending = await loadCachedTaxInbox().then((result) => result?.items.length ?? 0).catch(() => 0)
      }
      void badge(pending + taxPending).catch(() => undefined)
    }
    const scheduleBadge = () => {
      if (badgeTimer) clearTimeout(badgeTimer)
      badgeTimer = setTimeout(() => void syncBadge(), 500)
    }
    const invalidate = (event?: FinancialEvent) => {
      const keys = !event
        ? Object.values(queryKeys)
        : event.startsWith("TRANSACTION_")
          ? [
              queryKeys.transactions,
              ...(["TRANSACTION_CREATED", "TRANSACTION_UPDATED", "TRANSACTION_RECLASSIFIED"].includes(event)
                ? [queryKeys.corrections]
                : []),
            ]
          : event.startsWith("RESERVE_")
            ? [queryKeys.reserves]
            : event === "ACCOUNT_BALANCE_UPDATED"
              ? [queryKeys.accounts]
              : event === "TAX_PROFILE_UPDATED"
                ? [queryKeys.profile]
                : [queryKeys.settings]
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      scheduleBadge()
    }
    const onStorage = (event: StorageEvent) => {
      invalidateLocalMemory(event.key)
      invalidate()
    }
    const onPersistentCacheUpdated = (event: Event) => {
      const namespace = (event as CustomEvent<{ namespace?: string }>).detail?.namespace
      if (namespace === "invoice") {
        void queryClient.invalidateQueries({ queryKey: ["invoice"] })
        void queryClient.invalidateQueries({ queryKey: ["actions"] })
        void queryClient.invalidateQueries({ queryKey: ["search"] })
      } else if (namespace === "documents") {
        void queryClient.invalidateQueries({ queryKey: ["documents"] })
        void queryClient.invalidateQueries({ queryKey: ["actions"] })
        void queryClient.invalidateQueries({ queryKey: ["search"] })
      } else if (namespace === "tax") {
        void queryClient.invalidateQueries({ queryKey: ["jornal-tax"] })
      }
      scheduleBadge()
    }
    const unsubscribe = subscribeFinancialEvents(invalidate)
    window.addEventListener("storage", onStorage)
    window.addEventListener(PERSISTENT_CACHE_UPDATED_EVENT, onPersistentCacheUpdated)
    void syncBadge()
    return () => {
      if (badgeTimer) clearTimeout(badgeTimer)
      unsubscribe()
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(PERSISTENT_CACHE_UPDATED_EVENT, onPersistentCacheUpdated)
    }
  }, [queryClient])
}

export function useTransactions() {
  return useQuery({ queryKey: queryKeys.transactions, queryFn: loadTransactions, staleTime: Number.POSITIVE_INFINITY })
}

export function useAccounts() {
  return useQuery({ queryKey: queryKeys.accounts, queryFn: loadAccounts, staleTime: Number.POSITIVE_INFINITY })
}

export function useReserves() {
  return useQuery({ queryKey: queryKeys.reserves, queryFn: loadReserves, staleTime: Number.POSITIVE_INFINITY })
}

export function useProfile() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: loadProfile, staleTime: Number.POSITIVE_INFINITY })
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: loadSettings, staleTime: Number.POSITIVE_INFINITY })
}

export function useCorrections() {
  return useQuery({ queryKey: queryKeys.corrections, queryFn: loadCorrections, staleTime: Number.POSITIVE_INFINITY })
}

export function useRecurringRules() {
  return useQuery({ queryKey: queryKeys.recurringRules, queryFn: loadRecurringRules, staleTime: Number.POSITIVE_INFINITY })
}

export function useAccountMap() {
  const { data: accounts = [] } = useAccounts()
  return useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
}

export function useCategoryMap() {
  return useMemo(() => new Map(ALL_CATEGORIES.map((category) => [category.id, category.name])), [])
}

/** Maps the subject-level tax agenda into the financial engines without
 * treating reminders as new cash flows or stacking a second tax reserve. */
export function useTaxComplianceSnapshot(): SafeToSpendInput["taxCompliance"] {
  const taxConfiguration = useTaxConfiguration()
  const taxAgenda = useTaxAgenda()
  const activeCompanyId = getCompanyScope().companyId
  const today = new Date().toISOString().slice(0, 10)
  const active = (membership: { effective_from: string; effective_until: string }) =>
    membership.effective_from.slice(0, 10) <= today
    && (!membership.effective_until || membership.effective_until.slice(0, 10) >= today)
  const membership = taxConfiguration.data?.memberships.find((item) => item.company_id === activeCompanyId && active(item))
  if (taxConfiguration.data?.taxCoverage === "RESTRICTED_SHARED_SUBJECT" || taxAgenda.data?.taxCoverage === "RESTRICTED_SHARED_SUBJECT") return { configured: true, sharedSubject: true, knownRemaining: 0, hasUnknownAmounts: true }
  if (!membership || !taxAgenda.data) return undefined
  const sharedSubject = taxConfiguration.data!.memberships.filter((item) => item.subject_id === membership.subject_id && active(item)).length > 1
  const subjectObligations = taxAgenda.data.obligations.filter((item) => item.subjectId === membership.subject_id)
  return {
    configured: true,
    sharedSubject,
    knownRemaining: subjectObligations.reduce((sum, item) => sum + (item.remainingPayable ?? 0), 0),
    hasUnknownAmounts: subjectObligations.some((item) => item.remainingPayable === null && item.paymentStatus !== "NOT_REQUIRED"),
  }
}

/** Combined Safe To Spend engine result (§58 — always recomputed from financial state). */
export function useSafeToSpendResult() {
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()
  const taxCompliance = useTaxComplianceSnapshot()
  const transactionVersion = transactions.map((item) => `${item.id}:${item.updatedAt}`).join("|")
  const accountVersion = accounts.map((item) => `${item.id}:${item.updatedAt}:${item.openingBalance}`).join("|")
  const reserveVersion = reserves.map((item) => `${item.id}:${item.updatedAt}:${item.status}`).join("|")
  const taxVersion = taxCompliance ? `${taxCompliance.sharedSubject}:${taxCompliance.knownRemaining}:${taxCompliance.hasUnknownAmounts}` : ""

  return useQuery({
    queryKey: [...queryKeys.transactions, "safe-to-spend", profile?.updatedAt ?? "", transactionVersion, accountVersion, reserveVersion, taxVersion],
    queryFn: () => {
      if (!profile) return null
      return computeSafeToSpend({ transactions, accounts, profile, reserves, taxCompliance })
    },
    enabled: profile !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

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
} from "@/lib/store"
import { ALL_CATEGORIES } from "@/lib/categories"
import { computeSafeToSpend } from "@/lib/safe-to-spend"
import { CHANGED_EVENT } from "@/lib/types"

export const queryKeys = {
  transactions: ["transactions"] as const,
  accounts: ["accounts"] as const,
  reserves: ["reserves"] as const,
  profile: ["profile"] as const,
  settings: ["settings"] as const,
  corrections: ["corrections"] as const,
  recurringRules: ["recurring-rules"] as const,
}

/** Global invalidation whenever any financial state changes (event architecture, §57). */
export function useFinancialEvents() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidateAll = () => {
      for (const key of Object.values(queryKeys)) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    }
    const unsubscribe = subscribeFinancialEvents(invalidateAll)
    window.addEventListener(CHANGED_EVENT, invalidateAll)
    window.addEventListener("storage", invalidateAll)
    return () => {
      unsubscribe()
      window.removeEventListener(CHANGED_EVENT, invalidateAll)
      window.removeEventListener("storage", invalidateAll)
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

/** Combined Safe To Spend engine result (§58 — always recomputed from financial state). */
export function useSafeToSpendResult() {
  const { data: transactions = [] } = useTransactions()
  const { data: accounts = [] } = useAccounts()
  const { data: reserves = [] } = useReserves()
  const { data: profile } = useProfile()

  return useQuery({
    queryKey: [...queryKeys.transactions, "safe-to-spend", profile?.updatedAt ?? "", accounts.length, reserves.length],
    queryFn: () => {
      if (!profile) return null
      return computeSafeToSpend({ transactions, accounts, profile, reserves })
    },
    enabled: profile !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

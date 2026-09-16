import { useQuery } from "@tanstack/react-query"
import { getCompanyScope } from "./store"
import { loadTaxAgenda, loadTaxConfiguration, loadTaxInbox } from "./tax-compliance-client"

export const taxQueryKeys = {
  get configuration() { return ["jornal-tax", getCompanyScope().tenantId, "configuration"] as const },
  get agenda() {
    const scope = getCompanyScope()
    return ["jornal-tax", scope.tenantId, scope.companyId, "agenda"] as const
  },
  get inbox() { return ["jornal-tax", getCompanyScope().tenantId, "inbox"] as const },
}

export function useTaxConfiguration() {
  return useQuery({ queryKey: taxQueryKeys.configuration, queryFn: loadTaxConfiguration, staleTime: 60_000 })
}

export function useTaxAgenda() {
  const companyId = getCompanyScope().companyId
  return useQuery({ queryKey: taxQueryKeys.agenda, queryFn: () => loadTaxAgenda(companyId), staleTime: 30_000 })
}

export function useTaxInbox() {
  return useQuery({ queryKey: taxQueryKeys.inbox, queryFn: loadTaxInbox, staleTime: 60_000 })
}

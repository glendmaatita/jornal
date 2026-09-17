import { useQuery } from "@tanstack/react-query"
import { loadTeam } from "./team-client"

export const teamQueryKey = (companyId: string) => ["team", companyId] as const
export function useTeam(companyId: string | undefined) {
  return useQuery({ queryKey: teamQueryKey(companyId || ""), queryFn: () => loadTeam(companyId!), enabled: Boolean(companyId), staleTime: 15_000, refetchOnWindowFocus: true, refetchInterval: 30_000 })
}

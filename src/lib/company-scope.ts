import type { BusinessProfile, Transaction } from "./types"

/** Financial engines fail closed if a caller accidentally combines ledgers. */
export function assertSingleCompany(transactions: Transaction[], profile?: Pick<BusinessProfile, "companyId">) {
  const companyIds = new Set(transactions.map((item) => item.companyId).filter((id): id is string => Boolean(id)))
  if (companyIds.size > 1) throw new Error("Data finansial dari beberapa company tidak boleh dicampur")
  const expected = profile?.companyId
  if (expected && companyIds.size === 1 && !companyIds.has(expected)) {
    throw new Error("Data finansial bukan milik company profil")
  }
}

import type { Account } from "./types"

export function accountOptionLabel(account: Account) {
  const details: string[] = []
  if (account.bankName && account.bankName.trim().toLocaleLowerCase("id-ID") !== account.name.trim().toLocaleLowerCase("id-ID")) {
    details.push(account.bankName.trim())
  }
  if (account.accountNumber?.trim()) details.push(account.accountNumber.trim())
  if (account.accountHolder?.trim()) details.push(`a.n. ${account.accountHolder.trim()}`)
  return [account.name, ...details].join(" · ")
}

import { todayIsoDate } from "./format"
import type { Account, Transaction } from "./types"

/** Current account balance: opening balance plus entries that have occurred. */
export function currentAccountBalance(account: Account, transactions: Transaction[], today = todayIsoDate()) {
  return transactions
    .filter((transaction) => transaction.transactionDate <= today)
    .reduce((balance, transaction) => {
      let delta = 0
      if (transaction.accountId === account.id) delta += transaction.direction === "MONEY_IN" ? transaction.amount : -transaction.amount
      if (transaction.transferAccountId === account.id && transaction.accountId !== account.id) delta += transaction.amount
      return balance + delta
    }, account.openingBalance)
}

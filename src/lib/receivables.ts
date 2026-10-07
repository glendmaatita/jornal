import type { Transaction } from "./types"
import { todayIsoDate } from "./format"

export interface ReceivableSummary {
  transaction: Transaction
  paid: number
  outstanding: number
}

/** Derive every receivable from the transaction ledger; no separate balance is stored. */
export function receivablesFromTransactions(transactions: Transaction[], asOf = todayIsoDate()): ReceivableSummary[] {
  transactions = transactions.filter((transaction) => transaction.transactionDate <= asOf)
  const paidByReceivable = new Map<string, number>()
  for (const transaction of transactions) {
    if (transaction.classification !== "RECEIVABLE_PAYMENT" || !transaction.receivableTransactionId) continue
    paidByReceivable.set(
      transaction.receivableTransactionId,
      (paidByReceivable.get(transaction.receivableTransactionId) ?? 0) + transaction.amount,
    )
  }
  return transactions
    .filter((transaction) => transaction.classification === "RECEIVABLE_CREATED")
    .map((transaction) => {
      const paid = paidByReceivable.get(transaction.id) ?? 0
      return { transaction, paid, outstanding: Math.max(0, transaction.amount - paid) }
    })
    .sort((a, b) => (a.transaction.receivableDueDate ?? "9999-12-31").localeCompare(b.transaction.receivableDueDate ?? "9999-12-31"))
}

import type { Transaction } from "./types"

/** Cash always uses amount; revenue analytics exclude separately collected invoice tax. */
export function transactionRevenueAmount(transaction: Pick<Transaction, "amount" | "classification" | "invoiceRevenueAmount">) {
  if (transaction.classification !== "REVENUE") return 0
  return transaction.invoiceRevenueAmount ?? transaction.amount
}

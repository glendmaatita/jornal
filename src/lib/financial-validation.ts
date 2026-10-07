/** Reject invalid ledger numbers before JSON can turn NaN/Infinity into null. */
export function assertMoney(value: unknown, label = "Nominal", minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${label} harus berupa rupiah utuh yang valid`)
  }
}

/** JSON serializes non-finite numbers as null; reject them before sending. */
export function assertFiniteNumbers(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Data angka tidak valid")
  if (value && typeof value === "object") Object.values(value).forEach(assertFiniteNumbers)
}

export function validateFinancialRecord(entity: string, candidate: unknown): void {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Data keuangan tidak valid")
  const value = candidate as Record<string, unknown>
  const historical = { profileHistory: "profile", accountHistory: "accounts", transactionHistory: "transactions", reserveHistory: "reserves" }[entity]
  if (historical) return validateFinancialRecord(historical, value.value)
  if (["transactions", "reserves", "recurringRules"].includes(entity)) assertMoney(value.amount, "Nominal", 1)
  if (entity === "accounts" || entity === "profile") assertMoney(value.openingBalance, "Saldo awal", -Number.MAX_SAFE_INTEGER)
  if (entity === "profile") {
    assertMoney(value.taxReserveConfirmed, "Dana pajak")
    if (!Number.isInteger(value.fiscalYear) || (value.fiscalYear as number) < 1900 || (value.fiscalYear as number) > 9999) throw new Error("Tahun pajak tidak valid")
    for (const key of ["lastCheckedBalance", "lastCheckInDelta"]) if (value[key] != null) assertMoney(value[key], key, -Number.MAX_SAFE_INTEGER)
  }
  if (entity === "transactions") {
    if (value.classificationConfidence != null && (typeof value.classificationConfidence !== "number" || !Number.isFinite(value.classificationConfidence) || value.classificationConfidence < 0 || value.classificationConfidence > 1)) throw new Error("Keyakinan klasifikasi tidak valid")
    for (const key of ["invoiceRevenueAmount", "invoiceTaxAmount", "invoiceOverpaidAmount"]) {
      if (value[key] == null) continue
      assertMoney(value[key], key)
      if ((value[key] as number) > (value.amount as number)) throw new Error("Alokasi invoice melebihi nominal transaksi")
    }
    if (value.invoiceRevenueAmount != null && value.invoiceTaxAmount != null && (value.invoiceRevenueAmount as number) + (value.invoiceTaxAmount as number) + (Number(value.invoiceOverpaidAmount) || 0) !== value.amount) throw new Error("Alokasi invoice tidak sama dengan nominal transaksi")
  }
  if (entity === "recurringRules") {
    if (!Number.isInteger(value.dayOfMonth) || (value.dayOfMonth as number) < 1 || (value.dayOfMonth as number) > 28) throw new Error("Tanggal transaksi berulang tidak valid")
    if (value.createdCount != null) assertMoney(value.createdCount, "Jumlah transaksi")
  }
  if (entity === "settings") {
    for (const key of ["autoAccept", "needsReview"]) if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 1) throw new Error("Ambang klasifikasi tidak valid")
    if ((value.needsReview as number) > (value.autoAccept as number)) throw new Error("Ambang review melebihi ambang otomatis")
  }
}

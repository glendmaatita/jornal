// Mirrors src/lib/financial-validation.ts; keep parity tests passing.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertMoney = assertMoney;
exports.assertFiniteNumbers = assertFiniteNumbers;
exports.validateFinancialRecord = validateFinancialRecord;
/** Reject invalid ledger numbers before JSON can turn NaN/Infinity into null. */
function assertMoney(value, label = "Nominal", minimum = 0) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${label} harus berupa rupiah utuh yang valid`);
    }
}
/** JSON serializes non-finite numbers as null; reject them before sending. */
function assertFiniteNumbers(value) {
    if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Data angka tidak valid");
    if (value && typeof value === "object")
        Object.values(value).forEach(assertFiniteNumbers);
}
function validateFinancialRecord(entity, candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
        throw new Error("Data keuangan tidak valid");
    const value = candidate;
    const historical = { profileHistory: "profile", accountHistory: "accounts", transactionHistory: "transactions", reserveHistory: "reserves" }[entity];
    if (historical)
        return validateFinancialRecord(historical, value.value);
    if (["transactions", "reserves", "recurringRules"].includes(entity))
        assertMoney(value.amount, "Nominal", 1);
    if (entity === "accounts" || entity === "profile")
        assertMoney(value.openingBalance, "Saldo awal", -Number.MAX_SAFE_INTEGER);
    if (entity === "profile") {
        assertMoney(value.taxReserveConfirmed, "Dana pajak");
        if (!Number.isInteger(value.fiscalYear) || value.fiscalYear < 1900 || value.fiscalYear > 9999)
            throw new Error("Tahun pajak tidak valid");
        for (const key of ["lastCheckedBalance", "lastCheckInDelta"])
            if (value[key] != null)
                assertMoney(value[key], key, -Number.MAX_SAFE_INTEGER);
    }
    if (entity === "transactions") {
        if (value.classificationConfidence != null && (typeof value.classificationConfidence !== "number" || !Number.isFinite(value.classificationConfidence) || value.classificationConfidence < 0 || value.classificationConfidence > 1))
            throw new Error("Keyakinan klasifikasi tidak valid");
        for (const key of ["invoiceRevenueAmount", "invoiceTaxAmount"]) {
            if (value[key] == null)
                continue;
            assertMoney(value[key], key);
            if (value[key] > value.amount)
                throw new Error("Alokasi invoice melebihi nominal transaksi");
        }
        if (value.invoiceRevenueAmount != null && value.invoiceTaxAmount != null && value.invoiceRevenueAmount + value.invoiceTaxAmount !== value.amount)
            throw new Error("Alokasi invoice tidak sama dengan nominal transaksi");
    }
    if (entity === "recurringRules") {
        if (!Number.isInteger(value.dayOfMonth) || value.dayOfMonth < 1 || value.dayOfMonth > 28)
            throw new Error("Tanggal transaksi berulang tidak valid");
        if (value.createdCount != null)
            assertMoney(value.createdCount, "Jumlah transaksi");
    }
    if (entity === "settings") {
        for (const key of ["autoAccept", "needsReview"])
            if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1)
                throw new Error("Ambang klasifikasi tidak valid");
        if (value.needsReview > value.autoAccept)
            throw new Error("Ambang review melebihi ambang otomatis");
    }
}

import { beforeEach, describe, expect, test } from "bun:test"
import { resetStorage } from "./test-setup"
import { formatAmountEdit, formatNumberInput, parseAmountInput, parseScaledDecimal } from "./format"
import { assertFiniteNumbers, validateFinancialRecord } from "./financial-validation"
import { currentAccountBalance } from "./account-balance"
import { computeCashPosition } from "./safe-to-spend"
import { categoryMonthlyExpenses, detectRecurring, monthlyTrends } from "./trends"
import { receivablesFromTransactions } from "./receivables"
import { computeForecast, nextOccurrenceAfter } from "./forecast"
import { computeConfirmedBalance, computeUmkmMonthlyLiability } from "./tax-compliance"
import { createReserve, createTransaction, emptyProfile, exportLocalData, importLocalData, KEYS, loadReserves, loadTransactions, saveProfile, updateReserve, updateTransaction } from "./store"
import type { Account, Transaction } from "./types"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const backend = require("../../backend/pocketbase/pb_hooks/financial_validation.js") as { validateFinancialRecord: typeof validateFinancialRecord }

const now = new Date("2026-10-07T12:00:00")
const account = (id: string, includedInCash = true): Account => ({ id, name: id, type: "BANK", openingBalance: 1_000, includedInCash, createdAt: "", updatedAt: "" })
const transaction = (patch: Partial<Transaction> = {}): Transaction => ({
  id: "t1", businessId: "local", direction: "MONEY_IN", amount: 500, currency: "IDR", transactionDate: "2026-10-07", description: "Service", notes: "", categoryId: null, paymentMethod: "", supplierCustomer: "", tags: "", accountId: null, transferAccountId: null, attachmentName: null, attachmentDataUrl: null, classification: "REVENUE", taxClassification: "REVENUE", businessRelevance: "BUSINESS", classificationSource: "USER", classificationConfidence: 1, reviewStatus: "ACCEPTED", createdAt: "", updatedAt: "", ...patch,
})

beforeEach(resetStorage)

describe("numeric input integrity", () => {
  test("API payloads reject nested NaN before JSON can silently turn it into null", () => {
    expect(() => assertFiniteNumbers({ allocations: [{ amount: NaN }] })).toThrow()
    expect(() => assertFiniteNumbers({ liabilityAmount: Infinity })).toThrow()
    expect(() => assertFiniteNumbers({ defaultAmount: null, amount: 0 })).not.toThrow()
  })
  test("decimal quantities and rates preserve precision without silent rounding", () => {
    expect(parseScaledDecimal("2,5", 3)).toBe(2500)
    expect(parseScaledDecimal("0.29", 2)).toBe(29)
    expect(parseScaledDecimal("1,", 3)).toBe(1000)
    expect(parseScaledDecimal("1.2345", 3)).toBeNaN()
    expect(parseScaledDecimal("1e3", 3)).toBeNaN()
    expect(parseScaledDecimal("abc", 2)).toBeNaN()
  })
  test("Rupiah grouping is exact in manual and document inputs", () => {
    for (const [input, expected] of [["1.500", 1500], ["1.500.000", 1500000], ["Rp 1.500.000,00", 1500000], ["-1.500", -1500], ["0", 0]] as const) expect(parseAmountInput(input)).toBe(expected)
  })
  test("rejects malformed, fractional, exponential, and unsafe amounts", () => {
    for (const input of ["abc", "12abc34", "1e6", "1,50", "1.5", "1.23.456", "9007199254740993", "Infinity"]) expect(parseAmountInput(input)).toBeNaN()
  })
  test("typing never rounds large integers or deletes negative signs", () => {
    expect(formatAmountEdit("9007199254740993")).toBe("9.007.199.254.740.993")
    expect(formatAmountEdit("-1000")).toBe("-1.000")
    expect(formatAmountEdit("1,50")).toBe("1,50")
    expect(formatNumberInput("invalid")).toBe("invalid")
  })
})

describe("persistence rejects invalid numeric data", () => {
  test("browser and server enforce the same numeric boundaries", () => {
    const invalid: Array<[string, unknown]> = [
      ...[NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, "1000", null].map((amount): [string, unknown] => ["transactions", transaction({ amount: amount as number })]),
      ["transactions", transaction({ classificationConfidence: 1.1 })],
      ["transactions", transaction({ invoiceRevenueAmount: 450, invoiceTaxAmount: 100 })],
      ["accounts", { ...account("a"), openingBalance: NaN }],
      ["profile", { ...emptyProfile(), fiscalYear: 2026.5 }],
      ["reserves", { amount: -5 }],
      ["recurringRules", { amount: 5, dayOfMonth: 0 }],
      ["settings", { autoAccept: 0.5, needsReview: 0.8 }],
      ["transactionHistory", { value: transaction({ amount: NaN }) }],
    ]
    for (const [entity, value] of invalid) {
      expect(() => validateFinancialRecord(entity, value)).toThrow()
      expect(() => backend.validateFinancialRecord(entity, value)).toThrow()
    }
    for (const validate of [validateFinancialRecord, backend.validateFinancialRecord]) {
      expect(() => validate("transactions", transaction())).not.toThrow()
      expect(() => validate("accounts", { ...account("a"), openingBalance: -100 })).not.toThrow()
      expect(() => validate("profile", { ...emptyProfile(), lastCheckedBalance: 0 })).not.toThrow()
    }
  })
  test("rejected edits leave the existing ledger and cached values intact", () => {
    const saved = createTransaction(transaction())
    expect(() => updateTransaction(saved.id, { amount: NaN })).toThrow()
    expect(loadTransactions()[0].amount).toBe(500)
    const reserve = createReserve({ name: "Tax", amount: 100, dueDate: null })
    expect(() => updateReserve(reserve.id, { amount: Infinity })).toThrow()
    expect(loadReserves()[0].amount).toBe(100)
  })
  test("invalid backup history is rejected before any record is written", () => {
    saveProfile(emptyProfile())
    createTransaction(transaction())
    const original = exportLocalData()
    const backup = structuredClone(original)
    backup.data[KEYS.transactions] = [transaction({ amount: 250 })]
    backup.data[KEYS.transactionHistory] = [{ value: transaction({ amount: null as unknown as number }) }]
    expect(() => importLocalData(backup)).toThrow()
    expect(exportLocalData().data).toEqual(original.data)
  })
})

describe("financial aggregates", () => {
  test("outgoing refunds reduce cash in both the account and cash overview", () => {
    const entry = transaction({ accountId: "a", classification: "REFUND", direction: "MONEY_OUT" })
    const profile = { ...emptyProfile(), useAccountTracking: true }
    expect(computeCashPosition([entry], [account("a")], profile)).toBe(500)
    expect(currentAccountBalance(account("a"), [entry], "2026-10-07")).toBe(500)
  })
  test("account balances count opening balance once", () => {
    expect(currentAccountBalance(account("a"), [transaction({ accountId: "a", classification: "OPENING_BALANCE", amount: 1000 }), transaction({ accountId: "a" })], "2026-10-07")).toBe(1500)
  })
  test("cash respects excluded accounts and transfers across the cash boundary", () => {
    const accounts = [account("cash"), account("escrow", false)]
    const profile = { ...emptyProfile(), useAccountTracking: true }
    const entries = [
      transaction({ accountId: "escrow", amount: 9000 }),
      transaction({ id: "out", accountId: "cash", transferAccountId: "escrow", direction: "MONEY_OUT", classification: "INTERNAL_TRANSFER", amount: 300 }),
      transaction({ id: "in", accountId: "escrow", transferAccountId: "cash", direction: "MONEY_OUT", classification: "INTERNAL_TRANSFER", amount: 100 }),
    ]
    expect(computeCashPosition(entries, accounts, profile, "2026-10-07")).toBe(800)
    expect(currentAccountBalance(accounts[0], entries, "2026-10-07")).toBe(800)
  })
  test("future transactions do not inflate current trends or settle receivables", () => {
    const future = transaction({ transactionDate: "2026-10-08", direction: "MONEY_OUT", classification: "OPERATING_EXPENSE" })
    expect(monthlyTrends([future], 1, now)[0].moneyOut).toBe(0)
    expect(categoryMonthlyExpenses([future], 1, now).size).toBe(0)
    const loan = transaction({ id: "loan", classification: "RECEIVABLE_CREATED", direction: "MONEY_OUT" })
    const repayment = transaction({ id: "repay", classification: "RECEIVABLE_PAYMENT", receivableTransactionId: "loan", transactionDate: "2026-10-08" })
    expect(receivablesFromTransactions([loan, repayment], "2026-10-07")[0]).toMatchObject({ paid: 0, outstanding: 500 })
    expect(receivablesFromTransactions([loan, repayment], "2026-10-08")[0].outstanding).toBe(0)
  })
  test("future and opening entries cannot establish recurring history", () => {
    const entries = ["2026-08-01", "2026-09-01", "2026-10-08"].map((transactionDate) => transaction({ transactionDate }))
    expect(detectRecurring(entries, "2026-10-07")).toEqual([])
    expect(detectRecurring(entries.map((entry) => ({ ...entry, classification: "OPENING_BALANCE" })), "2026-12-01")).toEqual([])
  })
  test("old recurring dates always advance beyond today", () => {
    expect(nextOccurrenceAfter("2020-01-05", "2026-10-07")).toBe("2026-11-05")
  })
  test("forecast describes the actual 0.5% rate used", () => {
    const input = { transactions: [], accounts: [], reserves: [], profile: { ...emptyProfile(), taxScheme: "UMKM_FINAL" as const } }
    const result = computeForecast(input, { scenario: { extraIncome: 100_000, extraExpense: 0, extraReserve: 0 } }, now)
    expect(result.projectedTaxReserve).toBe(500)
    expect(result.assumptions.some((text) => text.includes("0,5%"))).toBe(true)
    expect(() => computeForecast(input, { scenario: { extraIncome: NaN, extraExpense: 0, extraReserve: 0 } }, now)).toThrow()
  })
  test("tax balances report overpayment even when liability is zero", () => {
    expect(computeConfirmedBalance(0, 500)).toMatchObject({ paymentStatus: "OVERPAID", remainingPayable: 0, overpaidAmount: 500 })
    expect(computeUmkmMonthlyLiability({ subjectType: "INDIVIDUAL", eligible: true, dataComplete: true, cumulativeRevenueBefore: 0, currentMonthRevenue: 100, allocatedPayments: 500 })).toMatchObject({ paymentStatus: "OVERPAID", overpaidAmount: 500 })
  })
  test("tax accumulation rejects overflow", () => {
    expect(() => computeUmkmMonthlyLiability({ subjectType: "ENTITY", eligible: true, dataComplete: true, cumulativeRevenueBefore: Number.MAX_SAFE_INTEGER, currentMonthRevenue: 1 })).toThrow()
  })
})

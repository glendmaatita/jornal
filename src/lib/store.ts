// Local-first store per prd.md §57–58: every mutation emits the financial
// events that drive automatic recalculation downstream (Safe To Spend, tax).
// Data persists in localStorage (offline resilience, §66 item 17) and syncs
// across tabs.

import { CHANGED_EVENT } from "./types"
import { schedulePocketBaseSync } from "./pocketbase-sync"
import type {
  Account,
  AppSettings,
  BusinessProfile,
  CorrectionPattern,
  FinancialEvent,
  NewTransaction,
  RecurringRule,
  Reserve,
  Transaction,
} from "./types"
import { patternToken, DEFAULT_THRESHOLDS } from "./classification"
import { todayIsoDate } from "./format"

export const KEYS = {
  transactions: "jornal.transactions.v1",
  transactionHistory: "jornal.transactions-history.v1",
  accounts: "jornal.accounts.v1",
  accountHistory: "jornal.accounts-history.v1",
  reserves: "jornal.reserves.v1",
  reserveHistory: "jornal.reserves-history.v1",
  profile: "jornal.profile.v1",
  profileHistory: "jornal.profile-history.v1",
  settings: "jornal.settings.v1",
  corrections: "jornal.corrections.v1",
  recurringRules: "jornal.recurring-rules.v1",
} as const

const BUSINESS_ID = "local"

// ── Low-level helpers (SSR/private-mode safe) ──

function read<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) return fallback
    return JSON.parse(stored) as T
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable — keep in-memory usage working for the session
  }
}

// ── Event architecture (§57) ──

type Listener = (event: FinancialEvent) => void
const listeners = new Set<Listener>()

function unsubscribeFinancialEvents(listener: Listener) {
  listeners.delete(listener)
}

export function subscribeFinancialEvents(listener: Listener): () => void {
  listeners.add(listener)
  return unsubscribeFinancialEvents.bind(null, listener)
}

export function emitFinancialEvent(event: FinancialEvent) {
  for (const listener of listeners) listener(event)
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: event }))
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return crypto.randomUUID()
}

interface VersionRecord<T> {
  id: string
  effectiveAt: string
  deletedAt: string | null
  value: T
}

function loadVersionRecords<T>(key: string): VersionRecord<T>[] {
  return read<VersionRecord<T>[]>(key, [])
}

function writeVersionRecords<T>(key: string, records: VersionRecord<T>[]) {
  write(key, records)
}

function appendVersionRecord<T>(key: string, record: VersionRecord<T>) {
  const records = loadVersionRecords<T>(key)
  records.push(record)
  writeVersionRecords(key, records)
}

function resolveVersionRecordsAsOf<T>(records: VersionRecord<T>[], asOf: string): VersionRecord<T>[] {
  const latestById = new Map<string, VersionRecord<T>>()
  for (const record of records) {
    if (record.effectiveAt.slice(0, 10) > asOf) continue
    const current = latestById.get(record.id)
    // Later effectiveAt wins; on ties (same millisecond) the record appended later wins
    if (!current || current.effectiveAt <= record.effectiveAt) {
      latestById.set(record.id, record)
    }
  }
  return [...latestById.values()].filter((record) => !record.deletedAt || record.deletedAt.slice(0, 10) > asOf)
}

// ── Business profile (§41) ──

export function emptyProfile(): BusinessProfile {
  return {
    businessId: BUSINESS_ID,
    businessName: "",
    businessType: "INDIVIDUAL",
    pkpStatus: false,
    businessStartDate: null,
    fiscalYear: new Date().getFullYear(),
    taxScheme: "NOT_CALCULATED",
    taxReserveConfirmed: 0,
    openingBalance: 0,
    useAccountTracking: false,
    lastBalanceCheckIn: null,
    lastCheckedBalance: null,
    lastCheckInDelta: null,
    onboardingCompletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
}

function ensureProfileHistorySeed(profile: BusinessProfile) {
  if (loadVersionRecords<BusinessProfile>(KEYS.profileHistory).length > 0) return
  writeVersionRecords<BusinessProfile>(KEYS.profileHistory, [
    {
      id: profile.businessId,
      effectiveAt: profile.createdAt,
      deletedAt: null,
      value: profile,
    },
  ])
}

export function loadProfile(): BusinessProfile {
  return read<BusinessProfile>(KEYS.profile, emptyProfile())
}

export function saveProfile(profile: BusinessProfile, event: FinancialEvent = "TAX_PROFILE_UPDATED") {
  const timestamp = nowIso()
  const nextProfile = { ...profile, businessId: BUSINESS_ID, updatedAt: timestamp }
  write(KEYS.profile, nextProfile)
  appendVersionRecord<BusinessProfile>(KEYS.profileHistory, {
    id: BUSINESS_ID,
    effectiveAt: timestamp,
    deletedAt: null,
    value: nextProfile,
  })
  emitFinancialEvent(event)
  schedulePocketBaseSync()
}

export function loadProfileHistory(): VersionRecord<BusinessProfile>[] {
  const history = loadVersionRecords<BusinessProfile>(KEYS.profileHistory)
  if (history.length > 0) return history
  const profile = loadProfile()
  ensureProfileHistorySeed(profile)
  return loadVersionRecords<BusinessProfile>(KEYS.profileHistory)
}

// ── Accounts (§31) ──

export function loadAccounts(): Account[] {
  return read<Account[]>(KEYS.accounts, [])
}

export function saveAccounts(accounts: Account[]) {
  const timestamp = nowIso()
  write(KEYS.accounts, accounts)
  for (const account of accounts) {
    appendVersionRecord<Account>(KEYS.accountHistory, {
      id: account.id,
      effectiveAt: timestamp,
      deletedAt: null,
      value: { ...account, updatedAt: timestamp },
    })
  }
  emitFinancialEvent("ACCOUNT_BALANCE_UPDATED")
  schedulePocketBaseSync()
}

export function loadAccountHistory(): VersionRecord<Account>[] {
  const history = loadVersionRecords<Account>(KEYS.accountHistory)
  if (history.length > 0) return history
  const accounts = loadAccounts()
  if (accounts.length > 0) {
    writeVersionRecords<Account>(
      KEYS.accountHistory,
      accounts.map((account) => ({
        id: account.id,
        effectiveAt: account.createdAt,
        deletedAt: null,
        value: account,
      })),
    )
  }
  return loadVersionRecords<Account>(KEYS.accountHistory)
}

export function upsertAccount(account: Omit<Account, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
  const accounts = loadAccounts()
  const existingIndex = account.id ? accounts.findIndex((candidate) => candidate.id === account.id) : -1
  if (existingIndex >= 0) {
    const updated = { ...accounts[existingIndex], ...account, updatedAt: nowIso() } as Account
    accounts[existingIndex] = updated
    saveAccounts(accounts)
    return updated
  }
  const created: Account = {
    ...account,
    id: newId(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  } as Account
  saveAccounts([...accounts, created])
  return created
}

export function deleteAccount(id: string) {
  const now = nowIso()
  const accounts = loadAccounts()
  const target = accounts.find((account) => account.id === id)
  if (target) {
    appendVersionRecord<Account>(KEYS.accountHistory, {
      id,
      effectiveAt: now,
      deletedAt: now,
      value: { ...target, updatedAt: now },
    })
  }
  saveAccounts(accounts.filter((account) => account.id !== id))
  schedulePocketBaseSync()
}

// ── Transactions (§16–19) ──

export function loadTransactions(): Transaction[] {
  return read<Transaction[]>(KEYS.transactions, []).map(normalizeTransaction)
}

function persistTransactions(transactions: Transaction[]) {
  write(KEYS.transactions, transactions.map(normalizeTransaction))
}

function normalizeTransaction(transaction: Transaction): Transaction {
  return {
    ...transaction,
    taxClassification: transaction.taxClassification ?? transaction.classification,
    attachmentDataUrl: transaction.attachmentDataUrl ?? null,
  }
}

export function loadTransactionHistory(): VersionRecord<Transaction>[] {
  const history = loadVersionRecords<Transaction>(KEYS.transactionHistory)
  if (history.length > 0) return history
  const transactions = loadTransactions()
  if (transactions.length > 0) {
    writeVersionRecords<Transaction>(
      KEYS.transactionHistory,
      transactions.map((transaction) => ({
        id: transaction.id,
        effectiveAt: transaction.createdAt,
        deletedAt: null,
        value: transaction,
      })),
    )
  }
  return loadVersionRecords<Transaction>(KEYS.transactionHistory)
}

function appendTransactionVersion(transaction: Transaction, deletedAt: string | null = null) {
  appendVersionRecord<Transaction>(KEYS.transactionHistory, {
    id: transaction.id,
    effectiveAt: deletedAt ?? transaction.updatedAt,
    deletedAt,
    value: transaction,
  })
}

export function createTransaction(input: NewTransaction): Transaction {
  const timestamp = nowIso()
  const transaction: Transaction = {
    ...input,
    taxClassification: input.taxClassification ?? input.classification,
    attachmentDataUrl: input.attachmentDataUrl ?? null,
    id: newId(),
    businessId: BUSINESS_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  persistTransactions([transaction, ...loadTransactions()])
  appendTransactionVersion(transaction)
  emitFinancialEvent("TRANSACTION_CREATED")
  if (transaction.classificationSource === "USER" && transaction.description.trim()) {
    recordCorrection(
      transaction.description,
      transaction.categoryId,
      transaction.classification,
      transaction.direction,
    )
  }
  schedulePocketBaseSync()
  return transaction
}

export function updateTransaction(id: string, patch: Partial<NewTransaction>): Transaction | null {
  const transactions = loadTransactions()
  const index = transactions.findIndex((candidate) => candidate.id === id)
  if (index < 0) return null
  const before = transactions[index]
  const updated: Transaction = { ...before, ...patch, updatedAt: nowIso() }
  transactions[index] = updated
  persistTransactions(transactions)
  appendTransactionVersion(updated)
  const reclassified =
    before.classification !== updated.classification || before.categoryId !== updated.categoryId
  emitFinancialEvent(reclassified ? "TRANSACTION_RECLASSIFIED" : "TRANSACTION_UPDATED")
  if (updated.classificationSource === "USER" && updated.description.trim()) {
    recordCorrection(
      updated.description,
      updated.categoryId,
      updated.classification,
      updated.direction,
    )
  }
  schedulePocketBaseSync()
  return updated
}

export function deleteTransaction(id: string) {
  const now = nowIso()
  const transactions = loadTransactions()
  const target = transactions.find((transaction) => transaction.id === id)
  if (target) {
    appendTransactionVersion(target, now)
  }
  persistTransactions(transactions.filter((transaction) => transaction.id !== id))
  emitFinancialEvent("TRANSACTION_DELETED")
  schedulePocketBaseSync()
}

export function duplicateTransaction(id: string): Transaction | null {
  const source = loadTransactions().find((transaction) => transaction.id === id)
  if (!source) return null
  const rest: Omit<Transaction, "id" | "createdAt" | "updatedAt"> = {
    ...source,
    description: `${source.description} (salinan)`,
  }
  return createTransaction(rest)
}

// ── Review queue (§24) ──

export function needsReviewTransactions(): Transaction[] {
  return loadTransactions().filter((transaction) => transaction.reviewStatus === "NEEDS_REVIEW")
}

/** Resolve a review-queue item by picking a classification (quick buttons, §24). */
export function resolveReview(id: string, classification: Transaction["classification"], categoryId: string | null) {
  return updateTransaction(id, {
    classification,
    categoryId,
    classificationSource: "USER",
    classificationConfidence: 1,
    reviewStatus: "ACCEPTED",
  })
}

// ── Corrections / learning data (§25 — capture only; activation in Phase 2) ──

export function loadCorrections(): CorrectionPattern[] {
  return read<CorrectionPattern[]>(KEYS.corrections, [])
}

/**
 * When a user overrides a system suggestion, store the pattern so similar
 * descriptions get classified from HISTORICAL_PATTERN in the future.
 */
export function recordCorrection(
  description: string,
  categoryId: string | null,
  classification: Transaction["classification"],
  direction: Transaction["direction"],
) {
  const token = patternToken(description)
  if (!token) return
  const corrections = loadCorrections()
  const existing = corrections.find((candidate) => candidate.token === token)
  if (existing) {
    existing.occurrences += 1
    existing.categoryId = categoryId
    existing.classification = classification
    existing.direction = direction
    existing.updatedAt = nowIso()
  } else {
    corrections.push({
      id: newId(),
      token,
      categoryId,
      classification,
      direction,
      occurrences: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
  }
  write(KEYS.corrections, corrections)
  schedulePocketBaseSync()
}

export function deleteCorrection(id: string) {
  write(KEYS.corrections, loadCorrections().filter((pattern) => pattern.id !== id))
  schedulePocketBaseSync()
}

export function clearCorrections() {
  write(KEYS.corrections, [])
  schedulePocketBaseSync()
}

// ── Reserves (§47) ──

export function loadReserves(): Reserve[] {
  return read<Reserve[]>(KEYS.reserves, [])
}

export function loadReserveHistory(): VersionRecord<Reserve>[] {
  const history = loadVersionRecords<Reserve>(KEYS.reserveHistory)
  if (history.length > 0) return history
  const reserves = loadReserves()
  if (reserves.length > 0) {
    writeVersionRecords<Reserve>(
      KEYS.reserveHistory,
      reserves.map((reserve) => ({
        id: reserve.id,
        effectiveAt: reserve.createdAt,
        deletedAt: null,
        value: reserve,
      })),
    )
  }
  return loadVersionRecords<Reserve>(KEYS.reserveHistory)
}

function appendReserveVersion(reserve: Reserve, deletedAt: string | null = null) {
  appendVersionRecord<Reserve>(KEYS.reserveHistory, {
    id: reserve.id,
    effectiveAt: deletedAt ?? reserve.updatedAt,
    deletedAt,
    value: reserve,
  })
}

export function createReserve(input: Omit<Reserve, "id" | "status" | "createdAt" | "updatedAt">): Reserve {
  const timestamp = nowIso()
  const reserve: Reserve = {
    ...input,
    id: newId(),
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  write(KEYS.reserves, [reserve, ...loadReserves()])
  appendReserveVersion(reserve)
  emitFinancialEvent("RESERVE_CREATED")
  schedulePocketBaseSync()
  return reserve
}

export function updateReserve(id: string, patch: Partial<Pick<Reserve, "name" | "amount" | "dueDate" | "status">>) {
  const reserves = loadReserves()
  const index = reserves.findIndex((reserve) => reserve.id === id)
  if (index < 0) return null
  reserves[index] = { ...reserves[index], ...patch, updatedAt: nowIso() }
  write(KEYS.reserves, reserves)
  appendReserveVersion(reserves[index])
  emitFinancialEvent(patch.status === "CANCELLED" ? "RESERVE_REMOVED" : "RESERVE_UPDATED")
  schedulePocketBaseSync()
  return reserves[index]
}

export function removeReserve(id: string) {
  const now = nowIso()
  const reserves = loadReserves()
  const target = reserves.find((reserve) => reserve.id === id)
  if (target) {
    appendReserveVersion(target, now)
  }
  write(KEYS.reserves, reserves.filter((reserve) => reserve.id !== id))
  emitFinancialEvent("RESERVE_REMOVED")
  schedulePocketBaseSync()
}

// ── Recurring rules (§30 — Phase 3 auto-creation, confirmation-gated) ──

export function loadRecurringRules(): RecurringRule[] {
  return read<RecurringRule[]>(KEYS.recurringRules, [])
}

function persistRecurringRules(rules: RecurringRule[]) {
  write(KEYS.recurringRules, rules)
}

export function createRecurringRule(
  input: Omit<RecurringRule, "id" | "lastRun" | "createdCount" | "createdAt" | "updatedAt">,
): RecurringRule {
  const timestamp = nowIso()
  const rule: RecurringRule = {
    ...input,
    id: newId(),
    lastRun: null,
    createdCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  persistRecurringRules([...loadRecurringRules(), rule])
  schedulePocketBaseSync()
  return rule
}

export function updateRecurringRule(id: string, patch: Partial<Pick<RecurringRule, "autoCreate" | "amount" | "nextRun" | "description">>) {
  const rules = loadRecurringRules()
  const index = rules.findIndex((rule) => rule.id === id)
  if (index < 0) return null
  rules[index] = { ...rules[index], ...patch, updatedAt: nowIso() }
  persistRecurringRules(rules)
  schedulePocketBaseSync()
  return rules[index]
}

export function deleteRecurringRule(id: string) {
  persistRecurringRules(loadRecurringRules().filter((rule) => rule.id !== id))
  schedulePocketBaseSync()
}

export function resolveProfileAsOf(asOf: string, currentProfile = loadProfile()): BusinessProfile {
  const history = loadProfileHistory()
  const resolved = resolveVersionRecordsAsOf(history, asOf)
  return resolved.at(-1)?.value ?? currentProfile
}

export function resolveAccountsAsOf(asOf: string, currentAccounts = loadAccounts()): Account[] {
  const history = loadAccountHistory()
  if (history.length === 0) return currentAccounts
  return resolveVersionRecordsAsOf(history, asOf).map((record) => record.value)
}

export function resolveTransactionsAsOf(asOf: string, currentTransactions = loadTransactions()): Transaction[] {
  const history = loadTransactionHistory()
  if (history.length === 0) return currentTransactions.filter((transaction) => transaction.transactionDate <= asOf)
  return resolveVersionRecordsAsOf(history, asOf)
    .map((record) => record.value)
    .filter((transaction) => transaction.transactionDate <= asOf)
}

export function resolveReservesAsOf(asOf: string, currentReserves = loadReserves()): Reserve[] {
  const history = loadReserveHistory()
  if (history.length === 0) return currentReserves.filter((reserve) => reserve.createdAt.slice(0, 10) <= asOf)
  return resolveVersionRecordsAsOf(history, asOf).map((record) => record.value)
}

function addMonthsToIso(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(year, month - 1 + months, 1)
  const daysInTarget = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(Math.max(day, 1), 28, daysInTarget))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/**
 * §30 / ROADMAP Phase 3 — create transactions from confirmed recurring rules.
 * Only rules with `autoCreate: true` (explicitly enabled by the user, which is
 * the required confirmation step for the pattern) are processed. Idempotent:
 * safe to call on every app start.
 */
export function processRecurringRules(todayIso = todayIsoDate()): Transaction[] {
  const created: Transaction[] = []
  const rules = loadRecurringRules()
  let changed = false
  for (const rule of rules) {
    if (!rule.autoCreate) continue
    let guard = 0
    while (rule.nextRun <= todayIso && guard < 3) {
      const createdTransaction = createTransaction({
        direction: rule.direction,
        amount: rule.amount,
        currency: "IDR",
        transactionDate: rule.nextRun,
        description: rule.description,
        notes: "Dibuat otomatis dari transaksi berulang",
        categoryId: rule.categoryId,
        paymentMethod: rule.paymentMethod,
        supplierCustomer: "",
        tags: "",
        accountId: rule.accountId,
        transferAccountId: null,
        attachmentName: null,
        attachmentDataUrl: null,
        classification: rule.classification,
        taxClassification: rule.classification,
        businessRelevance: "BUSINESS",
        classificationSource: "SYSTEM",
        classificationConfidence: 1,
        reviewStatus: "AUTO_ACCEPTED",
      })
      created.push(createdTransaction)
      rule.lastRun = rule.nextRun
      rule.nextRun = addMonthsToIso(rule.nextRun, 1)
      rule.createdCount += 1
      changed = true
      guard += 1
    }
  }
  if (changed) persistRecurringRules(rules)
  if (changed) schedulePocketBaseSync()
  return created
}

// ── Settings (§22 — configurable thresholds) ──

export function loadSettings(): AppSettings {
  return read<AppSettings>(KEYS.settings, { autoAccept: DEFAULT_THRESHOLDS.autoAccept, needsReview: DEFAULT_THRESHOLDS.needsReview })
}

export function saveSettings(settings: AppSettings) {
  write(KEYS.settings, settings)
  schedulePocketBaseSync()
}

// ── Onboarding / data management ──

export function isOnboarded(): boolean {
  return loadProfile().onboardingCompletedAt !== null
}

export function resetAllData() {
  for (const key of Object.values(KEYS)) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
  emitFinancialEvent("TAX_PROFILE_UPDATED")
  schedulePocketBaseSync()
}

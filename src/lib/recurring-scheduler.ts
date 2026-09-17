import { loadCachedCompanies } from "./companies"
import { todayIsoDate } from "./format"
import { persistState } from "./local-db"
import { pb } from "./pb"
import { KEYS, storageKeyForScope } from "./store"
import type { CompanyScope, RecurringRule, Transaction } from "./types"

function read<T>(scope: CompanyScope, key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(storageKeyForScope(scope, key))
    return raw ? JSON.parse(raw) as T : fallback
  } catch { return fallback }
}

function addMonth(iso: string) {
  const [year, month, day] = iso.split("-").map(Number)
  const date = new Date(year, month, 1)
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(Math.max(day, 1), 28, days))
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export async function processRecurringRulesForScope(scope: CompanyScope, today = todayIsoDate()) {
  const rules = read<RecurringRule[]>(scope, KEYS.recurringRules, [])
  if (rules.length === 0) return 0
  const transactions = read<Transaction[]>(scope, KEYS.transactions, [])
  const history = read<Array<{ id: string; effectiveAt: string; deletedAt: null; value: Transaction }>>(scope, KEYS.transactionHistory, [])
  const accountIds = new Set(read<Array<{ id: string }>>(scope, KEYS.accounts, []).map((account) => account.id))
  const ids = new Set(transactions.map((transaction) => transaction.id))
  let created = 0
  let changed = false
  for (const rule of rules) {
    if (!rule.autoCreate || (rule.accountId && !accountIds.has(rule.accountId))) continue
    let guard = 0
    while (rule.nextRun <= today && guard < 3) {
      const occurrence = rule.nextRun
      const id = `recurring-${rule.id}-${occurrence}`
      const timestamp = `${occurrence}T00:00:00.000Z`
      if (!ids.has(id)) {
        const transaction: Transaction = {
          id, businessId: scope.tenantId, companyId: scope.companyId,
          direction: rule.direction, amount: rule.amount, currency: "IDR", transactionDate: occurrence,
          description: rule.description, notes: "Dibuat otomatis dari transaksi berulang", categoryId: rule.categoryId,
          paymentMethod: rule.paymentMethod, supplierCustomer: "", tags: "", accountId: rule.accountId,
          transferAccountId: null, attachmentName: null, attachmentDataUrl: null,
          receivableTransactionId: null, receivableDueDate: null,
          classification: rule.classification, taxClassification: rule.classification,
          businessRelevance: "BUSINESS", classificationSource: "SYSTEM", classificationConfidence: 1,
          reviewStatus: "AUTO_ACCEPTED", createdAt: timestamp, updatedAt: timestamp,
        }
        transactions.unshift(transaction)
        history.push({ id, effectiveAt: timestamp, deletedAt: null, value: transaction })
        ids.add(id)
        created += 1
      }
      rule.lastRun = occurrence
      rule.nextRun = addMonth(occurrence)
      rule.createdCount += 1
      rule.updatedAt = timestamp
      changed = true
      guard += 1
    }
  }
  if (!changed) return 0
  const writes: Array<[string, unknown]> = [
    [KEYS.transactions, transactions], [KEYS.transactionHistory, history], [KEYS.recurringRules, rules],
  ]
  for (const [key, value] of writes) {
    const storageKey = storageKeyForScope(scope, key)
    window.localStorage.setItem(storageKey, JSON.stringify(value))
    await persistState(storageKey, value)
  }
  return created
}

export async function processRecurringRulesForCachedCompanies(today = todayIsoDate()) {
  const actorUserId = pb.authStore.record?.id
  if (!actorUserId) return 0
  let created = 0
  for (const company of loadCachedCompanies()) {
    if (company.status !== "ACTIVE" || !company.onboardingCompletedAt) continue
    created += await processRecurringRulesForScope({ actorUserId, ownerTenantId: company.tenantId, tenantId: company.tenantId, companyId: company.id, dataEpoch: company.dataEpoch, membershipRevision: company.membershipRevision }, today)
  }
  return created
}

import { activeCompany } from "./companies";
import { loadCachedCompanies } from "./companies";
import { clearMirroredState, mirrorState, restoreState } from "./local-db";
import { pb, pocketBaseConfigured } from "./pb";
import { clearPersistentCachePrefix, PERSISTENT_CACHE_UPDATED_EVENT, staleWhileRevalidate } from "./persistent-cache";
import {
  reconcileServerTransaction,
  reconcileServerTransactionDeletion,
} from "./store";
import { acceptServerTransactionRevision } from "./pocketbase-sync";
import type {
  Invoice,
  InvoiceCustomer,
  InvoiceItemInput,
  InvoiceProductSuggestion,
  InvoiceSettings,
  InvoiceUnit,
} from "./invoice-types";
import type { Transaction } from "./types";

export interface Page<T> {
  items: T[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}
export interface InvoiceSummary {
  unpaidTotal: number;
  unpaidCount: number;
  overdueTotal: number;
  overdueCount: number;
  serverDate: string;
  computedAt: string;
}
export interface InvoicePayment {
  id: string;
  invoiceId: string;
  amount: number;
  paidOn: string;
  accountId: string | null;
  ledgerTransactionId: string;
  origin: "CREATED" | "LINKED";
  status: "ACTIVE" | "REVERSED";
  reference: string | null;
  revision: number;
}

export const OFFLINE_INVOICE_SYNCED_EVENT = "jornal:offline-invoice-synced";

export type CustomerCreateInput = Omit<
  InvoiceCustomer,
  | "id"
  | "tenantId"
  | "companyId"
  | "dataEpoch"
  | "status"
  | "revision"
  | "createdAt"
  | "updatedAt"
>;

function scope() {
  const company = activeCompany();
  if (!company) throw new Error("Pilih company terlebih dahulu");
  return { companyId: company.id, dataEpoch: company.dataEpoch };
}
function query(values: Record<string, unknown>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  });
  return params.toString();
}
async function send<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  if (!pocketBaseConfigured) throw new Error("Server invoice belum tersedia");
  const result = await pb.send<T>(path, { ...options, headers: { "X-Jornal-Protocol": "3" } });
  if (options.method && options.method !== "GET") await clearPersistentCachePrefix(cachePrefix());
  return result;
}
function command() {
  return crypto.randomUUID();
}
function cacheKey(name: string) {
  const company = activeCompany();
  return `${cachePrefixFor(company?.id || "none", company?.dataEpoch || 0)}${name}.v1`;
}
function cachePrefixFor(companyId: string, dataEpoch: number) {
  return `jornal.${pb.authStore.record?.id || "local"}.${companyId}.${dataEpoch}.invoice.`;
}
function cachePrefix() {
  const company = activeCompany();
  return cachePrefixFor(company?.id || "none", company?.dataEpoch || 0);
}
async function cached<T>(key: string, load: () => Promise<T>) {
  return staleWhileRevalidate("invoice", cacheKey(key), load);
}

export function listCustomers(
  options: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
  } = {},
) {
  return cached(`customers.${JSON.stringify(options)}`, () =>
    send<
      Page<
        InvoiceCustomer & { activeInvoiceCount: number; unpaidTotal: number }
      >
    >(`/api/jornal/invoicing/customers?${query({ ...scope(), ...options })}`),
  );
}
export function getCustomer(id: string) {
  return cached(`customer.${id}`, () =>
    send<{
      customer: InvoiceCustomer;
      invoices: Invoice[];
      summary: { invoiceCount: number; paidTotal: number; unpaidTotal: number };
    }>(
      `/api/jornal/invoicing/customers/${encodeURIComponent(id)}?${query(scope())}`,
    ),
  );
}
export function createCustomer(
  input: CustomerCreateInput,
) {
  return send<{ customer: InvoiceCustomer; warnings: string[] }>(
    "/api/jornal/invoicing/customers",
    { method: "POST", body: { ...scope(), ...input, commandKey: command() } },
  );
}
export function updateCustomer(
  id: string,
  input: Partial<InvoiceCustomer> & { expectedRevision: number },
) {
  return send<{ customer: InvoiceCustomer }>(
    `/api/jornal/invoicing/customers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { ...scope(), ...input, commandKey: command() } },
  );
}
export function setCustomerArchived(
  customer: InvoiceCustomer,
  archived: boolean,
) {
  return send<{ customer: InvoiceCustomer }>(
    `/api/jornal/invoicing/customers/${encodeURIComponent(customer.id)}/${archived ? "archive" : "restore"}`,
    {
      method: "POST",
      body: {
        ...scope(),
        commandKey: command(),
        expectedRevision: customer.revision,
      },
    },
  );
}

export function getInvoiceSettings() {
  return cached("settings", () =>
    send<{ settings: InvoiceSettings; units: InvoiceUnit[] }>(
      `/api/jornal/invoicing/settings?${query(scope())}`,
    ),
  );
}
export function updateInvoiceSettings(input: InvoiceSettings) {
  return send<{ settings: InvoiceSettings }>("/api/jornal/invoicing/settings", {
    method: "PUT",
    body: {
      ...scope(),
      ...input,
      expectedRevision: input.revision,
      commandKey: command(),
    },
  });
}
export function createInvoiceUnit(label: string) {
  return send<{ unit: InvoiceUnit }>("/api/jornal/invoicing/units", {
    method: "POST",
    body: { ...scope(), label, commandKey: command() },
  });
}
export function updateInvoiceUnit(
  unit: InvoiceUnit,
  changes: Partial<Pick<InvoiceUnit, "label" | "status">>,
) {
  return send<{ unit: InvoiceUnit }>(
    `/api/jornal/invoicing/units/${encodeURIComponent(unit.id)}`,
    {
      method: "PATCH",
      body: {
        ...scope(),
        ...changes,
        expectedRevision: unit.revision,
        commandKey: command(),
      },
    },
  );
}

export interface InvoiceDraftInput {
  customerId: string;
  issueDate: string;
  dueDate: string;
  timezone?: string;
  items: InvoiceItemInput[];
  shippingMethod?: string;
  discountAmount?: number;
  shippingAmount?: number;
  taxRateBps?: number;
}

interface PendingInvoiceDraft {
  id: string;
  companyId: string;
  dataEpoch: number;
  commandKey: string;
  issueCommandKey: string;
  publish: boolean;
  composeStorageKey: string;
  input: InvoiceDraftInput;
  queuedAt: string;
}

interface PendingCustomerCreate {
  id: string;
  companyId: string;
  dataEpoch: number;
  commandKey: string;
  formStorageKey: string;
  input: CustomerCreateInput;
  queuedAt: string;
}

function pendingDraftsKey(companyId: string, dataEpoch: number) {
  return `jornal.${pb.authStore.record?.id || "local"}.${companyId}.${dataEpoch}.invoice-pending-drafts.v1`;
}
function pendingCustomersKey(companyId: string, dataEpoch: number) {
  return `jornal.${pb.authStore.record?.id || "local"}.${companyId}.${dataEpoch}.customer-pending-creates.v1`;
}

async function loadPendingCustomers(companyId: string, dataEpoch: number): Promise<PendingCustomerCreate[]> {
  const key = pendingCustomersKey(companyId, dataEpoch);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as PendingCustomerCreate[];
  } catch { /* use the durable copy */ }
  return (await restoreState(key).catch(() => undefined) as PendingCustomerCreate[] | undefined) ?? [];
}

async function savePendingCustomers(companyId: string, dataEpoch: number, customers: PendingCustomerCreate[]) {
  const key = pendingCustomersKey(companyId, dataEpoch);
  if (customers.length === 0) {
    try { window.localStorage.removeItem(key); } catch { /* durable cleanup follows */ }
    await clearMirroredState(key).catch(() => undefined);
    return;
  }
  try { window.localStorage.setItem(key, JSON.stringify(customers)); } catch { /* IndexedDB remains available */ }
  await mirrorState(key, customers);
}

export async function queueCustomerCreate(input: CustomerCreateInput, formStorageKey: string) {
  const current = scope();
  const pending = await loadPendingCustomers(current.companyId, current.dataEpoch);
  const next: PendingCustomerCreate = {
    id: crypto.randomUUID(), companyId: current.companyId, dataEpoch: current.dataEpoch,
    commandKey: command(), formStorageKey, input, queuedAt: new Date().toISOString(),
  };
  await savePendingCustomers(current.companyId, current.dataEpoch, [
    ...pending.filter((item) => item.formStorageKey !== formStorageKey), next,
  ]);
  return next;
}

async function syncPendingCustomers() {
  let synced = 0;
  for (const company of loadCachedCompanies().filter((item) => item.status === "ACTIVE")) {
    const pending = await loadPendingCustomers(company.id, company.dataEpoch);
    for (const item of pending) {
        const result = await pb.send<{ customer: InvoiceCustomer }>("/api/jornal/invoicing/customers", {
          method: "POST", headers: { "X-Jornal-Protocol": "3" },
          body: { companyId: company.id, dataEpoch: company.dataEpoch, ...item.input, commandKey: item.commandKey },
        });
        const latest = await loadPendingCustomers(company.id, company.dataEpoch);
        await savePendingCustomers(company.id, company.dataEpoch, latest.filter((candidate) => candidate.id !== item.id));
        try { window.localStorage.removeItem(item.formStorageKey); } catch { /* durable cleanup follows */ }
        await clearMirroredState(item.formStorageKey).catch(() => undefined);
        await clearPersistentCachePrefix(cachePrefixFor(company.id, company.dataEpoch));
        window.dispatchEvent(new CustomEvent(PERSISTENT_CACHE_UPDATED_EVENT, { detail: { namespace: "invoice", key: item.id } }));
        window.dispatchEvent(new CustomEvent(OFFLINE_INVOICE_SYNCED_EVENT, { detail: { kind: "customer", localId: item.id, storageKey: item.formStorageKey, serverId: result.customer.id } }));
        synced += 1;
    }
  }
  return synced;
}

async function loadPendingDrafts(companyId: string, dataEpoch: number): Promise<PendingInvoiceDraft[]> {
  const key = pendingDraftsKey(companyId, dataEpoch);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as PendingInvoiceDraft[];
  } catch { /* use the durable copy */ }
  return (await restoreState(key).catch(() => undefined) as PendingInvoiceDraft[] | undefined) ?? [];
}

async function savePendingDrafts(companyId: string, dataEpoch: number, drafts: PendingInvoiceDraft[]) {
  const key = pendingDraftsKey(companyId, dataEpoch);
  if (drafts.length === 0) {
    try { window.localStorage.removeItem(key); } catch { /* durable cleanup follows */ }
    await clearMirroredState(key).catch(() => undefined);
    return;
  }
  try { window.localStorage.setItem(key, JSON.stringify(drafts)); } catch { /* IndexedDB remains available */ }
  await mirrorState(key, drafts);
}

/** Queue a server-authoritative draft/issue command without inventing an
 * official invoice number on the device. Re-saving replaces the older queued
 * snapshot for this compose form. */
export async function queueInvoiceDraft(input: InvoiceDraftInput, publish: boolean, composeStorageKey: string) {
  const current = scope();
  const drafts = await loadPendingDrafts(current.companyId, current.dataEpoch);
  const next: PendingInvoiceDraft = {
    id: crypto.randomUUID(),
    companyId: current.companyId,
    dataEpoch: current.dataEpoch,
    commandKey: command(),
    issueCommandKey: command(),
    publish,
    composeStorageKey,
    input,
    queuedAt: new Date().toISOString(),
  };
  await savePendingDrafts(current.companyId, current.dataEpoch, [
    ...drafts.filter((draft) => draft.composeStorageKey !== composeStorageKey),
    next,
  ]);
  return next;
}

export async function syncPendingInvoiceDrafts() {
  if (!pocketBaseConfigured || !pb.authStore.isValid || navigator.onLine === false) return 0;
  let synced = 0;
  for (const company of loadCachedCompanies().filter((item) => item.status === "ACTIVE")) {
    const drafts = await loadPendingDrafts(company.id, company.dataEpoch);
    for (const draft of drafts) {
        const created = await pb.send<{ invoice: Invoice }>("/api/jornal/invoicing/invoices", {
          method: "POST",
          headers: { "X-Jornal-Protocol": "3" },
          body: { companyId: company.id, dataEpoch: company.dataEpoch, ...draft.input, commandKey: draft.commandKey },
        });
        let syncedInvoice = created.invoice;
        if (draft.publish) {
          const issued = await pb.send<{ invoice: Invoice }>(`/api/jornal/invoicing/invoices/${encodeURIComponent(created.invoice.id)}/issue`, {
            method: "POST",
            headers: { "X-Jornal-Protocol": "3" },
            body: { companyId: company.id, dataEpoch: company.dataEpoch, expectedRevision: created.invoice.revision, commandKey: draft.issueCommandKey },
          });
          syncedInvoice = issued.invoice;
        }
        const latest = await loadPendingDrafts(company.id, company.dataEpoch);
        await savePendingDrafts(company.id, company.dataEpoch, latest.filter((item) => item.id !== draft.id));
        try {
          window.localStorage.removeItem(draft.composeStorageKey);
          window.sessionStorage.removeItem(draft.composeStorageKey);
        } catch { /* durable cleanup follows */ }
        await clearMirroredState(draft.composeStorageKey).catch(() => undefined);
        await clearPersistentCachePrefix(cachePrefixFor(company.id, company.dataEpoch));
        window.dispatchEvent(new CustomEvent(PERSISTENT_CACHE_UPDATED_EVENT, { detail: { namespace: "invoice", key: draft.id } }));
        window.dispatchEvent(new CustomEvent(OFFLINE_INVOICE_SYNCED_EVENT, { detail: { kind: "invoice", localId: draft.id, storageKey: draft.composeStorageKey, serverId: syncedInvoice.id } }));
        synced += 1;
    }
  }
  return synced;
}

export async function syncPendingInvoiceData() {
  if (!pocketBaseConfigured || !pb.authStore.isValid || navigator.onLine === false) return 0;
  return await syncPendingCustomers() + await syncPendingInvoiceDrafts();
}
export function listInvoices(
  options: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    customerId?: string;
  } = {},
) {
  return cached(`invoices.${JSON.stringify(options)}`, () =>
    send<Page<Invoice>>(
      `/api/jornal/invoicing/invoices?${query({ ...scope(), ...options })}`,
    ),
  );
}
export function listInvoiceProducts(search: string) {
  return cached(`products.${search.trim().toLocaleLowerCase("id-ID")}`, () =>
    send<{ items: InvoiceProductSuggestion[] }>(
      `/api/jornal/invoicing/products?${query({ ...scope(), search, limit: 20 })}`,
    ),
  );
}
export function getInvoice(id: string) {
  return cached(`invoice.${id}`, () =>
    send<{ invoice: Invoice; payment: InvoicePayment | null }>(
      `/api/jornal/invoicing/invoices/${encodeURIComponent(id)}?${query(scope())}`,
    ),
  );
}
export function listInvoicePaymentCandidates(id: string) {
  return send<{ items: Array<{ transaction: Transaction; revision: number }> }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(id)}/payment-candidates?${query(scope())}`,
  );
}
export function getInvoiceDocument(id: string) {
  return cached(`document.${id}`, () => send<{
    documentVersion: string;
    contentHash: string;
    invoice: Invoice;
  }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(id)}/document?${query(scope())}`,
  ));
}
export function getInvoiceSummary() {
  return cached("summary", () =>
    send<InvoiceSummary>(`/api/jornal/invoicing/summary?${query(scope())}`),
  );
}
export function createInvoice(input: InvoiceDraftInput) {
  return send<{ invoice: Invoice }>("/api/jornal/invoicing/invoices", {
    method: "POST",
    body: { ...scope(), ...input, commandKey: command() },
  });
}
export function updateInvoice(invoice: Invoice, input: InvoiceDraftInput) {
  return send<{ invoice: Invoice }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}`,
    {
      method: "PATCH",
      body: {
        ...scope(),
        ...input,
        expectedRevision: invoice.revision,
        commandKey: command(),
      },
    },
  );
}
export function issueInvoice(invoice: Invoice) {
  return send<{ invoice: Invoice }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}/issue`,
    {
      method: "POST",
      body: {
        ...scope(),
        expectedRevision: invoice.revision,
        commandKey: command(),
      },
    },
  );
}
export function deleteInvoiceDraft(invoice: Invoice) {
  return send(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}/delete-draft`,
    {
      method: "POST",
      body: {
        ...scope(),
        expectedRevision: invoice.revision,
        commandKey: command(),
      },
    },
  );
}
export function duplicateInvoice(invoice: Invoice) {
  return send<{ invoice: Invoice }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}/duplicate`,
    { method: "POST", body: { ...scope(), commandKey: command() } },
  );
}
export function voidInvoice(invoice: Invoice, reason: string) {
  return send<{ invoice: Invoice }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}/void`,
    {
      method: "POST",
      body: {
        ...scope(),
        expectedRevision: invoice.revision,
        reason,
        commandKey: command(),
      },
    },
  );
}
export async function markInvoicePaid(
  invoice: Invoice,
  input: {
    transactionId?: string;
    paidOn: string;
    accountId?: string | null;
    paymentMethod?: string;
    reference?: string;
    mode?: "CREATE" | "LINK_EXISTING";
    expectedTransactionRevision?: number;
  },
) {
  const result = await send<{
    invoice: Invoice;
    payment: InvoicePayment;
    ledgerTransaction: Transaction;
    ledgerRevision: number;
  }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(invoice.id)}/mark-paid`,
    {
      method: "POST",
      body: {
        ...scope(),
        ...input,
        transactionId: input.transactionId || crypto.randomUUID(),
        expectedRevision: invoice.revision,
        mode: input.mode || "CREATE",
        commandKey: command(),
      },
    },
  );
  reconcileServerTransaction(result.ledgerTransaction);
  acceptServerTransactionRevision(result.ledgerTransaction.id, result.ledgerRevision);
  return result;
}
export async function correctInvoicePayment(
  payment: InvoicePayment,
  reason: string,
) {
  const result = await send<{
    invoice: Invoice;
    payment: InvoicePayment;
    ledgerTransaction: Transaction;
    ledgerRevision: number;
    ledgerDeleted: boolean;
  }>(
    `/api/jornal/invoicing/payments/${encodeURIComponent(payment.id)}/correct`,
    {
      method: "POST",
      body: {
        ...scope(),
        expectedRevision: payment.revision,
        reason,
        commandKey: command(),
      },
    },
  );
  if (result.ledgerDeleted)
    reconcileServerTransactionDeletion(result.ledgerTransaction);
  else reconcileServerTransaction(result.ledgerTransaction);
  acceptServerTransactionRevision(result.ledgerTransaction.id, result.ledgerRevision);
  return result;
}

export function listInvoiceReminders() {
  return cached("reminders", () => send<{
    items: Array<{
      id: string;
      invoiceId: string;
      status: "UNREAD" | "READ";
      scheduledLocalDate: string;
    }>;
  }>(`/api/jornal/invoicing/reminders?${query(scope())}`));
}
export function markInvoiceRemindersRead(ids: string[]) {
  return send<{ updated: number }>("/api/jornal/invoicing/reminders/read", {
    method: "POST",
    body: { ...scope(), ids },
  });
}

export interface InvoiceBackup {
  manifest: {
    format: "jornal-invoice-backup";
    version: 1;
    exportedAt: string;
    sourceCompanyName: string;
    activeLogoAssetId: string | null;
  };
  data: Record<string, unknown[]>;
  checksums: Record<string, string>;
}
export interface InvoiceBackupPreview {
  valid: boolean;
  counts: Record<string, number>;
  conflicts: Array<{ type: string; invoiceNumber?: string }>;
  invalidAssets: string[];
  requiredAccountIds: string[];
  willReplaceActiveLogo: boolean;
  remindersWillNotBeRestored: boolean;
  warnings: string[];
}
export function exportInvoiceBackup() {
  return send<InvoiceBackup>(`/api/jornal/invoicing/backup?${query(scope())}`);
}
export function previewInvoiceBackup(
  backup: InvoiceBackup,
  options: { replaceLogo: boolean; accountMap?: Record<string, string> },
) {
  return send<InvoiceBackupPreview>("/api/jornal/invoicing/backup/dry-run", {
    method: "POST",
    body: { ...scope(), backup, ...options },
  });
}
export function restoreInvoiceBackup(
  backup: InvoiceBackup,
  options: {
    replaceLogo: boolean;
    accountMap?: Record<string, string>;
    reason: string;
  },
) {
  return send<{
    restored: boolean;
    counts: { created: number; merged: number; skipped: number };
    remindersRestored: boolean;
    nextInvoiceNumber: number;
  }>("/api/jornal/invoicing/backup/restore", {
    method: "POST",
    body: {
      ...scope(),
      backup,
      ...options,
      confirm: true,
      commandKey: command(),
    },
  });
}

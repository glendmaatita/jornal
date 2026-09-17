import { activeCompany } from "./companies";
import { mirrorState, restoreState } from "./local-db";
import { pb, pocketBaseConfigured } from "./pb";
import {
  reconcileServerTransaction,
  reconcileServerTransactionDeletion,
} from "./store";
import type {
  Invoice,
  InvoiceCustomer,
  InvoiceItemInput,
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
  return pb.send<T>(path, { ...options, headers: { "X-Jornal-Protocol": "3" } });
}
function command() {
  return crypto.randomUUID();
}
function cacheKey(name: string) {
  const company = activeCompany();
  return `jornal.${pb.authStore.record?.id || "local"}.${company?.id || "none"}.${company?.dataEpoch || 0}.invoice.${name}.v1`;
}
async function cached<T>(key: string, load: () => Promise<T>) {
  try {
    const value = await load();
    await mirrorState(cacheKey(key), value);
    return value;
  } catch (error) {
    const value = await restoreState(cacheKey(key)).catch(() => undefined);
    if (value !== undefined) return value as T;
    throw error;
  }
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
  input: Omit<
    InvoiceCustomer,
    | "id"
    | "tenantId"
    | "companyId"
    | "dataEpoch"
    | "status"
    | "revision"
    | "createdAt"
    | "updatedAt"
  >,
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
  return send<{
    documentVersion: string;
    contentHash: string;
    invoice: Invoice;
  }>(
    `/api/jornal/invoicing/invoices/${encodeURIComponent(id)}/document?${query(scope())}`,
  );
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
  return result;
}

export function listInvoiceReminders() {
  return send<{
    items: Array<{
      id: string;
      invoiceId: string;
      status: "UNREAD" | "READ";
      scheduledLocalDate: string;
    }>;
  }>(`/api/jornal/invoicing/reminders?${query(scope())}`);
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

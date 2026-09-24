export const INVOICE_CURRENCY = "IDR" as const
export const QUANTITY_SCALE = 1_000
export const MAX_INVOICE_ITEMS = 100
export const MAX_INVOICE_TOTAL = 1_000_000_000_000

export type InvoiceStatus = "DRAFT" | "UNPAID" | "PAID" | "VOID"
export type InvoicePaymentOrigin = "CREATED" | "LINKED"
export type InvoicePaymentStatus = "ACTIVE" | "REVERSED"
export type InvoiceCustomerStatus = "ACTIVE" | "ARCHIVED"

export interface InvoiceCustomer {
  id: string
  tenantId: string
  companyId: string
  dataEpoch: number
  name: string
  email: string | null
  phone: string | null
  addressLine1: string | null
  addressLine2: string | null
  district: string | null
  city: string | null
  province: string | null
  postalCode: string | null
  status: InvoiceCustomerStatus
  revision: number
  createdAt: string
  updatedAt: string
}

export interface InvoiceUnit {
  id: string
  label: string
  status: InvoiceCustomerStatus
  sortOrder: number
  revision: number
}

export interface InvoiceItemInput {
  id?: string
  /** Stable identity of an item selected from the product history. */
  productKey?: string | null
  description: string
  /** Integer thousandths. For example, 2.5 units is 2500. */
  quantityScaled: number
  unitId?: string | null
  unitLabel: string
  unitPrice: number
  sortOrder: number
}

export interface InvoiceItem extends InvoiceItemInput {
  id: string
  lineTotal: number
}

export interface InvoiceProductSuggestion {
  productKey: string
  description: string
  unitId: string | null
  unitLabel: string
  unitPrice: number
  lastUsedAt: string
}

export interface InvoiceTotals {
  subtotal: number
  baseAmount: number
  taxAmount: number
  grandTotal: number
}

export interface InvoicePaymentInstruction {
  accountId?: string | null
  name: string
  accountNumber: string
  accountHolder: string
}

export interface InvoiceSettings {
  senderName: string
  senderPhone: string | null
  senderEmail: string | null
  defaultUnitId: string | null
  defaultDueDays: number
  numberingPrefix: string
  numberingPadding: number
  numberingStart: number
  paymentInstructions: InvoicePaymentInstruction[]
  defaultAccountId: string | null
  reminderEnabled: boolean
  reminderTimezone: string
  reminderHour: number
  reminderRepeatDays: number
  revision: number
}

export interface Invoice {
  id: string
  tenantId: string
  companyId: string
  dataEpoch: number
  customerId: string
  status: InvoiceStatus
  sequence: number | null
  invoiceNumber: string | null
  issueDate: string
  dueDate: string
  timezone: string
  customerSnapshot: Record<string, unknown> | null
  senderSnapshot: Record<string, unknown> | null
  paymentInstructionsSnapshot: InvoicePaymentInstruction[] | null
  items: InvoiceItem[]
  shippingMethod: string | null
  subtotal: number
  discountAmount: number
  shippingAmount: number
  taxRateBps: number
  taxAmount: number
  grandTotal: number
  currency: typeof INVOICE_CURRENCY
  paidAt: string | null
  voidReason: string | null
  replacedInvoiceId: string | null
  revision: number
  createdAt: string
  updatedAt: string
}

export function isInvoiceOverdue(invoice: Pick<Invoice, "status" | "dueDate">, today: string) {
  return invoice.status === "UNPAID" && invoice.dueDate < today
}

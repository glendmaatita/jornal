export type DocumentSource = "CAMERA" | "UPLOAD" | "SHARE_TARGET"
export type DocumentStatus = "UNPROCESSED" | "REVIEW_READY" | "LINKED" | "ARCHIVED"
export type DocumentJobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN"

export interface LocalDocumentDraft {
  id: string
  tenantId: string | null
  companyId: string | null
  source: DocumentSource
  filename: string
  mimeType: string
  byteSize: number
  status: DocumentStatus
  createdAt: string
  updatedAt: string
  /** File is still held only by this browser until server upload succeeds. */
  localOnly: boolean
  serverDocumentId: string | null
}

export interface ServerDocument {
  id: string; tenantId: string; companyId: string; dataEpoch: number; source: DocumentSource; filename: string; mimeType: string; byteSize: number; sha256: string; status: DocumentStatus; duplicateOfId: string | null; linkedTransactionId: string | null; linkedPaymentId: string | null; revision: number; createdAt: string; updatedAt: string
}

export interface DocumentExtraction {
  documentType: "RECEIPT" | "TRANSFER_RECEIPT" | "INVOICE" | "OTHER"
  currency: string | null; amount: string | null; feeAmount: string | null; debitedAmount: string | null; transactionDate: string | null; merchantName: string | null; senderName: string | null; recipientName: string | null; bankName: string | null; accountLastDigits: string | null; reference: string | null; directionHint: "MONEY_IN" | "MONEY_OUT" | "UNKNOWN"; description: string | null; fieldEvidence: Array<{ field: string; text: string; page: number }>; uncertainFields: string[]; warnings: string[]
}

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Invoice } from "@/lib/invoice-types";
import { InvoiceDocument } from "./invoice-document";

const invoice: Invoice = {
  id: "invoice-test",
  tenantId: "tenant",
  companyId: "company",
  dataEpoch: 1,
  customerId: "customer",
  status: "UNPAID",
  sequence: 1,
  invoiceNumber: "2026/09/INV/001",
  issueDate: "2026-09-24",
  dueDate: "2026-10-01",
  timezone: "Asia/Jakarta",
  customerSnapshot: { name: "Pelanggan" },
  senderSnapshot: { name: "Dropify" },
  paymentInstructionsSnapshot: [],
  items: [{
    id: "item",
    description: "Barang",
    quantityScaled: 1_000,
    unitLabel: "pcs",
    unitPrice: 10_000,
    sortOrder: 0,
    lineTotal: 10_000,
  }],
  shippingMethod: null,
  subtotal: 10_000,
  discountAmount: 0,
  shippingAmount: 0,
  taxRateBps: 0,
  taxAmount: 0,
  grandTotal: 10_000,
  currency: "IDR",
  paidAt: null,
  voidReason: null,
  replacedInvoiceId: null,
  revision: 2,
  createdAt: "2026-09-24T00:00:00Z",
  updatedAt: "2026-09-24T00:00:00Z",
};

test("invoice document visibly marks void invoices", () => {
  expect(renderToStaticMarkup(<InvoiceDocument invoice={invoice} />)).not.toContain("DIBATALKAN");
  expect(
    renderToStaticMarkup(
      <InvoiceDocument invoice={{ ...invoice, status: "VOID", voidReason: "Invoice diganti" }} />,
    ),
  ).toContain("DIBATALKAN");
});

test("invoice document uses the dense A4 layout for seven to ten items", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({
    ...invoice.items[0],
    id: `item-${index + 1}`,
    description: `Barang ${index + 1}`,
    sortOrder: index,
  }));
  const html = renderToStaticMarkup(<InvoiceDocument invoice={{ ...invoice, items }} />);
  expect(html).toContain("invoice-paper-compact invoice-paper-dense");
});

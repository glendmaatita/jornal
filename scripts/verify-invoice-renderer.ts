import assert from "node:assert/strict"
import type { Invoice } from "../src/lib/invoice-types"

const port = 31_000 + Math.floor(Math.random() * 1_000); const secret = "renderer-smoke-secret"
const processHandle = Bun.spawn(["bun", "run", "services/invoice-renderer/server.tsx"], { env: { ...process.env, PORT: String(port), INVOICE_RENDERER_SECRET: secret }, stdout: "inherit", stderr: "inherit" })
const invoice: Invoice = { id: "renderer-smoke", tenantId: "tenant", companyId: "company", dataEpoch: 1, customerId: "customer", status: "UNPAID", sequence: 1, invoiceNumber: "001", issueDate: "2026-09-17", dueDate: "2026-09-24", timezone: "Asia/Jakarta", customerSnapshot: { name: "Pelanggan Uji", phone: "08123456789", addressLine1: "Jl. Pengujian 1", city: "Jakarta" }, senderSnapshot: { name: "Toko Uji", phone: "081111111", email: "info@example.test" }, paymentInstructionsSnapshot: [{ name: "Bank Uji", accountNumber: "123456", accountHolder: "Toko Uji" }], items: [{ id: "item", description: "Barang uji", quantityScaled: 2_000, unitLabel: "pcs", unitPrice: 100_000, sortOrder: 0, lineTotal: 200_000 }], shippingMethod: null, subtotal: 200_000, discountAmount: 0, shippingAmount: 0, taxRateBps: 0, taxAmount: 0, grandTotal: 200_000, currency: "IDR", paidAt: null, voidReason: null, replacedInvoiceId: null, revision: 2, createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z" }
try {
  let ready = false; for (let attempt = 0; attempt < 100; attempt += 1) { const response = await fetch(`http://127.0.0.1:${port}/healthz`).catch(() => null); if (response?.ok) { ready = true; break }; await Bun.sleep(100) }; if (!ready) throw new Error("Renderer tidak siap")
  console.log(`invoice renderer ready on ${port}`)
  const render = async (format: "pdf" | "png") => { const response = await fetch(`http://127.0.0.1:${port}/render`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ invoice, format }), signal: AbortSignal.timeout(45_000) }); const bytes = new Uint8Array(await response.arrayBuffer()); assert.equal(response.status, 200); assert.ok(bytes.byteLength > 1_000); return bytes }
  const pdf = await render("pdf"); assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-")
  const png = await render("png"); assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(png.buffer, png.byteOffset, png.byteLength); assert.equal(view.getUint32(16), 1240); assert.ok(view.getUint32(20) >= 1754)
  console.log(`invoice renderer smoke passed: PDF ${pdf.byteLength} bytes, PNG ${png.byteLength} bytes (${view.getUint32(16)}x${view.getUint32(20)})`)
} finally { processHandle.kill(); await Promise.race([processHandle.exited, Bun.sleep(2_000)]) }

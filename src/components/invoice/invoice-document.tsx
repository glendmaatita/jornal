import type { Invoice, InvoiceCustomer } from "../../lib/invoice-types"
import { formatDateLong, formatInvoiceNumber, formatRupiah } from "../../lib/format"

function value(snapshot: Record<string, unknown> | null, key: string) {
  return String(snapshot?.[key] ?? "")
}

function formatInvoicePrice(amount: number) {
  return formatRupiah(amount).replace(/^Rp/, "Rp ")
}

function formatTaxRate(rateBps: number) {
  return (rateBps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })
}

export function InvoiceDocument({ invoice, customer, logoDataUrl }: { invoice: Invoice; customer?: InvoiceCustomer | null; logoDataUrl?: string | null }) {
  const customerSnapshot = invoice.customerSnapshot
  const customerName = value(customerSnapshot, "name") || customer?.name || "-"
  const customerPhone = value(customerSnapshot, "phone") || customer?.phone || ""
  const address = [
    value(customerSnapshot, "addressLine1") || customer?.addressLine1,
    value(customerSnapshot, "addressLine2") || customer?.addressLine2,
    value(customerSnapshot, "district") || customer?.district,
    value(customerSnapshot, "city") || customer?.city,
    value(customerSnapshot, "province") || customer?.province,
    value(customerSnapshot, "postalCode") || customer?.postalCode,
  ].filter(Boolean).join(" ")
  const sender = invoice.senderSnapshot
  const invoiceNumber = formatInvoiceNumber(invoice.invoiceNumber, invoice.sequence, invoice.issueDate)
  const densityClass = invoice.items.length >= 7
    ? " invoice-paper-compact invoice-paper-dense"
    : invoice.items.length >= 4
      ? " invoice-paper-compact"
      : ""
  const rows = [
    ...invoice.items,
    ...Array.from({ length: Math.max(0, 3 - invoice.items.length) }, (_, index) => ({
      id: `blank-${index}`,
      description: "",
      quantityScaled: 0,
      unitLabel: "",
      unitPrice: 0,
      lineTotal: 0,
      sortOrder: 99,
    })),
  ]

  return (
    <article className={`invoice-paper${densityClass}`} data-invoice-document>
      <style>{INVOICE_CSS}</style>
      <header className="invoice-topbar">
        <div className="invoice-logo-wrap">
          {logoDataUrl
            ? <img src={logoDataUrl} alt={value(sender, "name")} className="invoice-tenant-logo" />
            : <div className="invoice-logo-fallback">{value(sender, "name") || "Company"}</div>}
        </div>
        <h1 className="invoice-title">INVOICE</h1>
      </header>

      <section className="invoice-info-row" aria-label="Invoice details">
        <div className="invoice-bill-to">
          <div className="invoice-label">Kepada :</div>
          <div className="invoice-customer-name">{customerName}</div>
          {customerPhone && <div className="invoice-customer-phone">{customerPhone}</div>}
          <div className="invoice-customer-address">{address}</div>
        </div>
        <div className="invoice-date-stack">
          <div className="invoice-date-card">
            <strong>No : {invoiceNumber || "DRAFT"}</strong>
            <span>Tgl : {formatDateLong(invoice.issueDate)}</span>
          </div>
          <div className="invoice-date-card">
            <strong>Jatuh Tempo :</strong>
            <span>Tgl : {formatDateLong(invoice.dueDate)}</span>
          </div>
        </div>
      </section>

      <table className="invoice-items-table">
        <thead>
          <tr>
            <th className="invoice-no-col">NO</th>
            <th>DESKRIPSI</th>
            <th className="invoice-qty-col">JUMLAH</th>
            <th className="invoice-price-col">HARGA</th>
            <th className="invoice-total-col">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.id}>
              <td className="invoice-no-cell">{index + 1}</td>
              <td><span className="invoice-description">{item.description}</span></td>
              <td className="invoice-qty-cell">{item.description ? `${(item.quantityScaled / 1000).toLocaleString("id-ID")} ${item.unitLabel}` : ""}</td>
              <td className="invoice-money-cell">{item.description ? formatInvoicePrice(item.unitPrice) : ""}</td>
              <td className="invoice-money-cell">{item.description ? formatInvoicePrice(item.lineTotal) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-summary-divider" />

      <section className="invoice-summary-row">
        <div>
          <div className="invoice-payment-title">Metode Pembayaran</div>
          <div className="invoice-payment-details">
            {(invoice.paymentInstructionsSnapshot ?? []).map((item, index) => (
              <div className="invoice-payment-account" key={item.accountId || `${item.accountNumber}-${index}`}>
                {item.name && <span>{item.name}</span>}{item.name && item.accountNumber && " "}
                {item.accountNumber && <span className="invoice-payment-account-number">{item.accountNumber}</span>}
                {item.accountNumber && item.accountHolder && " "}
                {item.accountHolder && <span>a.n&nbsp;&nbsp;{item.accountHolder}</span>}
              </div>
            ))}
          </div>
          {invoice.shippingMethod && (
            <div className="invoice-shipping-method">
              <div className="invoice-shipping-title">Metode Pengiriman</div>
              <div className="invoice-shipping-value">{invoice.shippingMethod}</div>
            </div>
          )}
        </div>
        <div className="invoice-totals">
          <div className="invoice-total-line"><span>Total</span><span>{formatInvoicePrice(invoice.subtotal)}</span></div>
          <div className="invoice-total-line"><span>Diskon</span><span>{invoice.discountAmount ? formatInvoicePrice(invoice.discountAmount) : "0"}</span></div>
          {invoice.shippingAmount > 0 && <div className="invoice-total-line"><span>Pengiriman</span><span>{formatInvoicePrice(invoice.shippingAmount)}</span></div>}
          <div className="invoice-total-line"><span>Pajak {formatTaxRate(invoice.taxRateBps)}%</span><span>{invoice.taxAmount ? formatInvoicePrice(invoice.taxAmount) : "0"}</span></div>
        </div>
      </section>

      <section className="invoice-grand-total">
        <span>Total Keseluruhan</span>
        <span>{formatInvoicePrice(invoice.grandTotal)}</span>
      </section>

      <footer className="invoice-footer">
        <div className="invoice-payment-confirm">
          <div>Konfirmasi Pembayaran</div>
          {value(sender, "phone") && <strong>{value(sender, "phone")}</strong>}
        </div>
        {value(sender, "email") && <div className="invoice-footer-email">{value(sender, "email")}</div>}
      </footer>
      {invoice.status === "VOID" && <div className="invoice-status-marker">DIBATALKAN</div>}
    </article>
  )
}

export const INVOICE_CSS = `
.invoice-paper{position:relative;box-sizing:border-box;width:210mm;min-height:297mm;margin:0 auto;padding:8mm 21mm 16mm;background:#fff;color:#111;font-family:Poppins,Montserrat,"Segoe UI",Arial,sans-serif;font-size:13px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.invoice-paper *{box-sizing:border-box}
.invoice-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18mm}
.invoice-logo-wrap{width:82mm;min-height:24mm;display:flex;align-items:flex-start}
.invoice-tenant-logo{display:block;max-width:82mm;max-height:24mm;object-fit:contain;object-position:left top}
.invoice-logo-fallback{color:#1d73e8;font-size:31px;font-weight:800;line-height:1}
.invoice-title{margin:0;color:#000;font-size:60px;font-weight:900;line-height:1;text-align:right;text-transform:uppercase}
.invoice-info-row{display:grid;grid-template-columns:minmax(0,1fr) 48mm;gap:14mm;margin-top:5mm;align-items:start}
.invoice-date-stack{width:48mm}
.invoice-date-card{background:#d9d9d9;min-height:16.5mm;padding:2.8mm 3.5mm;text-align:right}
.invoice-date-card+.invoice-date-card{margin-top:5mm}
.invoice-date-card strong{display:block;color:#111;font-size:12.5px;font-weight:800;white-space:nowrap}
.invoice-date-card span{display:block;color:#111;font-size:13px;margin-top:1.5mm;white-space:nowrap}
.invoice-bill-to{max-width:126mm;padding-top:12.5mm}
.invoice-label{font-size:13px;font-weight:500;margin-bottom:4mm}
.invoice-customer-name{font-size:23px;font-weight:900;line-height:1.1;margin-bottom:1mm}
.invoice-customer-phone{font-size:13.5px;margin-bottom:4mm}
.invoice-customer-address{max-width:137mm;font-size:13.5px;line-height:1.25}
.invoice-items-table{width:100%;table-layout:fixed;border-collapse:collapse;margin-top:8mm}
.invoice-items-table thead{display:table-header-group}
.invoice-items-table thead tr,.invoice-items-table th{background-color:#d9d9d9}
.invoice-items-table tr{break-inside:avoid;page-break-inside:avoid}
.invoice-items-table th{height:13.5mm;padding:0 5mm;color:#000;font-size:12.5px;font-weight:900;text-align:left;vertical-align:middle}
.invoice-items-table th.invoice-no-col{width:14mm;text-align:center}
.invoice-items-table th.invoice-qty-col{width:37mm;text-align:center}
.invoice-items-table th.invoice-price-col,.invoice-items-table th.invoice-total-col{width:36mm;text-align:right}
.invoice-items-table td{height:18.5mm;padding:2mm 5mm;border-bottom:1.2px solid #111;font-size:13.5px;vertical-align:middle;overflow-wrap:anywhere}
.invoice-description{display:block;white-space:pre-wrap}
.invoice-items-table tbody tr:last-child td{border-bottom:0}
.invoice-items-table td.invoice-no-cell,.invoice-items-table td.invoice-qty-cell{text-align:center}
.invoice-items-table td.invoice-money-cell{text-align:right;white-space:nowrap}
.invoice-summary-divider{height:10mm;margin-top:2mm;background:#d9d9d9}
.invoice-summary-row{display:grid;grid-template-columns:1fr 1fr;gap:14mm;padding:4mm 5mm 1mm}
.invoice-payment-title,.invoice-shipping-title{font-size:15.5px;font-weight:900;margin-bottom:2mm}
.invoice-payment-details{min-height:27mm;color:#111;font-size:11.5px;line-height:1.45}
.invoice-payment-account+.invoice-payment-account{margin-top:4.5mm}
.invoice-payment-account-number{color:#1d73e8}
.invoice-shipping-method{margin-top:5mm}
.invoice-shipping-value{color:#111;font-size:11.5px;line-height:1.45}
.invoice-totals{display:grid;row-gap:4.2mm;font-size:18px}
.invoice-total-line{display:grid;grid-template-columns:1fr 38mm;align-items:baseline;gap:7mm}
.invoice-total-line span:first-child{white-space:nowrap}
.invoice-total-line span:last-child{text-align:right;white-space:nowrap}
.invoice-grand-total{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10mm;margin-top:1mm;padding:4.5mm 5mm;background:#d9d9d9}
.invoice-grand-total span{color:#000;font-size:22px;font-weight:900;line-height:1}
.invoice-footer{display:flex;justify-content:space-between;align-items:flex-start;gap:15mm;margin-top:29mm;padding:0 5mm}
.invoice-payment-confirm{font-size:14px}
.invoice-payment-confirm strong{display:block;font-size:15px;font-weight:900}
.invoice-footer-email{color:#1d73e8;font-size:15px;font-weight:900;text-align:right}
.invoice-status-marker{position:absolute;left:21mm;right:21mm;top:46%;z-index:2;transform:rotate(-16deg);border:3px solid rgba(180,0,0,.28);color:rgba(180,0,0,.32);font-size:52px;font-weight:900;letter-spacing:.08em;line-height:1.25;text-align:center;pointer-events:none}
.invoice-paper-compact .invoice-items-table{margin-top:6mm}
.invoice-paper-compact .invoice-items-table th{height:12mm}
.invoice-paper-compact .invoice-items-table td{height:13.5mm}
.invoice-paper-compact .invoice-summary-divider{height:8mm;margin-top:1.5mm}
.invoice-paper-compact .invoice-summary-row{padding-top:3mm}
.invoice-paper-compact .invoice-payment-details{min-height:21mm;font-size:10.8px}
.invoice-paper-compact .invoice-payment-account+.invoice-payment-account{margin-top:3mm}
.invoice-paper-compact .invoice-shipping-method{margin-top:3.5mm}
.invoice-paper-compact .invoice-shipping-value{font-size:10.8px}
.invoice-paper-compact .invoice-totals{row-gap:3.4mm;font-size:17px}
.invoice-paper-compact .invoice-grand-total{padding-top:4mm;padding-bottom:4mm}
.invoice-paper-compact .invoice-footer{margin-top:16mm}
.invoice-paper-dense{padding-top:7mm;padding-bottom:10mm}
.invoice-paper-dense .invoice-topbar{gap:14mm}
.invoice-paper-dense .invoice-logo-wrap{min-height:20mm}
.invoice-paper-dense .invoice-tenant-logo{max-height:20mm}
.invoice-paper-dense .invoice-logo-fallback{font-size:27px}
.invoice-paper-dense .invoice-title{font-size:52px}
.invoice-paper-dense .invoice-info-row{gap:10mm;margin-top:3mm}
.invoice-paper-dense .invoice-date-card{min-height:14mm;padding:2mm 3mm}
.invoice-paper-dense .invoice-date-card+.invoice-date-card{margin-top:3mm}
.invoice-paper-dense .invoice-date-card strong{font-size:11px}
.invoice-paper-dense .invoice-date-card span{font-size:11.5px;margin-top:1mm}
.invoice-paper-dense .invoice-bill-to{padding-top:8mm}
.invoice-paper-dense .invoice-label{font-size:11.5px;margin-bottom:2mm}
.invoice-paper-dense .invoice-customer-name{font-size:20px}
.invoice-paper-dense .invoice-customer-phone{font-size:11.5px;margin-bottom:2mm}
.invoice-paper-dense .invoice-customer-address{font-size:11.5px;line-height:1.2}
.invoice-paper-dense .invoice-items-table{margin-top:4mm}
.invoice-paper-dense .invoice-items-table th{height:9.5mm;padding:0 3mm;font-size:11px}
.invoice-paper-dense .invoice-items-table td{height:10.5mm;padding:1.5mm 3mm;font-size:11.5px;line-height:1.15}
.invoice-paper-dense .invoice-summary-divider{height:5.5mm;margin-top:1mm}
.invoice-paper-dense .invoice-summary-row{gap:10mm;padding:2.5mm 3mm 0}
.invoice-paper-dense .invoice-payment-title,.invoice-paper-dense .invoice-shipping-title{font-size:13px;margin-bottom:1mm}
.invoice-paper-dense .invoice-payment-details{min-height:12mm;font-size:9.5px;line-height:1.25}
.invoice-paper-dense .invoice-payment-account+.invoice-payment-account{margin-top:1mm}
.invoice-paper-dense .invoice-shipping-method{margin-top:1.5mm}
.invoice-paper-dense .invoice-shipping-value{font-size:9.5px;line-height:1.25}
.invoice-paper-dense .invoice-totals{row-gap:1.5mm;font-size:14px}
.invoice-paper-dense .invoice-total-line{grid-template-columns:1fr 34mm;gap:5mm}
.invoice-paper-dense .invoice-grand-total{margin-top:.5mm;padding:3mm}
.invoice-paper-dense .invoice-grand-total span{font-size:18px}
.invoice-paper-dense .invoice-footer{margin-top:7mm;padding:0 3mm}
.invoice-paper-dense .invoice-payment-confirm{font-size:12px}
.invoice-paper-dense .invoice-payment-confirm strong,.invoice-paper-dense .invoice-footer-email{font-size:13px}
@media(max-width:850px){.invoice-paper{transform-origin:top left}}
@media print{@page{size:A4 portrait;margin:8mm 21mm 16mm}html,body{width:auto;min-height:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.invoice-paper{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.invoice-date-card,.invoice-items-table thead tr,.invoice-items-table th,.invoice-summary-divider,.invoice-grand-total{background-color:#d9d9d9;-webkit-print-color-adjust:exact;print-color-adjust:exact}.invoice-items-table{break-inside:auto;page-break-inside:auto}.invoice-summary-divider{break-after:avoid;page-break-after:avoid}.invoice-topbar,.invoice-info-row,.invoice-summary-row,.invoice-grand-total,.invoice-footer{break-inside:avoid;page-break-inside:avoid}}
`

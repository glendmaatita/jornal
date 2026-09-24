const DEFAULT_UNITS = ["pcs", "Lusin", "Kodi", "box", "pak", "set", "kg", "meter", "jam", "unit"]
const MAX_TOTAL = 1_000_000_000_000
const QUANTITY_SCALE = 1_000
let invoiceRequestActor = null

function jsonBody(event) { return event.requestInfo().body || {} }
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
}
function commandHash(action, body) { return $security.sha256(`${action}:${stableStringify(body)}`) }
function requireText(value, label, maximum, required) {
  const text = String(value || "").trim()
  if (required && !text) throw new ApiError(400, `${label} wajib diisi`)
  if (text.length > maximum) throw new ApiError(400, `${label} terlalu panjang`)
  return text
}
function isoDate(value, label) {
  const result = String(value || "")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new ApiError(400, `${label} tidak valid`)
  return result
}
function int(value, label, min, max) {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new ApiError(400, `${label} tidak valid`)
  return result
}
function normalize(value) { return String(value || "").trim().toLowerCase() }
function normalizePhone(value) { return String(value || "").replace(/[^0-9+]/g, "") }
function customerInput(body) {
  const email = requireText(body.email, "Email", 255, false)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Format email tidak valid")
  const phone = requireText(body.phone, "Telepon", 50, false)
  return {
    name: requireText(body.name, "Nama pelanggan", 255, true), email, normalized_email: normalize(email), phone, normalized_phone: normalizePhone(phone),
    address_line1: requireText(body.addressLine1, "Alamat", 255, false), address_line2: requireText(body.addressLine2, "Alamat", 255, false),
    district: requireText(body.district, "Kecamatan", 255, false), city: requireText(body.city, "Kota", 255, false), province: requireText(body.province, "Provinsi", 255, false), postal_code: requireText(body.postalCode, "Kode pos", 30, false),
  }
}
function paymentInstructionsInput(value) {
  if (!Array.isArray(value)) throw new ApiError(400, "Daftar rekening pembayaran tidak valid")
  if (value.length > 3) throw new ApiError(400, "Maksimal 3 rekening pembayaran aktif")
  return value.map((item) => ({
    accountId: requireText(item && item.accountId, "ID rekening pembayaran", 100, false) || undefined,
    name: requireText(item && item.name, "Nama bank atau penyedia", 80, true),
    accountNumber: requireText(item && item.accountNumber, "Nomor rekening", 100, true),
    accountHolder: requireText(item && item.accountHolder, "Nama pemilik rekening", 100, true),
  }))
}
function activePaymentInstructions(tx, settings, tenantId, companyId, epoch) {
  return paymentInstructionsInput(json(settings, "payment_instructions", [])).flatMap((instruction) => {
    if (!instruction.accountId) return [instruction]
    let account
    try { account = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'accounts' && app_id = {:id} && deleted_at = ''", { tenant: tenantId, company: companyId, epoch, id: instruction.accountId }) }
    catch { return [] }
    const payload = json(account, "payload", {})
    if (payload.enabled === false) return []
    return [{
      accountId: instruction.accountId,
      name: String(payload.bankName || payload.name || instruction.name).trim(),
      accountNumber: String(payload.accountNumber || instruction.accountNumber).trim(),
      accountHolder: String(payload.accountHolder || instruction.accountHolder).trim(),
    }]
  })
}
function json(record, field, fallback) {
  const raw = record.get(field)
  if (Array.isArray(raw) || (raw && typeof raw === "object" && typeof raw.length === "number" && typeof raw[0] === "number")) { try { return JSON.parse(String.fromCharCode(...raw)) } catch { return fallback } }
  if (raw && typeof raw === "object" && typeof raw.get !== "function") return raw
  try { const exported = JSON.parse(JSON.stringify(record.publicExport())); if (Array.isArray(exported[field]) && exported[field].every((item) => typeof item === "number")) return JSON.parse(String.fromCharCode(...exported[field])); if (exported[field] !== undefined && exported[field] !== null) return exported[field] } catch { /* string fallback */ }
  try { return JSON.parse(record.getString(field)) } catch { return fallback }
}
function ownedCompany(app, tenantId, companyId, epoch, writable) {
  let company
  try { company = app.findRecordById("companies", companyId) } catch { throw new ApiError(404, "Company tidak ditemukan") }
  if (company.getString("tenant_id") !== tenantId) throw new ApiError(404, "Company tidak ditemukan")
  if (epoch !== undefined && Number(epoch) !== company.getInt("data_epoch")) throw new ApiError(409, "Data company sudah berubah; muat ulang terlebih dahulu")
  if (writable && company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company diarsipkan")
  return company
}
function requestScope(event, body, writable) {
  require(`${__hooks}/company_access.js`).requireProtocol(event)
  const companyId = String(body.companyId || "")
  const epoch = Number(body.dataEpoch || 0)
  if (!companyId || !Number.isSafeInteger(epoch) || epoch < 1) throw new ApiError(400, "companyId dan dataEpoch wajib diisi")
  const access = require(`${__hooks}/company_access.js`).eventScope(event, companyId, { epoch, writable })
  invoiceRequestActor = { actorId: event.auth.id, tenantId: access.ownerTenantId, at: Date.now() }
  return { actorUserId: event.auth.id, tenantId: access.ownerTenantId, companyId, epoch }
}
function requireCommand(body) {
  const key = String(body.commandKey || "")
  if (!key || key.length > 100) throw new ApiError(400, "commandKey wajib diisi")
  return key
}
function ownedRecord(app, collection, id, tenantId, companyId, epoch, label) {
  let record
  try { record = app.findRecordById(collection, id) } catch { throw new ApiError(404, `${label} tidak ditemukan`) }
  if (record.getString("tenant_id") !== tenantId || record.getString("company_id") !== companyId || record.getInt("data_epoch") !== epoch) throw new ApiError(404, `${label} tidak ditemukan`)
  return record
}
function customerResponse(record) {
  return {
    id: record.id, tenantId: record.getString("tenant_id"), companyId: record.getString("company_id"), dataEpoch: record.getInt("data_epoch"),
    name: record.getString("name"), email: record.getString("email") || null, phone: record.getString("phone") || null,
    addressLine1: record.getString("address_line1") || null, addressLine2: record.getString("address_line2") || null,
    district: record.getString("district") || null, city: record.getString("city") || null, province: record.getString("province") || null,
    postalCode: record.getString("postal_code") || null, status: record.getString("status"), revision: record.getInt("revision"),
    createdAt: record.getString("created"), updatedAt: record.getString("updated"),
  }
}
function invoiceResponse(record) {
  return {
    id: record.id, tenantId: record.getString("tenant_id"), companyId: record.getString("company_id"), dataEpoch: record.getInt("data_epoch"), customerId: record.getString("customer_id"),
    status: record.getString("status"), sequence: record.getInt("sequence") || null, invoiceNumber: record.getString("invoice_number") || null,
    issueDate: record.getString("issue_date"), dueDate: record.getString("due_date"), timezone: record.getString("timezone"),
    customerSnapshot: json(record, "customer_snapshot", null), senderSnapshot: json(record, "sender_snapshot", null), paymentInstructionsSnapshot: json(record, "payment_instructions_snapshot", null),
    items: json(record, "items", []), shippingMethod: record.getString("shipping_method") || null, subtotal: record.getInt("subtotal"), discountAmount: record.getInt("discount_amount"),
    shippingAmount: record.getInt("shipping_amount"), taxRateBps: record.getInt("tax_rate_bps"), taxAmount: record.getInt("tax_amount"), grandTotal: record.getInt("grand_total"),
    currency: record.getString("currency"), paidAt: record.getString("paid_at") || null, voidReason: record.getString("void_reason") || null, replacedInvoiceId: record.getString("replaced_invoice_id") || null,
    revision: record.getInt("revision"), createdAt: record.getString("created"), updatedAt: record.getString("updated"),
  }
}
function invoiceNumberForDisplay(record) {
  const raw = record.getString("invoice_number")
  if (!raw || /^\d{4}\/\d{2}\/INV\/.+$/i.test(raw)) return raw
  if (!/^\d+$/.test(raw) || !record.getInt("sequence")) return raw
  const parts = record.getString("issue_date").split("-")
  if (!/^\d{4}$/.test(parts[0] || "") || !/^\d{2}$/.test(parts[1] || "")) return raw
  return `${parts[0]}/${parts[1]}/INV/${raw}`
}
function unitResponse(record) {
  return { id: record.id, label: record.getString("label"), status: record.getString("status"), sortOrder: record.getInt("sort_order"), revision: record.getInt("revision") }
}
function settingsResponse(record) {
  return {
    senderName: record.getString("sender_name"), senderPhone: record.getString("sender_phone") || null, senderEmail: record.getString("sender_email") || null,
    defaultUnitId: record.getString("default_unit_id") || null, defaultDueDays: record.getInt("default_due_days"), numberingPrefix: record.getString("numbering_prefix"), numberingStart: record.getInt("numbering_start") || 1,
    numberingPadding: record.getInt("numbering_padding"), paymentInstructions: json(record, "payment_instructions", []), defaultAccountId: record.getString("default_account_id") || null,
    reminderEnabled: record.getBool("reminder_enabled"), reminderTimezone: record.getString("reminder_timezone"), reminderHour: record.getInt("reminder_hour"),
    reminderRepeatDays: record.getInt("reminder_repeat_days"), revision: record.getInt("revision"),
  }
}
function paymentResponse(record) {
  return { id: record.id, invoiceId: record.getString("invoice_id"), amount: record.getInt("amount"), paidOn: record.getString("paid_on"), accountId: record.getString("account_id") || null, ledgerTransactionId: record.getString("ledger_transaction_id"), origin: record.getString("origin"), status: record.getString("status"), reference: record.getString("reference") || null, revision: record.getInt("revision") }
}
function roundHalfUp(numerator, divisor) {
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(divisor) || divisor <= 0 || numerator > Number.MAX_SAFE_INTEGER - Math.floor(divisor / 2)) throw new ApiError(400, "Nilai invoice terlalu besar")
  return Math.floor((numerator + Math.floor(divisor / 2)) / divisor)
}
function multiply(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || (a && b > Math.floor(Number.MAX_SAFE_INTEGER / a))) throw new ApiError(400, "Nilai invoice terlalu besar")
  return a * b
}
function add(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || a > Number.MAX_SAFE_INTEGER - b) throw new ApiError(400, "Nilai invoice terlalu besar")
  return a + b
}
function calculateItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) throw new ApiError(400, "Invoice harus memiliki 1–100 item")
  return rawItems.map((item, index) => {
    const description = requireText(item && item.description, "Deskripsi item", 500, true)
    const quantityScaled = int(item && item.quantityScaled, "Kuantitas", 1, 1_000_000 * QUANTITY_SCALE)
    const unitPrice = int(item && item.unitPrice, "Harga satuan", 0, 1_000_000_000)
    const unitLabel = requireText(item && item.unitLabel, "Satuan", 20, true)
    const sortOrder = int(item && (item.sortOrder === undefined ? index : item.sortOrder), "Urutan item", 0, 99)
    return { id: requireText(item && item.id, "ID item", 100, false) || $security.randomString(20), description, quantityScaled, unitId: requireText(item && item.unitId, "ID satuan", 100, false) || null, unitLabel, unitPrice, sortOrder, lineTotal: roundHalfUp(multiply(quantityScaled, unitPrice), QUANTITY_SCALE) }
  }).sort((a, b) => a.sortOrder - b.sortOrder)
}
function calculateInvoice(body) {
  const items = calculateItems(body.items)
  const subtotal = items.reduce((sum, item) => add(sum, item.lineTotal), 0)
  const discountAmount = int(body.discountAmount || 0, "Diskon", 0, MAX_TOTAL)
  const shippingAmount = int(body.shippingAmount || 0, "Ongkir", 0, MAX_TOTAL)
  const taxRateBps = int(body.taxRateBps || 0, "Tarif pajak", 0, 10_000)
  if (discountAmount > subtotal) throw new ApiError(400, "Diskon tidak boleh melebihi subtotal")
  const baseAmount = add(subtotal - discountAmount, shippingAmount)
  const taxAmount = roundHalfUp(multiply(baseAmount, taxRateBps), 10_000)
  const grandTotal = add(baseAmount, taxAmount)
  if (grandTotal <= 0 || grandTotal > MAX_TOTAL) throw new ApiError(400, "Total invoice harus lebih dari nol dan maksimal Rp1 triliun")
  return { items, subtotal, discountAmount, shippingAmount, taxRateBps, taxAmount, grandTotal }
}
function invoiceInput(body) {
  const issueDate = isoDate(body.issueDate, "Tanggal invoice")
  const dueDate = isoDate(body.dueDate, "Tanggal jatuh tempo")
  if (dueDate < issueDate) throw new ApiError(400, "Tanggal jatuh tempo tidak boleh sebelum tanggal invoice")
  const calculation = calculateInvoice(body)
  return { customerId: String(body.customerId || ""), issueDate, dueDate, timezone: requireText(body.timezone || "Asia/Jakarta", "Timezone", 60, true), shippingMethod: requireText(body.shippingMethod, "Metode pengiriman", 255, false), ...calculation }
}
function invoiceDraftData(input) {
  return { customer_id: input.customerId, issue_date: input.issueDate, due_date: input.dueDate, timezone: input.timezone, items: input.items, shipping_method: input.shippingMethod, subtotal: input.subtotal, discount_amount: input.discountAmount, shipping_amount: input.shippingAmount, tax_rate_bps: input.taxRateBps, tax_amount: input.taxAmount, grand_total: input.grandTotal, currency: "IDR" }
}
function findCommand(tx, tenantId, companyId, epoch, key) {
  const actorId = invoiceRequestActor && invoiceRequestActor.tenantId === tenantId ? invoiceRequestActor.actorId : tenantId
  try { return tx.findFirstRecordByFilter("invoice_commands", "actor_user_id = {:actor} && tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && command_key = {:key}", { actor: actorId, tenant: tenantId, company: companyId, epoch, key }) } catch { return null }
}
function replayCommand(tx, tenantId, companyId, epoch, key, action, hash) {
  const record = findCommand(tx, tenantId, companyId, epoch, key)
  if (!record) return null
  if (record.getString("action") !== action || record.getString("request_hash") !== hash) throw new ApiError(409, "Kunci perintah sudah digunakan untuk permintaan lain")
  return { status: record.getInt("response_status"), body: json(record, "response_body", {}) }
}
function saveCommand(tx, tenantId, companyId, epoch, key, action, hash, status, body) {
  const collection = tx.findCollectionByNameOrId("invoice_commands")
  const actorId = invoiceRequestActor && invoiceRequestActor.tenantId === tenantId ? invoiceRequestActor.actorId : tenantId
  tx.save(new Record(collection, { actor_user_id: actorId, tenant_id: tenantId, company_id: companyId, data_epoch: epoch, command_key: key, action, request_hash: hash, response_status: status, response_body: body }))
}
function findAllRecords(app, collection, filter, sort, params, batchSize) {
  const size = Math.max(1, Math.min(500, Number(batchSize || 500)))
  const records = []; let offset = 0
  while (true) {
    const page = app.findRecordsByFilter(collection, filter, sort || "", size, offset, params || {})
    records.push(...page)
    if (page.length < size) return records
    offset += page.length
  }
}
function audit(tx, tenantId, companyId, epoch, actorId, action, type, id, commandKey, reason, before, after) {
  const effectiveActor = invoiceRequestActor && invoiceRequestActor.tenantId === tenantId && Date.now() - invoiceRequestActor.at < 5_000 ? invoiceRequestActor.actorId : actorId
  tx.save(new Record(tx.findCollectionByNameOrId("invoice_audit"), { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, actor_id: effectiveActor, action, entity_type: type, entity_id: id, command_key: commandKey || "", reason: reason || "", before_snapshot: before || null, after_snapshot: after || null }))
}
function ensureSettings(tx, tenantId, companyId, epoch, senderName) {
  let settings
  try { settings = tx.findFirstRecordByFilter("invoice_settings", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch}", { tenant: tenantId, company: companyId, epoch }) } catch {
    const units = tx.findCollectionByNameOrId("invoice_units")
    DEFAULT_UNITS.forEach((label, index) => tx.save(new Record(units, { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, label, normalized_label: normalize(label), status: "ACTIVE", sort_order: index, revision: 1 })))
    settings = new Record(tx.findCollectionByNameOrId("invoice_settings"), { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, sender_name: senderName, default_due_days: 1, numbering_prefix: "", numbering_padding: 3, numbering_start: 1, payment_instructions: [], reminder_enabled: true, reminder_timezone: "Asia/Jakarta", reminder_hour: 9, reminder_repeat_days: 7, schedule_version: 1, revision: 1 })
    tx.save(settings)
  }
  return settings
}

module.exports = { DEFAULT_UNITS, activePaymentInstructions, audit, calculateInvoice, commandHash, customerInput, customerResponse, ensureSettings, findAllRecords, findCommand, invoiceDraftData, invoiceInput, invoiceNumberForDisplay, invoiceResponse, isoDate, json, jsonBody, normalize, normalizePhone, ownedCompany, ownedRecord, paymentInstructionsInput, paymentResponse, replayCommand, requestScope, requireCommand, requireText, saveCommand, settingsResponse, stableStringify, unitResponse }

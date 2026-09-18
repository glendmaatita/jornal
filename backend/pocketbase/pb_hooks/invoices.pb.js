// Invoice collections are closed to raw writes. Every mutation goes through
// these scoped, revision-checked, idempotent command endpoints.

routerAdd("POST", "/api/jornal/invoicing/customers", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`)
  const body = h.jsonBody(event)
  const { tenantId, companyId, epoch } = h.requestScope(event, body, true)
  const commandKey = h.requireCommand(body)
  const hash = h.commandHash("CREATE_CUSTOMER", body)
  let response; let status = 201
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, tenantId, companyId, epoch, commandKey, "CREATE_CUSTOMER", hash)
    if (replay) { response = replay.body; status = replay.status; return }
    const input = h.customerInput(body)
    if (input.normalized_email && tx.findRecordsByFilter("invoice_customers", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_email = {:email}", "", 1, 0, { tenant: tenantId, company: companyId, epoch, email: input.normalized_email }).length) throw new ApiError(409, "Email pelanggan sudah digunakan pada company ini")
    const warnings = []; const samePhone = input.normalized_phone ? tx.findRecordsByFilter("invoice_customers", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_phone = {:phone} && status = 'ACTIVE'", "", 3, 0, { tenant: tenantId, company: companyId, epoch, phone: input.normalized_phone }) : []; const sameName = tx.findRecordsByFilter("invoice_customers", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && name = {:name} && status = 'ACTIVE'", "", 3, 0, { tenant: tenantId, company: companyId, epoch, name: input.name }); if (samePhone.length) warnings.push("Telepon sama dengan pelanggan aktif lain"); if (sameName.length) warnings.push("Nama sama dengan pelanggan aktif lain")
    const record = new Record(tx.findCollectionByNameOrId("invoice_customers"), { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, ...input, status: "ACTIVE", revision: 1 })
    tx.save(record); response = { customer: h.customerResponse(record), warnings }
    h.audit(tx, tenantId, companyId, epoch, tenantId, "customer-created", "customer", record.id, commandKey, "", null, response.customer)
    h.saveCommand(tx, tenantId, companyId, epoch, commandKey, "CREATE_CUSTOMER", hash, status, response)
  })
  return event.json(status, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/customers", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}
  const { tenantId, companyId, epoch } = h.requestScope(event, query, false)
  const page = Math.max(1, Number(query.page || 1)); const perPage = Math.max(1, Math.min(100, Number(query.perPage || 25)))
  const status = ["ACTIVE", "ARCHIVED"].includes(String(query.status)) ? String(query.status) : "ACTIVE"
  let filter = "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && status = {:status}"
  const params = { tenant: tenantId, company: companyId, epoch, status }
  const needle = String(query.search || "").trim().toLowerCase()
  if (needle) { filter += " && (LOWER(name) ~ {:needle} || normalized_email ~ {:needle} || normalized_phone ~ {:needle} || LOWER(city) ~ {:needle})"; params.needle = needle }
  const all = h.findAllRecords($app, "invoice_customers", filter, "name,id", params)
  const items = all.slice((page - 1) * perPage, page * perPage).map((record) => {
    const customer = h.customerResponse(record)
    const invoices = h.findAllRecords($app, "invoices", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && customer_id = {:customer} && deleted_at = ''", "-issue_date", { tenant: tenantId, company: companyId, epoch, customer: record.id })
    return { ...customer, activeInvoiceCount: invoices.filter((item) => item.getString("status") === "UNPAID").length, unpaidTotal: invoices.filter((item) => item.getString("status") === "UNPAID").reduce((sum, item) => sum + item.getInt("grand_total"), 0) }
  })
  return event.json(200, { items, page, perPage, totalItems: all.length, totalPages: Math.max(1, Math.ceil(all.length / perPage)) })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/customers/{id}", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}
  const scope = h.requestScope(event, query, false); const customer = h.ownedRecord($app, "invoice_customers", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Pelanggan")
  const invoices = h.findAllRecords($app, "invoices", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && customer_id = {:customer} && deleted_at = ''", "-issue_date", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, customer: customer.id })
  return event.json(200, { customer: h.customerResponse(customer), invoices: invoices.map(h.invoiceResponse), summary: { invoiceCount: invoices.length, paidTotal: invoices.filter((item) => item.getString("status") === "PAID").reduce((sum, item) => sum + item.getInt("grand_total"), 0), unpaidTotal: invoices.filter((item) => item.getString("status") === "UNPAID").reduce((sum, item) => sum + item.getInt("grand_total"), 0) } })
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/invoicing/customers/{id}", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("UPDATE_CUSTOMER", body); let response
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_CUSTOMER", hash); if (replay) { response = replay.body; return }
    const record = h.ownedRecord(tx, "invoice_customers", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Pelanggan")
    if (record.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Pelanggan telah berubah")
    const before = h.customerResponse(record); const input = h.customerInput(body)
    if (input.normalized_email) { const duplicate = tx.findRecordsByFilter("invoice_customers", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_email = {:email} && id != {:id}", "", 1, 0, { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, email: input.normalized_email, id: record.id }); if (duplicate.length) throw new ApiError(409, "Email pelanggan sudah digunakan pada company ini") }
    Object.entries(input).forEach(([name, value]) => record.set(name, value)); record.set("revision", record.getInt("revision") + 1); tx.save(record); response = { customer: h.customerResponse(record) }
    h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "customer-updated", "customer", record.id, key, String(body.reason || ""), before, response.customer); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_CUSTOMER", hash, 200, response)
  }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/customers/{id}/archive", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("ARCHIVE_CUSTOMER", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "ARCHIVE_CUSTOMER", hash); if (replay) { response = replay.body; return }; const record = h.ownedRecord(tx, "invoice_customers", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Pelanggan"); if (record.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Pelanggan telah berubah"); record.set("status", "ARCHIVED"); record.set("revision", record.getInt("revision") + 1); tx.save(record); response = { customer: h.customerResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "customer-archived", "customer", record.id, key, String(body.reason || ""), null, response.customer); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "ARCHIVE_CUSTOMER", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())
routerAdd("POST", "/api/jornal/invoicing/customers/{id}/restore", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("RESTORE_CUSTOMER", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "RESTORE_CUSTOMER", hash); if (replay) { response = replay.body; return }; const record = h.ownedRecord(tx, "invoice_customers", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Pelanggan"); if (record.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Pelanggan telah berubah"); record.set("status", "ACTIVE"); record.set("revision", record.getInt("revision") + 1); tx.save(record); response = { customer: h.customerResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "customer-restored", "customer", record.id, key, String(body.reason || ""), null, response.customer); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "RESTORE_CUSTOMER", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/settings", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false); const company = h.ownedCompany($app, scope.tenantId, scope.companyId, scope.epoch, false); let settings
  $app.runInTransaction((tx) => { settings = h.ensureSettings(tx, scope.tenantId, scope.companyId, scope.epoch, company.getString("name")) })
  const units = h.findAllRecords($app, "invoice_units", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch}", "sort_order,label", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch })
  return event.json(200, { settings: h.settingsResponse(settings), units: units.map(h.unitResponse) })
}, $apis.requireAuth())

routerAdd("PUT", "/api/jornal/invoicing/settings", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("UPDATE_SETTINGS", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_SETTINGS", hash); if (replay) { response = replay.body; return }; const company = h.ownedCompany(tx, scope.tenantId, scope.companyId, scope.epoch, true); const record = h.ensureSettings(tx, scope.tenantId, scope.companyId, scope.epoch, company.getString("name")); if (record.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Pengaturan invoice telah berubah")
    const email = h.requireText(body.senderEmail, "Email", 255, false); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Format email tidak valid"); const instructions = Array.isArray(body.paymentInstructions) ? body.paymentInstructions.filter((item) => item && [item.name, item.accountNumber, item.accountHolder].some((value) => String(value || "").trim())).slice(0, 3).map((item) => ({ name: h.requireText(item.name, "Nama pembayaran", 80, true), accountNumber: h.requireText(item.accountNumber, "Nomor pembayaran", 100, true), accountHolder: h.requireText(item.accountHolder, "Pemilik rekening", 100, true) })) : []
    const numberingStart = Number(body.numberingStart || 1); if (!Number.isSafeInteger(numberingStart) || numberingStart < (record.getInt("numbering_start") || 1) || numberingStart > 999_999_999) throw new ApiError(400, "Nomor awal hanya boleh dinaikkan")
    const defaultUnitId = String(body.defaultUnitId || ""); if (defaultUnitId) { const unit = h.ownedRecord(tx, "invoice_units", defaultUnitId, scope.tenantId, scope.companyId, scope.epoch, "Satuan default"); if (unit.getString("status") !== "ACTIVE") throw new ApiError(400, "Satuan default sudah diarsipkan") }; const defaultAccountId = String(body.defaultAccountId || ""); if (defaultAccountId) { try { tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'accounts' && app_id = {:id} && deleted_at = ''", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, id: defaultAccountId }) } catch { throw new ApiError(400, "Rekening default tidak berada pada company ini") } }
    let sequence; try { sequence = tx.findFirstRecordByFilter("invoice_sequences", "tenant_id = {:tenant} && company_id = {:company}", { tenant: scope.tenantId, company: scope.companyId }) } catch { sequence = null }; if (sequence && numberingStart > sequence.getInt("next_value")) { sequence.set("next_value", numberingStart); tx.save(sequence) } else if (sequence && numberingStart < sequence.getInt("next_value") && numberingStart !== (record.getInt("numbering_start") || 1)) throw new ApiError(400, "Nomor awal tidak boleh lebih kecil dari nomor berikutnya")
    const reminderEnabled = body.reminderEnabled !== false; const reminderTimezone = h.requireText(body.reminderTimezone || "Asia/Jakarta", "Timezone", 60, true); const reminderHour = Math.max(0, Math.min(23, Number(body.reminderHour || 0))); const reminderRepeatDays = Math.max(1, Math.min(365, Number(body.reminderRepeatDays || 7))); const scheduleChanged = record.getBool("reminder_enabled") !== reminderEnabled || record.getString("reminder_timezone") !== reminderTimezone || record.getInt("reminder_hour") !== reminderHour || record.getInt("reminder_repeat_days") !== reminderRepeatDays
    record.set("sender_name", h.requireText(body.senderName || company.getString("name"), "Nama pengirim", 255, true)); record.set("sender_phone", h.requireText(body.senderPhone, "Telepon", 50, false)); record.set("sender_email", email); record.set("default_due_days", Math.max(0, Math.min(365, Number(body.defaultDueDays || 0)))); record.set("numbering_prefix", h.requireText(body.numberingPrefix, "Prefix", 20, false)); record.set("numbering_padding", Math.max(3, Math.min(12, Number(body.numberingPadding || 3)))); record.set("numbering_start", numberingStart); record.set("payment_instructions", instructions); record.set("default_unit_id", defaultUnitId); record.set("default_account_id", defaultAccountId); record.set("reminder_enabled", reminderEnabled); record.set("reminder_timezone", reminderTimezone); record.set("reminder_hour", reminderHour); record.set("reminder_repeat_days", reminderRepeatDays); if (scheduleChanged) record.set("schedule_version", record.getInt("schedule_version") + 1); record.set("revision", record.getInt("revision") + 1); tx.save(record); if (scheduleChanged) { const reminders = tx.findRecordsByFilter("invoice_reminders", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && status != 'RESOLVED'", "", 0, 0, { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch }); reminders.forEach((reminder) => { reminder.set("status", "RESOLVED"); reminder.set("resolved_at", new Date().toISOString()); tx.save(reminder) }) }; response = { settings: h.settingsResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-settings-updated", "settings", record.id, key, "", null, response.settings); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_SETTINGS", hash, 200, response)
  }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/units", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("CREATE_UNIT", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "CREATE_UNIT", hash); if (replay) { response = replay.body; return }; const label = h.requireText(body.label, "Satuan", 20, true); const normalized = h.normalize(label); if (tx.findRecordsByFilter("invoice_units", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && normalized_label = {:label} && status = 'ACTIVE'", "", 1, 0, { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, label: normalized }).length) throw new ApiError(409, "Satuan aktif dengan nama ini sudah ada"); const record = new Record(tx.findCollectionByNameOrId("invoice_units"), { tenant_id: scope.tenantId, company_id: scope.companyId, data_epoch: scope.epoch, label, normalized_label: normalized, status: "ACTIVE", sort_order: Number(body.sortOrder || 99), revision: 1 }); tx.save(record); response = { unit: h.unitResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-unit-created", "unit", record.id, key, "", null, response.unit); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "CREATE_UNIT", hash, 201, response) }); return event.json(201, response)
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/invoicing/units/{id}", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("UPDATE_UNIT", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_UNIT", hash); if (replay) { response = replay.body; return }; const record = h.ownedRecord(tx, "invoice_units", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Satuan"); if (record.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Satuan telah berubah"); if (body.label !== undefined) { const label = h.requireText(body.label, "Satuan", 20, true); record.set("label", label); record.set("normalized_label", h.normalize(label)) }; if (body.status !== undefined) { if (!["ACTIVE", "ARCHIVED"].includes(String(body.status))) throw new ApiError(400, "Status satuan tidak valid"); record.set("status", String(body.status)) }; record.set("revision", record.getInt("revision") + 1); tx.save(record); response = { unit: h.unitResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-unit-updated", "unit", record.id, key, "", null, response.unit); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_UNIT", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`)
  const body = h.jsonBody(event)
  const { tenantId, companyId, epoch } = h.requestScope(event, body, true)
  const commandKey = h.requireCommand(body)
  const hash = h.commandHash("CREATE_DRAFT", body)
  let response; let status = 201
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, tenantId, companyId, epoch, commandKey, "CREATE_DRAFT", hash)
    if (replay) { response = replay.body; status = replay.status; return }
    const input = h.invoiceInput(body)
    const customer = h.ownedRecord(tx, "invoice_customers", input.customerId, tenantId, companyId, epoch, "Pelanggan")
    if (customer.getString("status") !== "ACTIVE") throw new ApiError(409, "Pelanggan diarsipkan")
    const record = new Record(tx.findCollectionByNameOrId("invoices"), { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, ...h.invoiceDraftData(input), status: "DRAFT", template_version: "dropify-order-v1", payment_cycle: 1, revision: 1 })
    tx.save(record); response = { invoice: h.invoiceResponse(record) }
    h.audit(tx, tenantId, companyId, epoch, tenantId, "invoice-draft-created", "invoice", record.id, commandKey, "", null, response.invoice)
    h.saveCommand(tx, tenantId, companyId, epoch, commandKey, "CREATE_DRAFT", hash, status, response)
  })
  return event.json(status, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/invoices", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false)
  const page = Math.max(1, Number(query.page || 1)); const perPage = Math.max(1, Math.min(100, Number(query.perPage || 25))); const allowed = ["DRAFT", "UNPAID", "PAID", "VOID"]
  let filter = "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && deleted_at = ''"; const params = { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch }
  if (allowed.includes(String(query.status))) { filter += " && status = {:status}"; params.status = String(query.status) }
  if (query.customerId) { filter += " && customer_id = {:customer}"; params.customer = String(query.customerId) }
  const all = h.findAllRecords($app, "invoices", filter, "-issue_date,-created", params); const search = String(query.search || "").trim().toLowerCase(); const filtered = search ? all.filter((record) => record.getString("invoice_number").toLowerCase().includes(search) || String((h.json(record, "customer_snapshot", {}) || {}).name || "").toLowerCase().includes(search)) : all
  return event.json(200, { items: filtered.slice((page - 1) * perPage, page * perPage).map(h.invoiceResponse), page, perPage, totalItems: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / perPage)) })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/invoices/{id}", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false); const invoice = h.ownedRecord($app, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice")
  let payment = null; try { payment = $app.findFirstRecordByFilter("invoice_payments", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && invoice_id = {:invoice} && status = 'ACTIVE'", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, invoice: invoice.id }) } catch { /* no payment */ }
  return event.json(200, { invoice: h.invoiceResponse(invoice), payment: payment ? h.paymentResponse(payment) : null })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/invoices/{id}/payment-candidates", (event) => { const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false); const invoice = h.ownedRecord($app, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); if (invoice.getString("status") !== "UNPAID") return event.json(200, { items: [] }); const rows = h.findAllRecords($app, "jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && deleted_at = ''", "-updated", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch }); const items = rows.map((record) => ({ record, value: h.json(record, "payload", {}) })).filter(({ value }) => value.direction === "MONEY_IN" && value.classification === "REVENUE" && Number(value.amount) === invoice.getInt("grand_total") && !value.invoiceId && !value.taxSettlementId && !value.receivableTransactionId && !value.transferAccountId && String(value.transactionDate || "") >= invoice.getString("issue_date") && String(value.transactionDate || "") <= new Date().toISOString().slice(0, 10)).slice(0, 50).map(({ record, value }) => ({ transaction: value, revision: record.getInt("revision") })); return event.json(200, { items }) }, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/invoices/{id}/document", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false); const invoice = h.ownedRecord($app, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice")
  if (invoice.getString("deleted_at")) throw new ApiError(404, "Invoice tidak ditemukan")
  const result = h.invoiceResponse(invoice); return event.json(200, { documentVersion: invoice.getString("template_version"), contentHash: invoice.getString("content_hash") || $security.sha256(h.stableStringify(result)), invoice: result })
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/invoicing/invoices/{id}", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("UPDATE_DRAFT", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_DRAFT", hash); if (replay) { response = replay.body; return }; const invoice = h.ownedRecord(tx, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); if (invoice.getString("status") !== "DRAFT" || invoice.getString("deleted_at")) throw new ApiError(409, "Hanya draft aktif yang dapat diedit"); if (invoice.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Draft invoice telah berubah"); const input = h.invoiceInput(body); const customer = h.ownedRecord(tx, "invoice_customers", input.customerId, scope.tenantId, scope.companyId, scope.epoch, "Pelanggan"); if (customer.getString("status") !== "ACTIVE") throw new ApiError(409, "Pelanggan diarsipkan"); const before = h.invoiceResponse(invoice); Object.entries(h.invoiceDraftData(input)).forEach(([name, value]) => invoice.set(name, value)); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice); response = { invoice: h.invoiceResponse(invoice) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-draft-updated", "invoice", invoice.id, key, "", before, response.invoice); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "UPDATE_DRAFT", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices/{id}/delete-draft", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("DELETE_DRAFT", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "DELETE_DRAFT", hash); if (replay) { response = replay.body; return }; const invoice = h.ownedRecord(tx, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); if (invoice.getString("status") !== "DRAFT") throw new ApiError(409, "Hanya draft yang dapat dihapus"); if (invoice.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Draft invoice telah berubah"); invoice.set("deleted_at", new Date().toISOString()); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice); response = { invoice: h.invoiceResponse(invoice) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-draft-deleted", "invoice", invoice.id, key, String(body.reason || ""), null, response.invoice); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "DELETE_DRAFT", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices/{id}/duplicate", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("DUPLICATE_INVOICE", body); let response; let status = 201
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "DUPLICATE_INVOICE", hash); if (replay) { response = replay.body; status = replay.status; return }; const source = h.ownedRecord(tx, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); const record = new Record(tx.findCollectionByNameOrId("invoices"), { tenant_id: scope.tenantId, company_id: scope.companyId, data_epoch: scope.epoch, customer_id: source.getString("customer_id"), status: "DRAFT", issue_date: String(body.issueDate || new Date().toISOString().slice(0, 10)), due_date: String(body.dueDate || source.getString("due_date")), timezone: source.getString("timezone"), items: h.json(source, "items", []), shipping_method: source.getString("shipping_method"), subtotal: source.getInt("subtotal"), discount_amount: source.getInt("discount_amount"), shipping_amount: source.getInt("shipping_amount"), tax_rate_bps: source.getInt("tax_rate_bps"), tax_amount: source.getInt("tax_amount"), grand_total: source.getInt("grand_total"), currency: "IDR", template_version: source.getString("template_version"), payment_cycle: 1, replaced_invoice_id: source.id, revision: 1 }); tx.save(record); response = { invoice: h.invoiceResponse(record) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-duplicated", "invoice", record.id, key, "", null, response.invoice); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "DUPLICATE_INVOICE", hash, status, response) }); return event.json(status, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices/{id}/void", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("VOID_INVOICE", body); let response
  $app.runInTransaction((tx) => { const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "VOID_INVOICE", hash); if (replay) { response = replay.body; return }; const invoice = h.ownedRecord(tx, "invoices", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); if (invoice.getString("status") !== "UNPAID") throw new ApiError(409, "Hanya invoice belum dibayar yang dapat dibatalkan"); if (invoice.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Invoice telah berubah"); const reason = h.requireText(body.reason, "Alasan pembatalan", 500, true); invoice.set("status", "VOID"); invoice.set("void_reason", reason); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice); const reminders = tx.findRecordsByFilter("invoice_reminders", "invoice_id = {:invoice} && status != 'RESOLVED'", "", 0, 0, { invoice: invoice.id }); reminders.forEach((record) => { record.set("status", "RESOLVED"); record.set("resolved_at", new Date().toISOString()); tx.save(record) }); response = { invoice: h.invoiceResponse(invoice) }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-voided", "invoice", invoice.id, key, reason, null, response.invoice); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "VOID_INVOICE", hash, 200, response) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices/{id}/issue", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`)
  const body = h.jsonBody(event)
  const { tenantId, companyId, epoch } = h.requestScope(event, body, true)
  const id = event.request.pathValue("id")
  const commandKey = h.requireCommand(body)
  const hash = h.commandHash("ISSUE_INVOICE", body)
  let response; let status = 200
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, tenantId, companyId, epoch, commandKey, "ISSUE_INVOICE", hash)
    if (replay) { response = replay.body; status = replay.status; return }
    const invoice = h.ownedRecord(tx, "invoices", id, tenantId, companyId, epoch, "Invoice")
    if (invoice.getString("status") !== "DRAFT") throw new ApiError(409, "Hanya draft yang dapat diterbitkan")
    if (invoice.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Draft invoice telah berubah")
    const customer = h.ownedRecord(tx, "invoice_customers", invoice.getString("customer_id"), tenantId, companyId, epoch, "Pelanggan"); if (customer.getString("status") !== "ACTIVE") throw new ApiError(409, "Pelanggan diarsipkan; pulihkan sebelum menerbitkan invoice")
    const company = h.ownedCompany(tx, tenantId, companyId, epoch, true)
    const settings = h.ensureSettings(tx, tenantId, companyId, epoch, company.getString("name"))
    let sequence
    try { sequence = tx.findFirstRecordByFilter("invoice_sequences", "tenant_id = {:tenant} && company_id = {:company}", { tenant: tenantId, company: companyId }) }
    catch { sequence = new Record(tx.findCollectionByNameOrId("invoice_sequences"), { tenant_id: tenantId, company_id: companyId, next_value: settings.getInt("numbering_start") || 1 }) }
    const value = sequence.getInt("next_value") || settings.getInt("numbering_start") || 1
    sequence.set("next_value", value + 1); tx.save(sequence)
    const number = `${settings.getString("numbering_prefix")}${String(value).padStart(settings.getInt("numbering_padding") || 3, "0")}`
    invoice.set("status", "UNPAID"); invoice.set("sequence", value); invoice.set("invoice_number", number)
    invoice.set("customer_snapshot", h.customerResponse(customer))
    invoice.set("sender_snapshot", { name: settings.getString("sender_name"), phone: settings.getString("sender_phone") || null, email: settings.getString("sender_email") || null, logoAssetId: company.getString("logo_asset_id") || null })
    invoice.set("payment_instructions_snapshot", h.json(settings, "payment_instructions", []))
    invoice.set("content_hash", $security.sha256(h.stableStringify({ number, customer: h.customerResponse(customer), items: h.json(invoice, "items", []), total: invoice.getInt("grand_total") })))
    invoice.set("issued_at", new Date().toISOString()); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice)
    response = { invoice: h.invoiceResponse(invoice) }
    h.audit(tx, tenantId, companyId, epoch, tenantId, "invoice-issued", "invoice", invoice.id, commandKey, "", null, response.invoice)
    h.saveCommand(tx, tenantId, companyId, epoch, commandKey, "ISSUE_INVOICE", hash, status, response)
  })
  return event.json(status, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/invoices/{id}/mark-paid", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`)
  const body = h.jsonBody(event)
  const { tenantId, companyId, epoch } = h.requestScope(event, body, true)
  const id = event.request.pathValue("id")
  const commandKey = h.requireCommand(body)
  const hash = h.commandHash("MARK_PAID", body)
  let response; let status = 200
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, tenantId, companyId, epoch, commandKey, "MARK_PAID", hash)
    if (replay) { response = replay.body; status = replay.status; return }
    const invoice = h.ownedRecord(tx, "invoices", id, tenantId, companyId, epoch, "Invoice")
    if (invoice.getString("status") !== "UNPAID") throw new ApiError(409, invoice.getString("status") === "PAID" ? "Invoice sudah lunas" : "Invoice tidak dapat dilunasi")
    if (invoice.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Invoice telah berubah")
    const paidOn = body.paidOn ? h.isoDate(body.paidOn, "Tanggal pembayaran") : ""
    if (tx.findRecordsByFilter("invoice_payments", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && invoice_id = {:invoice} && status = 'ACTIVE'", "", 1, 0, { tenant: tenantId, company: companyId, epoch, invoice: invoice.id }).length) throw new ApiError(409, "Invoice sudah memiliki pembayaran aktif")
    const transactionId = String(body.transactionId || "")
    if (!transactionId || transactionId.length > 100) throw new ApiError(400, "transactionId wajib diisi")
    const mode = String(body.mode || "CREATE"); if (!["CREATE", "LINK_EXISTING"].includes(mode)) throw new ApiError(400, "Mode pembayaran tidak valid")
    if (mode === "CREATE" && (!paidOn || paidOn < invoice.getString("issue_date") || paidOn > new Date().toISOString().slice(0, 10))) throw new ApiError(400, "Tanggal pembayaran harus berada antara tanggal invoice dan hari ini")
    const customer = h.ownedRecord(tx, "invoice_customers", invoice.getString("customer_id"), tenantId, companyId, epoch, "Pelanggan")
    const amount = invoice.getInt("grand_total"); const now = new Date().toISOString(); let ledgerRecord; let ledgerTransaction; let originalLedgerSnapshot = null
    const invoiceMetadata = { invoiceId: invoice.id, invoiceNumber: invoice.getString("invoice_number"), customerId: customer.id, invoiceRevenueAmount: invoice.getInt("subtotal") - invoice.getInt("discount_amount") + invoice.getInt("shipping_amount"), invoiceTaxAmount: invoice.getInt("tax_amount") }
    if (mode === "CREATE") {
      if (tx.findRecordsByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", "", 1, 0, { tenant: tenantId, company: companyId, id: transactionId }).length) throw new ApiError(409, "ID transaksi sudah digunakan")
      ledgerTransaction = { id: transactionId, businessId: tenantId, companyId, direction: "MONEY_IN", amount, currency: "IDR", transactionDate: paidOn, description: `Pelunasan invoice ${invoice.getString("invoice_number")}`, notes: h.requireText(body.notes, "Catatan", 2000, false), categoryId: null, paymentMethod: h.requireText(body.paymentMethod || "BANK_TRANSFER", "Metode pembayaran", 80, true), supplierCustomer: customer.getString("name"), tags: "invoice", accountId: body.accountId ? String(body.accountId) : null, transferAccountId: null, attachmentName: null, attachmentDataUrl: null, receivableTransactionId: null, receivableDueDate: null, taxSubjectId: null, taxObligationId: null, taxSettlementId: null, taxKind: null, taxPeriod: null, ...invoiceMetadata, classification: "REVENUE", taxClassification: "REVENUE", businessRelevance: "BUSINESS", classificationSource: "SYSTEM", classificationConfidence: 1, reviewStatus: "ACCEPTED", createdAt: now, updatedAt: now }
      if (ledgerTransaction.accountId) { try { tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'accounts' && app_id = {:id}", { tenant: tenantId, company: companyId, epoch, id: ledgerTransaction.accountId }) } catch { throw new ApiError(400, "Rekening tidak berada pada company ini") } }
      ledgerRecord = new Record(tx.findCollectionByNameOrId("jornal_records"), { business_id: tenantId, company_id: companyId, data_epoch: epoch, entity: "transactions", app_id: transactionId, payload: ledgerTransaction, revision: 1 }); tx.save(ledgerRecord)
    } else {
      try { ledgerRecord = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, epoch, id: transactionId }) } catch { throw new ApiError(404, "Transaksi pemasukan tidak ditemukan") }
      if (ledgerRecord.getInt("revision") !== Number(body.expectedTransactionRevision)) throw new ApiError(409, "Transaksi pemasukan telah berubah")
      ledgerTransaction = h.json(ledgerRecord, "payload", {}); originalLedgerSnapshot = ledgerTransaction
      if (ledgerTransaction.direction !== "MONEY_IN" || ledgerTransaction.classification !== "REVENUE" || Number(ledgerTransaction.amount) !== amount || String(ledgerTransaction.currency || "IDR") !== "IDR") throw new ApiError(409, "Transaksi tidak cocok dengan nilai invoice")
      if (ledgerTransaction.invoiceId || ledgerTransaction.taxSettlementId || ledgerTransaction.receivableTransactionId || ledgerTransaction.transferAccountId) throw new ApiError(409, "Transaksi sudah terhubung ke proses lain")
      if (String(ledgerTransaction.transactionDate || "") < invoice.getString("issue_date") || String(ledgerTransaction.transactionDate || "") > new Date().toISOString().slice(0, 10)) throw new ApiError(409, "Tanggal transaksi tidak valid untuk invoice ini")
      ledgerTransaction = { ...ledgerTransaction, ...invoiceMetadata, updatedAt: now }; ledgerRecord.set("payload", ledgerTransaction); ledgerRecord.set("revision", ledgerRecord.getInt("revision") + 1); tx.save(ledgerRecord)
    }
    const payment = new Record(tx.findCollectionByNameOrId("invoice_payments"), { tenant_id: tenantId, company_id: companyId, data_epoch: epoch, invoice_id: invoice.id, amount, paid_on: mode === "CREATE" ? paidOn : String(ledgerTransaction.transactionDate), account_id: String(ledgerTransaction.accountId || ""), ledger_transaction_id: transactionId, origin: mode === "CREATE" ? "CREATED" : "LINKED", original_ledger_snapshot: originalLedgerSnapshot, status: "ACTIVE", lifecycle: "CURRENT", reference: h.requireText(body.reference, "Referensi", 255, false), revision: 1 })
    tx.save(payment); ledgerTransaction.invoicePaymentId = payment.id; ledgerRecord.set("payload", ledgerTransaction); tx.save(ledgerRecord); invoice.set("status", "PAID"); invoice.set("paid_at", now); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice)
    const reminders = tx.findRecordsByFilter("invoice_reminders", "invoice_id = {:invoice} && status != 'RESOLVED'", "", 0, 0, { invoice: invoice.id }); reminders.forEach((record) => { record.set("status", "RESOLVED"); record.set("resolved_at", now); tx.save(record) })
    response = { invoice: h.invoiceResponse(invoice), payment: h.paymentResponse(payment), ledgerTransaction, ledgerRevision: ledgerRecord.getInt("revision") }
    h.audit(tx, tenantId, companyId, epoch, tenantId, "invoice-paid", "invoice", invoice.id, commandKey, "", null, response)
    h.saveCommand(tx, tenantId, companyId, epoch, commandKey, "MARK_PAID", hash, status, response)
  })
  return event.json(status, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/payments/{id}/correct", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, true); const key = h.requireCommand(body); const hash = h.commandHash("CORRECT_PAYMENT", body); let response
  $app.runInTransaction((tx) => {
    const replay = h.replayCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "CORRECT_PAYMENT", hash); if (replay) { response = replay.body; return }
    const payment = h.ownedRecord(tx, "invoice_payments", event.request.pathValue("id"), scope.tenantId, scope.companyId, scope.epoch, "Pembayaran"); if (payment.getString("status") !== "ACTIVE") throw new ApiError(409, "Pembayaran sudah dikoreksi"); if (payment.getInt("revision") !== Number(body.expectedRevision)) throw new ApiError(409, "Pembayaran telah berubah"); const reason = h.requireText(body.reason, "Alasan koreksi", 500, true)
    const invoice = h.ownedRecord(tx, "invoices", payment.getString("invoice_id"), scope.tenantId, scope.companyId, scope.epoch, "Invoice"); if (invoice.getString("status") !== "PAID") throw new ApiError(409, "Status invoice tidak konsisten")
    let ledgerRecord; try { ledgerRecord = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && entity = 'transactions' && app_id = {:id}", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch, id: payment.getString("ledger_transaction_id") }) } catch { throw new ApiError(409, "Transaksi pembayaran tidak ditemukan") }
    let ledgerTransaction = h.json(ledgerRecord, "payload", {}); const origin = payment.getString("origin")
    if (origin === "CREATED") { ledgerTransaction = { ...ledgerTransaction, lifecycle: "REVERSED", reversedAt: new Date().toISOString(), reversalReason: reason, updatedAt: new Date().toISOString() }; ledgerRecord.set("payload", ledgerTransaction); ledgerRecord.set("deleted_at", new Date().toISOString()); ledgerRecord.set("revision", ledgerRecord.getInt("revision") + 1); tx.save(ledgerRecord) }
    else { const original = h.json(payment, "original_ledger_snapshot", null); if (!original) throw new ApiError(409, "Snapshot transaksi sebelum link tidak tersedia"); ledgerTransaction = original; ledgerRecord.set("payload", original); ledgerRecord.set("revision", ledgerRecord.getInt("revision") + 1); tx.save(ledgerRecord) }
    payment.set("status", "REVERSED"); payment.set("reversal_reason", reason); payment.set("reversed_at", new Date().toISOString()); payment.set("revision", payment.getInt("revision") + 1); tx.save(payment); invoice.set("status", "UNPAID"); invoice.set("paid_at", ""); invoice.set("payment_cycle", invoice.getInt("payment_cycle") + 1); invoice.set("revision", invoice.getInt("revision") + 1); tx.save(invoice)
    const documents = tx.findRecordsByFilter("document_inbox", "linked_payment_id = {:payment} && status = 'LINKED'", "", 0, 0, { payment: payment.id }); documents.forEach((document) => { document.set("status", "REVIEW_READY"); document.set("linked_transaction_id", ""); document.set("linked_payment_id", ""); document.set("unlink_reason", reason); document.set("revision", document.getInt("revision") + 1); tx.save(document) })
    response = { invoice: h.invoiceResponse(invoice), payment: h.paymentResponse(payment), ledgerTransaction, ledgerRevision: ledgerRecord.getInt("revision"), ledgerDeleted: origin === "CREATED" }; h.audit(tx, scope.tenantId, scope.companyId, scope.epoch, scope.tenantId, "invoice-payment-corrected", "payment", payment.id, key, reason, null, response); h.saveCommand(tx, scope.tenantId, scope.companyId, scope.epoch, key, "CORRECT_PAYMENT", hash, 200, response)
  }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/summary", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`)
  const query = event.requestInfo().query || {}
  const { tenantId, companyId, epoch } = h.requestScope(event, query, false)
  const today = new Date().toISOString().slice(0, 10)
  const records = h.findAllRecords($app, "invoices", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && status = 'UNPAID' && deleted_at = ''", "", { tenant: tenantId, company: companyId, epoch })
  let unpaidTotal = 0; let overdueTotal = 0; let overdueCount = 0
  for (const record of records) {
    const amount = record.getInt("grand_total"); unpaidTotal += amount
    if (record.getString("due_date") < today) { overdueTotal += amount; overdueCount += 1 }
  }
  return event.json(200, { unpaidTotal, unpaidCount: records.length, overdueTotal, overdueCount, serverDate: today, computedAt: new Date().toISOString() })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invoicing/reminders", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const query = event.requestInfo().query || {}; const scope = h.requestScope(event, query, false)
  const records = h.findAllRecords($app, "invoice_reminders", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && status != 'RESOLVED'", "-scheduled_local_date,-created", { tenant: scope.tenantId, company: scope.companyId, epoch: scope.epoch })
  return event.json(200, { items: records.map((record) => ({ id: record.id, invoiceId: record.getString("invoice_id"), status: record.getString("status"), scheduledLocalDate: record.getString("scheduled_local_date"), createdAt: record.getString("created") })) })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/invoicing/reminders/read", (event) => {
  const h = require(`${__hooks}/invoice_helpers.js`); const body = h.jsonBody(event); const scope = h.requestScope(event, body, false); const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : []; let updated = 0
  $app.runInTransaction((tx) => { for (const id of ids) { let record; try { record = h.ownedRecord(tx, "invoice_reminders", id, scope.tenantId, scope.companyId, scope.epoch, "Reminder") } catch { continue }; if (record.getString("status") === "UNREAD") { record.set("status", "READ"); record.set("read_at", new Date().toISOString()); tx.save(record); updated += 1 } } })
  return event.json(200, { updated })
}, $apis.requireAuth())

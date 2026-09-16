function isJornalRecord(event) {
  return event.record && event.record.collection().name === "jornal_records"
}

function ownedActiveCompany(event, companyId) {
  if (!event.auth || !companyId) throw new ApiError(404, "Company not found")
  let company
  try { company = $app.findRecordById("companies", companyId) } catch { throw new ApiError(404, "Company not found") }
  if (company.getString("tenant_id") !== event.auth.id) throw new ApiError(404, "Company not found")
  if (company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company is archived")
  return company
}

function requireProtocolScope(event, companyId) {
  const headers = event.requestInfo().headers || {}
  const protocol = String(headers.x_jornal_protocol || "")
  const requestedCompany = String(headers.x_jornal_company || "")
  if (protocol !== "2") throw new ApiError(426, "Client update required")
  if (!requestedCompany || requestedCompany !== companyId) throw new ApiError(404, "Record not found")
}

function validatePayloadReferences(event, companyId) {
  const entity = event.record.getString("entity")
  let payload = event.record.get("payload") || {}
  try { payload = JSON.parse(event.record.getString("payload")) } catch { /* JSONMap fallback */ }
  const value = (object, key) => typeof object.get === "function" ? object.get(key) : object[key]
  if (value(payload, "companyId") && String(value(payload, "companyId")) !== companyId) {
    throw new ApiError(400, "Payload company is outside the record scope")
  }
  if (value(payload, "businessId") && String(value(payload, "businessId")) !== event.auth.id) {
    throw new ApiError(400, "Payload tenant is outside the record scope")
  }
  if (entity !== "transactions" && entity !== "recurringRules") return
  const accountIds = [value(payload, "accountId"), value(payload, "transferAccountId")].filter(Boolean)
  for (const accountId of accountIds) {
    try {
      $app.findFirstRecordByFilter("jornal_records", "company_id = {:company} && entity = 'accounts' && app_id = {:id}", { company: companyId, id: String(accountId) })
    } catch { throw new ApiError(400, "Account reference is outside the company") }
  }
  if (entity === "transactions" && value(payload, "classification") === "RECEIVABLE_PAYMENT") {
    const receivableId = value(payload, "receivableTransactionId")
    if (!receivableId) throw new ApiError(400, "Receivable reference is required")
    let source
    try {
      source = $app.findFirstRecordByFilter("jornal_records", "company_id = {:company} && entity = 'transactions' && app_id = {:id}", { company: companyId, id: String(receivableId) })
    } catch { throw new ApiError(400, "Receivable reference is outside the company") }
    let sourcePayload = source.get("payload") || {}
    try { sourcePayload = JSON.parse(source.getString("payload")) } catch { /* JSONMap fallback */ }
    if (value(sourcePayload, "classification") !== "RECEIVABLE_CREATED") throw new ApiError(400, "Receivable reference is invalid")
  }
  if (entity === "transactions" && value(payload, "classification") !== "RECEIVABLE_CREATED") {
    validateNoInboundReferences(event, companyId)
  }
}

function validateNoInboundReferences(event, companyId) {
  const entity = event.record.getString("entity")
  if (entity !== "accounts" && entity !== "transactions") return
  const targetId = event.record.getString("app_id")
  const entities = entity === "accounts" ? ["transactions", "recurringRules"] : ["transactions"]
  for (const referenceEntity of entities) {
    const records = $app.findRecordsByFilter("jornal_records", "company_id = {:company} && entity = {:entity}", "", 0, 0, { company: companyId, entity: referenceEntity })
    for (const record of records) {
      if (record.id === event.record.id) continue
      let payload = record.get("payload") || {}
      try { payload = JSON.parse(record.getString("payload")) } catch { /* JSONMap fallback */ }
      const value = (key) => typeof payload.get === "function" ? payload.get(key) : payload[key]
      const referenced = entity === "accounts"
        ? value("accountId") === targetId || value("transferAccountId") === targetId
        : value("classification") === "RECEIVABLE_PAYMENT" && value("receivableTransactionId") === targetId
      if (referenced) throw new ApiError(409, entity === "accounts" ? "Account is still referenced" : "Receivable is still referenced")
    }
  }
  if (entity === "transactions") {
    const linked = $app.findRecordsByFilter(
      "tax_settlements",
      "tenant_id = {:tenant} && ledger_company_id = {:company} && ledger_transaction_id = {:transaction} && status = 'ACTIVE'",
      "", 1, 0,
      { tenant: event.auth.id, company: companyId, transaction: targetId },
    )
    if (linked.length > 0) throw new ApiError(409, "Tax payment is still allocated; correct it from the tax agenda")
  }
}

module.exports = { isJornalRecord, ownedActiveCompany, requireProtocolScope, validateNoInboundReferences, validatePayloadReferences }

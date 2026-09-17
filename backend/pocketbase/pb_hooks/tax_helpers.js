function jsonBody(event) { return event.requestInfo().body || {} }
let taxRequestActor = null

function requireTaxEnabled() {
  if ($os.getenv("JORNAL_TAX_COMPLIANCE_ENABLED") === "false") throw new ApiError(403, "Tax compliance is temporarily disabled")
}

function requestTenant(event) {
  const access = require(`${__hooks}/company_access.js`)
  access.requireProtocol(event)
  const requestBody = jsonBody(event)
  const info = event.requestInfo()
  const headers = info.headers || {}
  const query = info.query || {}
  const actorId = event.auth.id
  const companyIds = [...new Set([
    String(requestBody.companyId || ""),
    ...(Array.isArray(requestBody.companyIds) ? requestBody.companyIds.map(String) : []),
    String(query.companyId || ""),
    String(headers.x_jornal_company || ""),
  ].filter(Boolean))]
  let ownerTenantId = ""
  for (const companyId of companyIds) {
    const scope = access.companyScope($app, actorId, companyId, {})
    if (ownerTenantId && ownerTenantId !== scope.ownerTenantId) throw new ApiError(409, "Data pajak lintas pemilik tidak didukung")
    ownerTenantId = scope.ownerTenantId
  }
  const path = String(event.request.url.path || "")
  let subjectId = String(requestBody.subjectId || query.subjectId || "")
  const direct = path.match(/\/tax\/subjects\/([^/]+)/); if (!subjectId && direct) subjectId = direct[1]
  if (!subjectId) {
    const patterns = [["obligations", "tax_obligations"], ["filings", "tax_filings"], ["settlements", "tax_settlements"], ["registrations", "tax_registrations"], ["memberships", "tax_company_memberships"], ["preferences", "tax_notification_preferences"], ["evidence", "tax_evidence"]]
    for (const pair of patterns) {
      const match = path.match(new RegExp(`/tax/${pair[0]}/([^/]+)`)); if (!match) continue
      try { subjectId = $app.findRecordById(pair[1], match[1]).getString("subject_id") } catch { /* normal route not-found handling follows */ }
      break
    }
  }
  if (subjectId) {
    let subject
    try { subject = $app.findRecordById("tax_subjects", subjectId) } catch { throw new ApiError(404, "Tax subject not found") }
    const coverage = access.assertTaxSubjectAccess($app, actorId, subject, true)
    if (ownerTenantId && coverage.ownerTenantId !== ownerTenantId) throw new ApiError(404, "Tax subject not found")
    ownerTenantId = coverage.ownerTenantId
  }
  const tenant = ownerTenantId || actorId
  taxRequestActor = { actorId, tenantId: tenant, at: Date.now() }
  return tenant
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
}

function commandKey(body) {
  const key = String(body.commandKey || body.requestId || "").trim()
  if (!key || key.length > 100) throw new ApiError(400, "A valid commandKey is required")
  return key
}

function commandHash(body) {
  const copy = Object.assign({}, body)
  delete copy.commandKey; delete copy.requestId
  return $security.sha256(stableStringify(copy))
}

function findCommand(app, tenantId, key) {
  const actorId = taxRequestActor && taxRequestActor.tenantId === tenantId ? taxRequestActor.actorId : tenantId
  try { return app.findFirstRecordByFilter("tax_commands", "tenant_id = {:tenant} && actor_user_id = {:actor} && command_key = {:key}", { tenant: tenantId, actor: actorId, key }) } catch { return null }
}

function replayCommand(app, tenantId, type, body) {
  const key = commandKey(body); const hash = commandHash(body)
  const command = findCommand(app, tenantId, key)
  if (!command) return { key, hash, response: null }
  if (command.getString("command_type") !== type || command.getString("request_hash") !== hash) throw new ApiError(409, "Command key payload differs")
  return { key, hash, response: { status: command.getInt("response_status"), body: command.get("response_body") } }
}

function saveCommand(app, tenantId, type, command, status, body) {
  const actorId = taxRequestActor && taxRequestActor.tenantId === tenantId ? taxRequestActor.actorId : tenantId
  app.save(new Record(app.findCollectionByNameOrId("tax_commands"), {
    tenant_id: tenantId, actor_user_id: actorId, command_key: command.key, request_hash: command.hash,
    command_type: type, response_status: status, response_body: body,
  }))
}

function ownedSubject(app, tenantId, subjectId) {
  let subject
  try { subject = app.findRecordById("tax_subjects", String(subjectId || "")) } catch { throw new ApiError(404, "Tax subject not found") }
  if (subject.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax subject not found")
  return subject
}

function ownedCompany(app, tenantId, companyId, requireActive) {
  let company
  try { company = app.findRecordById("companies", String(companyId || "")) } catch { throw new ApiError(404, "Company not found") }
  if (company.getString("tenant_id") !== tenantId) throw new ApiError(404, "Company not found")
  if (taxRequestActor && taxRequestActor.tenantId === tenantId && Date.now() - taxRequestActor.at < 5_000) require(`${__hooks}/company_access.js`).companyScope(app, taxRequestActor.actorId, company.id, {})
  if (requireActive && company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company is archived")
  return company
}

function ownedRegistration(app, tenantId, registrationId) {
  let registration
  try { registration = app.findRecordById("tax_registrations", String(registrationId || "")) } catch { throw new ApiError(404, "Tax registration not found") }
  if (registration.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax registration not found")
  return registration
}

function ownedObligation(app, tenantId, obligationId) {
  let obligation
  try { obligation = app.findRecordById("tax_obligations", String(obligationId || "")) } catch { throw new ApiError(404, "Tax obligation not found") }
  if (obligation.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax obligation not found")
  return obligation
}

function nonNegativeMoney(value, name, nullable) {
  if (nullable && (value === null || value === undefined || value === "")) return null
  const amount = Number(value)
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ApiError(400, `${name} must be a non-negative integer`)
  return amount
}

function isoDate(value, name, nullable) {
  const text = String(value || "")
  if (nullable && !text) return ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) throw new ApiError(400, `${name} must be YYYY-MM-DD`)
  return text
}

function audit(app, tenantId, subjectId, action, commandKeyValue, targetType, targetId, reason, before, after, actorId) {
  const effectiveActor = actorId || (taxRequestActor && taxRequestActor.tenantId === tenantId && Date.now() - taxRequestActor.at < 5_000 ? taxRequestActor.actorId : tenantId)
  app.save(new Record(app.findCollectionByNameOrId("tax_audit"), {
    tenant_id: tenantId, subject_id: subjectId || "", actor_id: effectiveActor,
    action, command_key: commandKeyValue || "", target_type: targetType, target_id: targetId || "",
    reason: String(reason || "").slice(0, 500), before: before || null, after: after || null,
  }))
}

function subjectResponse(record) {
  return {
    id: record.id, tenantId: record.getString("tenant_id"), label: record.getString("label"),
    type: record.getString("subject_type"), entityForm: record.getString("entity_form") || null,
    maskedTaxId: record.getString("masked_tax_id") || null,
    fiscalYearStartMonth: record.getInt("fiscal_year_start_month"), fiscalYearStartDay: record.getInt("fiscal_year_start_day"),
    timezone: record.getString("timezone"), status: record.getString("status"),
    umkmEligibility: record.getString("umkm_eligibility"),
    umkmEligibilityEffectiveFrom: record.getString("umkm_eligibility_effective_from") || null,
    revision: record.getInt("revision"), createdAt: record.getString("created"), updatedAt: record.getString("updated"),
  }
}

function recordJson(record) {
  return record.publicExport()
}

function jsonArray(record, field) {
  const exported = record.publicExport()
  const value = exported[field]
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "number")) {
      try { const decoded = JSON.parse(String.fromCharCode(...value)); if (Array.isArray(decoded)) return decoded.map(String) } catch { return [] }
    }
    return value.map(String)
  }
  try {
    const plain = JSON.parse(JSON.stringify(exported))
    if (Array.isArray(plain[field])) return plain[field].map(String)
  } catch { /* fall through to stored string */ }
  try {
    const parsed = JSON.parse(record.getString(field))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch { return [] }
}

function findAllRecords(app, collection, filter, sort, params, batchSize) {
  const size = Math.max(1, Math.min(500, Number(batchSize || 500)))
  const records = []
  let offset = 0
  while (true) {
    const page = app.findRecordsByFilter(collection, filter, sort || "", size, offset, params || {})
    records.push(...page)
    if (page.length < size) return records
    offset += page.length
  }
}

function obligationResponse(record) {
  const result = record.publicExport()
  result.liability_amount = record.getBool("has_liability_amount") ? record.getInt("liability_amount") : null
  result.proposed_liability_amount = record.getBool("has_proposed_liability_amount") ? record.getInt("proposed_liability_amount") : null
  result.remaining_payable = record.getBool("has_remaining_payable") ? record.getInt("remaining_payable") : null
  delete result.has_liability_amount
  delete result.has_proposed_liability_amount
  delete result.has_remaining_payable
  return result
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || !backup.manifest || backup.manifest.format !== "jornal-tax-backup" || Number(backup.manifest.version) !== 1) throw new ApiError(400, "Unsupported tax backup")
  if (!backup.data || typeof backup.data !== "object" || !backup.checksums || typeof backup.checksums !== "object") throw new ApiError(400, "Incomplete tax backup")
  for (const name of Object.keys(backup.data)) {
    if (!Array.isArray(backup.data[name])) throw new ApiError(400, `Invalid backup collection: ${name}`)
    if (String(backup.checksums[name] || "") !== $security.sha256(stableStringify(backup.data[name]))) throw new ApiError(400, `Backup checksum mismatch: ${name}`)
  }
  return backup
}

module.exports = {
  audit, commandHash, commandKey, findAllRecords, findCommand, isoDate, jsonArray, jsonBody, nonNegativeMoney,
  obligationResponse, ownedCompany, ownedObligation, ownedRegistration, ownedSubject, recordJson, requireTaxEnabled, requestTenant,
  replayCommand, saveCommand, stableStringify, subjectResponse, validateBackup,
}

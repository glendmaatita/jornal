onRecordCreateRequest((event) => {
  const { isJornalRecord, ownedActiveCompany, requireProtocolScope, validatePayloadReferences } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  const company = ownedActiveCompany(event, event.record.getString("company_id"))
  if (event.record.getString("business_id") !== company.getString("tenant_id")) throw new ApiError(404, "Company not found")
  const incomingEpoch = Number(event.record.get("data_epoch") || 0)
  if (incomingEpoch !== company.getInt("data_epoch")) throw new ApiError(409, "Data epoch is out of date")
  // A new logical record always starts at revision 1. Clients cannot reserve
  // an arbitrarily large revision and disrupt ordering for later writes.
  event.record.set("revision", 1)
  validatePayloadReferences(event, company.id)
  event.next()
})

onRecordUpdateRequest((event) => {
  const { isJornalRecord, ownedActiveCompany, requireProtocolScope, validatePayloadReferences } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  const collection = event.record.collection()
  const previous = $app.findRecordById(collection.id, event.record.id)
  // These fields define ownership and the stable client identity. Collection
  // rules authorize the existing row; they must not permit an update to move
  // it to another tenant or change which logical record it represents.
  const company = ownedActiveCompany(event, event.record.getString("company_id"))
  if (Number(event.record.get("data_epoch") || 0) !== company.getInt("data_epoch")) {
    throw new ApiError(409, "Data epoch is out of date")
  }
  for (const field of ["business_id", "company_id", "data_epoch", "entity", "app_id"]) {
    if (event.record.get(field) !== previous.get(field)) {
      throw new ApiError(400, `${field} cannot be changed`)
    }
  }
  const incomingRevision = Number(event.record.get("revision") || 0)
  const currentRevision = Number(previous.get("revision") || 0)
  if (incomingRevision !== currentRevision + 1) {
    throw new ApiError(409, "Revision is out of date")
  }
  validatePayloadReferences(event, company.id)
  event.next()
})

onRecordDeleteRequest((event) => {
  const { isJornalRecord, ownedActiveCompany, requireProtocolScope, validateNoInboundReferences } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  ownedActiveCompany(event, event.record.getString("company_id"))
  const headers = event.requestInfo().headers || {}
  if (Number(headers.x_jornal_revision || 0) !== event.record.getInt("revision")) throw new ApiError(409, "Revision is out of date")
  validateNoInboundReferences(event, event.record.getString("company_id"))
  // Keep a server-visible tombstone so another offline member cannot recreate
  // a record merely because it disappeared from a paginated list.
  event.record.set("deleted_at", new Date().toISOString())
  event.record.set("revision", event.record.getInt("revision") + 1)
  $app.save(event.record)
})

onRecordViewRequest((event) => {
  const { isJornalRecord, ownedActiveCompany, requireProtocolScope } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  ownedActiveCompany(event, event.record.getString("company_id"))
  event.next()
})

onRecordsListRequest((event) => {
  if (!event.collection || event.collection.name !== "jornal_records") return event.next()
  const headers = event.requestInfo().headers || {}
  const companyId = String(headers.x_jornal_company || "")
  require(`${__hooks}/jornal_helpers.js`).requireProtocolScope(event, companyId)
  require(`${__hooks}/company_access.js`).eventScope(event, companyId, {})
  event.next()
}, "jornal_records")

onFileDownloadRequest((event) => {
  if (!event.record || event.record.collection().name !== "jornal_records") return event.next()
  const info = event.requestInfo(); const query = info.query || {}
  if (String(query.protocol || "") !== "3") throw new ApiError(426, "Client update required")
  if (String(query.company || "") !== event.record.getString("company_id")) throw new ApiError(404, "File not found")
  const rawGrant = String(query.grant || "")
  let grant
  try { grant = $app.findFirstRecordByFilter("company_file_grants", "token_hash = {:hash}", { hash: $security.sha256(rawGrant) }) } catch { throw new ApiError(404, "File not found") }
  if (!rawGrant || grant.getString("company_id") !== event.record.getString("company_id") || Date.parse(grant.getString("expires_at").replace(" ", "T")) <= Date.now()) throw new ApiError(404, "File not found")
  require(`${__hooks}/company_access.js`).companyScope($app, grant.getString("user_id"), event.record.getString("company_id"), {})
  event.next()
}, "jornal_records")

routerAdd("POST", "/api/jornal/companies/{id}/file-token", (event) => {
  const companyId = event.request.pathValue("id")
  require(`${__hooks}/company_access.js`).eventScope(event, companyId, {})
  const grantNow = new Date().toISOString()
  while (true) {
    const expired = $app.findRecordsByFilter("company_file_grants", "expires_at <= {:now}", "expires_at,id", 100, 0, { now: grantNow })
    for (const row of expired) $app.delete(row)
    if (expired.length < 100) break
  }
  const rawGrant = $security.randomString(48)
  $app.save(new Record($app.findCollectionByNameOrId("company_file_grants"), {
    token_hash: $security.sha256(rawGrant), user_id: event.auth.id, company_id: companyId,
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
  }))
  return event.json(200, { token: event.auth.newFileToken(), grant: rawGrant, expiresIn: 120 })
}, $apis.requireAuth())

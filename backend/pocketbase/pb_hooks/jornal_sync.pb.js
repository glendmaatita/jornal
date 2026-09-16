onRecordCreateRequest((event) => {
  const { isJornalRecord, ownedActiveCompany, requireProtocolScope, validatePayloadReferences } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  const company = ownedActiveCompany(event, event.record.getString("company_id"))
  if (event.record.getString("business_id") !== event.auth.id) throw new ApiError(404, "Company not found")
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
  validateNoInboundReferences(event, event.record.getString("company_id"))
  event.next()
})

onRecordViewRequest((event) => {
  const { isJornalRecord, requireProtocolScope } = require(`${__hooks}/jornal_helpers.js`)
  if (!isJornalRecord(event)) return event.next()
  requireProtocolScope(event, event.record.getString("company_id"))
  event.next()
})

onFileDownloadRequest((event) => {
  if (!event.record || event.record.collection().name !== "jornal_records") return event.next()
  const query = event.requestInfo().query || {}
  if (String(query.protocol || "") !== "2") throw new ApiError(426, "Client update required")
  if (String(query.company || "") !== event.record.getString("company_id")) throw new ApiError(404, "File not found")
  event.next()
}, "jornal_records")

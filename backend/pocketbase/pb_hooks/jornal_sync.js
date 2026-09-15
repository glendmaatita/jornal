// Server-side guard for the revision metadata added in migration 0005.
// PocketBase collection rules still provide tenant isolation; this hook adds
// ordering protection so a stale client cannot overwrite a newer record.
function isJornalRecord(event) {
  return event.record && event.record.collection().name === "jornal_records"
}

onRecordCreateRequest((event) => {
  if (!isJornalRecord(event)) return
  // A new logical record always starts at revision 1. Clients cannot reserve
  // an arbitrarily large revision and disrupt ordering for later writes.
  event.record.set("revision", 1)
  event.next()
})

onRecordUpdateRequest((event) => {
  if (!isJornalRecord(event)) return
  const collection = event.record.collection()
  const previous = $app.findRecordById(collection.id, event.record.id)
  // These fields define ownership and the stable client identity. Collection
  // rules authorize the existing row; they must not permit an update to move
  // it to another tenant or change which logical record it represents.
  for (const field of ["business_id", "entity", "app_id"]) {
    if (event.record.get(field) !== previous.get(field)) {
      throw new ApiError(400, `${field} cannot be changed`)
    }
  }
  const incomingRevision = Number(event.record.get("revision") || 0)
  const currentRevision = Number(previous.get("revision") || 0)
  if (incomingRevision !== currentRevision + 1) {
    throw new ApiError(409, "Revision is out of date")
  }
  event.next()
})

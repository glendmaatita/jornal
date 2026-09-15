// Server-side guard for the revision metadata added in migration 0005.
// PocketBase collection rules still provide tenant isolation; this hook adds
// ordering protection so a stale client cannot overwrite a newer record.
function isJornalRecord(event) {
  return event.record && event.record.collection().name === "jornal_records"
}

onRecordCreateRequest((event) => {
  if (!isJornalRecord(event)) return
  const revision = Number(event.record.get("revision") || 0)
  event.record.set("revision", revision > 0 ? revision : 1)
  event.next()
})

onRecordUpdateRequest((event) => {
  if (!isJornalRecord(event)) return
  const collection = event.record.collection()
  const previous = $app.findRecordById(collection.id, event.record.id)
  const incomingRevision = Number(event.record.get("revision") || 0)
  const currentRevision = Number(previous.get("revision") || 0)
  if (incomingRevision <= currentRevision) {
    throw new ApiError(409, "A newer revision already exists")
  }
  event.next()
})

function body(event) { return event.requestInfo().body || {} }
function now() { return new Date().toISOString() }
function error(status, code, message) { throw new ApiError(status, message, { code: new ValidationError(code, message) }) }
function requireFeature() { if ($os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") !== "true") error(503, "TEAM_INVITATIONS_DISABLED", "Undangan tim sementara tidak tersedia") }
function requireEmail(app) {
  const publicUrl = String($os.getenv("JORNAL_PUBLIC_URL") || "").replace(/\/$/, "")
  const settings = app.settings()
  if ($os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") !== "true" || !settings.smtp.enabled || !settings.smtp.host || !settings.meta.senderAddress || (!/^https:\/\//.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl))) error(503, "TEAM_EMAIL_UNAVAILABLE", "Pengiriman email undangan belum tersedia")
}
function isoBefore(milliseconds) { return new Date(Date.now() - milliseconds).toISOString() }
function rateLimit(app, actorId, companyId, email) {
  const minute = app.findRecordsByFilter("team_invitation_deliveries", "requested_by = {:actor} && created >= {:since}", "", 11, 0, { actor: actorId, since: isoBefore(60_000) })
  if (minute.length >= 10) error(429, "INVITE_RATE_LIMITED", "Terlalu banyak undangan; coba lagi sebentar")
  const day = app.findRecordsByFilter("team_invitation_deliveries", "company_id = {:company} && created >= {:since}", "", 51, 0, { company: companyId, since: isoBefore(86_400_000) })
  if (day.length >= 50) error(429, "COMPANY_INVITE_LIMITED", "Batas undangan harian company tercapai")
  const pair = app.findRecordsByFilter("team_invitation_deliveries", "company_id = {:company} && recipient_email = {:email} && created >= {:since}", "-created", 6, 0, { company: companyId, email, since: isoBefore(86_400_000) })
  if (pair.length >= 5) error(429, "RECIPIENT_INVITE_LIMITED", "Batas undangan untuk email ini tercapai")
  if (pair.length && Date.parse(pair[0].getString("created").replace(" ", "T")) > Date.now() - 60_000) error(429, "RECIPIENT_COOLDOWN", "Tunggu satu menit sebelum mengirim ulang")
}
function findInvitation(app, id, companyId) {
  let row
  try { row = app.findRecordById("company_invitations", String(id || "")) } catch { error(404, "INVITATION_NOT_FOUND", "Undangan tidak ditemukan") }
  if (row.getString("company_id") !== companyId) error(404, "INVITATION_NOT_FOUND", "Undangan tidak ditemukan")
  return row
}
function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) error(400, "INVALID_GOOGLE_EMAIL", "Email akun Google tidak valid")
  return email
}
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`
}
function commandInput(bodyValue, action, target) {
  const key = String(bodyValue.commandKey || "").trim()
  if (!key || key.length > 100) error(400, "COMMAND_KEY_REQUIRED", "commandKey wajib diisi")
  const copy = Object.assign({}, bodyValue); delete copy.commandKey
  return { key, action, hash: $security.sha256(`${action}:${target || ""}:${stableStringify(copy)}`) }
}
function replayCommand(app, actorId, companyId, command) {
  let row
  try { row = app.findFirstRecordByFilter("team_commands", "actor_user_id = {:actor} && company_id = {:company} && command_key = {:key}", { actor: actorId, company: companyId, key: command.key }) } catch { return null }
  if (row.getString("action") !== command.action || row.getString("request_hash") !== command.hash) error(409, "COMMAND_KEY_REUSED", "Kunci perintah sudah digunakan untuk permintaan lain")
  return { status: row.getInt("response_status"), body: json(row, "response_body", {}) }
}
function saveCommand(app, actorId, companyId, command, status, response) {
  app.save(new Record(app.findCollectionByNameOrId("team_commands"), {
    actor_user_id: actorId, company_id: companyId, command_key: command.key,
    action: command.action, request_hash: command.hash, response_status: status, response_body: response,
  }))
}
function json(record, field, fallback) {
  const raw = record.get(field)
  if (raw && typeof raw === "object" && typeof raw.get !== "function") {
    if (Array.isArray(raw) && raw.every((item) => typeof item === "number")) { try { return JSON.parse(String.fromCharCode(...raw)) } catch { return fallback } }
    return raw
  }
  try { return JSON.parse(record.getString(field)) } catch { return fallback }
}
function invitationResponse(record, delivery) {
  return {
    id: record.id, publicId: record.getString("public_id"), companyId: record.getString("company_id"),
    email: record.getString("email_normalized"), status: record.getString("status"), expiresAt: record.getString("expires_at"),
    generation: record.getInt("send_generation"), revision: record.getInt("revision"), invitedBy: record.getString("invited_by"),
    acceptedBy: record.getString("accepted_by") || null, acceptedAt: record.getString("accepted_at") || null,
    delivery: delivery ? { status: delivery.getString("status"), attemptCount: delivery.getInt("attempt_count"), sentAt: delivery.getString("sent_at") || null, errorCode: delivery.getString("last_error_code") || null } : null,
    createdAt: record.getString("created"), updatedAt: record.getString("updated"),
  }
}
function membershipResponse(record, user) {
  return {
    id: record.id,
    userId: record.getString("user_id"), status: record.getString("status"), joinedAt: record.getString("joined_at"),
    revision: record.getInt("revision"), name: user ? user.getString("name") || user.getString("email") : "Anggota",
    email: user ? user.getString("email") : "",
  }
}
function companyResponse(company, membership) {
  const companyHelpers = require(`${__hooks}/company_helpers.js`)
  return Object.assign(companyHelpers.companyResponse(company), { membershipRevision: membership.getInt("revision") })
}
function catalog(app, actorId, after, limit) {
  const pageSize = Math.max(1, Math.min(100, Number(limit || 50)))
  const filter = `user_id = {:user} && status = 'ACTIVE'${after ? " && id > {:after}" : ""}`
  const params = { user: actorId }; if (after) params.after = String(after)
  const rows = app.findRecordsByFilter("company_memberships", filter, "id", pageSize + 1, 0, params)
  const items = []
  for (const membership of rows.slice(0, pageSize)) {
    let company
    try { company = app.findRecordById("companies", membership.getString("company_id")) } catch { continue }
    items.push(companyResponse(company, membership))
  }
  return { items, cursor: rows.length > pageSize ? rows[pageSize - 1].id : null, hasMore: rows.length > pageSize }
}
function latestDelivery(app, invitationId) {
  try { return app.findRecordsByFilter("team_invitation_deliveries", "invitation_id = {:invitation}", "-generation", 1, 0, { invitation: invitationId })[0] || null } catch { return null }
}
function identityFor(app, userId) {
  try { return app.findFirstRecordByFilter("user_google_identities", "user_id = {:user} && email_verified = true", { user: userId }) } catch { return null }
}
function claimInvitation(app, invitationId, actorId, email) {
  const access = require(`${__hooks}/company_access.js`)
  let invitation
  try { invitation = app.findRecordById("company_invitations", invitationId) } catch { return { accepted: false, status: "UNAVAILABLE" } }
  if (invitation.getString("status") !== "PENDING" || invitation.getString("email_normalized") !== email) return { accepted: false, status: invitation.getString("status") || "UNAVAILABLE" }
  if (Date.parse(invitation.getString("expires_at").replace(" ", "T")) <= Date.now()) {
    invitation.set("status", "EXPIRED"); invitation.set("revision", invitation.getInt("revision") + 1); app.save(invitation)
    cancelDeliveries(app, invitation.id, "INVITATION_EXPIRED")
    return { accepted: false, status: "EXPIRED" }
  }
  let company
  try { company = app.findRecordById("companies", invitation.getString("company_id")) } catch { return { accepted: false, status: "UNAVAILABLE" } }
  if (company.getString("status") !== "ACTIVE" || !company.getString("onboarding_completed_at")) return { accepted: false, status: "COMPANY_NOT_READY" }
  try { access.membershipFor(app, invitation.getString("invited_by"), company.id, true) } catch {
    invitation.set("status", "REVOKED"); invitation.set("revoked_at", now()); invitation.set("revision", invitation.getInt("revision") + 1); app.save(invitation)
    cancelDeliveries(app, invitation.id, "INVITER_NO_LONGER_MEMBER")
    return { accepted: false, status: "REVOKED" }
  }
  let membership
  try { membership = app.findFirstRecordByFilter("company_memberships", "company_id = {:company} && user_id = {:user}", { company: company.id, user: actorId }) } catch { membership = null }
  const wasActive = membership && membership.getString("status") === "ACTIVE"
  if (!membership) membership = new Record(app.findCollectionByNameOrId("company_memberships"), { company_id: company.id, user_id: actorId, revision: 1 })
  else if (!wasActive) membership.set("revision", membership.getInt("revision") + 1)
  if (!wasActive) {
    membership.set("status", "ACTIVE"); membership.set("joined_at", now()); membership.set("invited_by", invitation.getString("invited_by")); membership.set("source_invitation_id", invitation.id); membership.set("revoked_at", ""); membership.set("revoked_by", ""); app.save(membership)
  }
  invitation.set("status", "ACCEPTED"); invitation.set("accepted_by", actorId); invitation.set("accepted_at", now()); invitation.set("revision", invitation.getInt("revision") + 1); app.save(invitation)
  cancelDeliveries(app, invitation.id, "INVITATION_ACCEPTED")
  const scope = access.companyScope(app, actorId, company.id, {})
  audit(app, scope, "team-joined", "", { userId: actorId, invitationId: invitation.id })
  return { accepted: true, status: "ACCEPTED", companyId: company.id, membership }
}
function audit(app, scope, action, requestId, target) {
  const row = new Record(app.findCollectionByNameOrId("company_audit"), {
    tenant_id: scope.ownerTenantId, company_id: scope.companyId, actor_id: scope.actorUserId,
    action, request_id: String(requestId || "").slice(0, 100),
  })
  if (target?.userId) row.set("target_user_id", target.userId)
  if (target?.email) row.set("target_email", String(target.email).slice(0, 320))
  if (target?.invitationId) row.set("target_invitation_id", target.invitationId)
  app.save(row)
}
function cancelDeliveries(app, invitationId, reason) {
  const rows = app.findRecordsByFilter("team_invitation_deliveries", "invitation_id = {:invitation} && (status = 'QUEUED' || status = 'LEASED' || status = 'RETRYABLE_FAILED')", "id", 0, 0, { invitation: invitationId })
  for (const row of rows) { row.set("status", "CANCELLED"); row.set("lease_until", ""); row.set("lease_id", ""); row.set("last_error_code", String(reason || "CANCELLED").slice(0, 100)); app.save(row) }
}
function queueDelivery(app, invitation, requestedBy) {
  const timestamp = now()
  const delivery = new Record(app.findCollectionByNameOrId("team_invitation_deliveries"), {
    invitation_id: invitation.id, company_id: invitation.getString("company_id"), generation: invitation.getInt("send_generation"), requested_by: requestedBy,
    recipient_email: invitation.getString("email_normalized"), status: "QUEUED", attempt_count: 0,
    next_attempt_at: timestamp,
  })
  app.save(delivery)
  return delivery
}
function assertExpectedRevision(record, value) {
  const expected = Number(value || 0)
  if (!Number.isSafeInteger(expected) || expected !== record.getInt("revision")) error(409, "REVISION_CONFLICT", "Data tim telah berubah; muat ulang")
}
function enabled() { return $os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") === "true" }
function emailEnabled() { return $os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") === "true" }

function revokeMember(event, targetUserId, leave) {
  const access = require(`${__hooks}/company_access.js`); const input = body(event)
  const companyId = event.request.pathValue("id"); const scope = access.eventScope(event, companyId, { writable: true })
  if (leave && targetUserId !== event.auth.id) error(400, "INVALID_MEMBER", "Permintaan keluar tidak valid")
  const command = commandInput(input, leave ? "LEAVE" : "REMOVE_MEMBER", targetUserId); const replay = replayCommand($app, event.auth.id, companyId, command); if (replay) return event.json(replay.status, replay.body)
  let response
  $app.runInTransaction((tx) => {
    access.companyScope(tx, event.auth.id, companyId, { writable: true })
    const target = access.membershipFor(tx, targetUserId, companyId, true); assertExpectedRevision(target, input.expectedRevision)
    const active = tx.findRecordsByFilter("company_memberships", "company_id = {:company} && status = 'ACTIVE'", "id", 2, 0, { company: companyId })
    if (active.length <= 1) error(409, "LAST_MEMBER", "Anggota aktif terakhir tidak dapat keluar atau dihapus")
    target.set("status", "REVOKED"); target.set("revoked_by", event.auth.id); target.set("revoked_at", now()); target.set("revision", target.getInt("revision") + 1); tx.save(target)
    const issued = tx.findRecordsByFilter("company_invitations", "company_id = {:company} && invited_by = {:user} && status = 'PENDING'", "id", 0, 0, { company: companyId, user: targetUserId })
    for (const invitation of issued) { invitation.set("status", "REVOKED"); invitation.set("revoked_by", event.auth.id); invitation.set("revoked_at", now()); invitation.set("revision", invitation.getInt("revision") + 1); tx.save(invitation); cancelDeliveries(tx, invitation.id, "INVITER_REMOVED") }
    const pendingPush = tx.findRecordsByFilter("notification_deliveries", "recipient_user_id = {:user} && company_id = {:company} && (status = 'PENDING' || status = 'LEASED' || status = 'RETRYABLE_FAILED')", "id", 0, 0, { user: targetUserId, company: companyId })
    for (const row of pendingPush) { row.set("status", "CANCELLED"); row.set("lease_id", ""); row.set("lease_until", ""); row.set("last_error", "Membership revoked"); tx.save(row) }
    response = { userId: targetUserId, status: "REVOKED", revision: target.getInt("revision") }
    saveCommand(tx, event.auth.id, companyId, command, 200, response); audit(tx, scope, leave ? "team-left" : "team-member-removed", command.key, { userId: targetUserId })
  })
  return event.json(200, response)
}

module.exports = {
  assertExpectedRevision, audit, body, cancelDeliveries, catalog, commandInput, companyResponse,
  emailEnabled, enabled, error, findInvitation, claimInvitation, identityFor, invitationResponse,
  json, latestDelivery, membershipResponse, normalizeEmail, now, queueDelivery, rateLimit,
  replayCommand, requireEmail, requireFeature, revokeMember, saveCommand, stableStringify,
}

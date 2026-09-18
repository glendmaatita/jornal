function teamEscape(value) { return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]) }
function teamPublicUrl() {
  const raw = String($os.getenv("JORNAL_PUBLIC_URL") || "").replace(/\/$/, "")
  if (!/^https:\/\//.test(raw) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(raw)) return ""
  return raw
}
function teamClaim(limit) {
  if ($os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") !== "true" || $os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") !== "true") return []
  const now = new Date().toISOString(); const claimed = []
  $app.runInTransaction((tx) => {
    const rows = tx.findRecordsByFilter("team_invitation_deliveries", "(status = 'QUEUED' || status = 'RETRYABLE_FAILED') && next_attempt_at <= {:now}", "next_attempt_at,id", Math.max(1, Math.min(50, Number(limit || 50))), 0, { now })
    for (const row of rows) {
      const leaseId = $security.randomString(32)
      row.set("status", "LEASED"); row.set("lease_id", leaseId); row.set("lease_until", new Date(Date.now() + 120_000).toISOString()); tx.save(row)
      claimed.push({ id: row.id, leaseId })
    }
  })
  return claimed
}
function teamApplicable(app, item) {
  if ($os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") !== "true" || $os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") !== "true") return null
  const settings = app.settings()
  if (!settings.smtp.enabled || !settings.smtp.host || !settings.meta.senderAddress || !teamPublicUrl()) return null
  let delivery; try { delivery = app.findRecordById("team_invitation_deliveries", item.id) } catch { return null }
  if (delivery.getString("status") !== "LEASED" || delivery.getString("lease_id") !== item.leaseId) return null
  let invitation; try { invitation = app.findRecordById("company_invitations", delivery.getString("invitation_id")) } catch { return null }
  if (invitation.getString("status") !== "PENDING" || invitation.getInt("send_generation") !== delivery.getInt("generation")) return null
  if (delivery.getString("recipient_email") !== invitation.getString("email_normalized")) return null
  if (Date.parse(invitation.getString("expires_at").replace(" ", "T")) <= Date.now()) return null
  let company; try { company = app.findRecordById("companies", invitation.getString("company_id")) } catch { return null }
  if (company.getString("status") !== "ACTIVE" || !company.getString("onboarding_completed_at")) return null
  const access = require(`${__hooks}/company_access.js`)
  try { access.membershipFor(app, invitation.getString("invited_by"), company.id, true) } catch { return null }
  try { access.membershipFor(app, delivery.getString("requested_by"), company.id, true) } catch { return null }
  return { delivery, invitation, company }
}
function teamComplete(item, outcome, errorCode) {
  $app.runInTransaction((tx) => {
    let row; try { row = tx.findRecordById("team_invitation_deliveries", item.id) } catch { return }
    if (row.getString("status") !== "LEASED" || row.getString("lease_id") !== item.leaseId) return
    row.set("lease_id", ""); row.set("lease_until", "")
    if (outcome === "SENT") {
      row.set("attempt_count", row.getInt("attempt_count") + 1); row.set("status", "SENT"); row.set("sent_at", new Date().toISOString()); row.set("last_error_code", "")
    } else if (outcome === "DEFERRED") {
      row.set("status", "QUEUED"); row.set("last_error_code", String(errorCode || "DELIVERY_PAUSED").slice(0, 100)); row.set("next_attempt_at", new Date(Date.now() + 60_000).toISOString())
    } else if (outcome === "CANCELLED") {
      row.set("status", "CANCELLED"); row.set("last_error_code", String(errorCode || "NO_LONGER_APPLICABLE").slice(0, 100))
    } else {
      const attempts = row.getInt("attempt_count") + 1; row.set("attempt_count", attempts)
      const permanent = outcome === "PERMANENT" || attempts >= 5
      row.set("status", permanent ? "PERMANENTLY_FAILED" : "RETRYABLE_FAILED")
      row.set("last_error_code", String(errorCode || "SMTP_ERROR").slice(0, 100))
      if (!permanent) {
        const delays = [60_000, 300_000, 900_000, 3_600_000]
        const jitter = Math.floor(Math.random() * 30_000)
        let retryAt = Date.now() + delays[Math.min(attempts - 1, delays.length - 1)] + jitter
        try {
          const invitation = tx.findRecordById("company_invitations", row.getString("invitation_id"))
          const expiresAt = Date.parse(invitation.getString("expires_at").replace(" ", "T"))
          if (Number.isFinite(expiresAt)) retryAt = Math.min(retryAt, expiresAt - 1_000)
        } catch { /* applicability will cancel an orphaned delivery */ }
        if (retryAt <= Date.now()) { row.set("status", "PERMANENTLY_FAILED"); row.set("last_error_code", "INVITATION_EXPIRED") }
        else row.set("next_attempt_at", new Date(retryAt).toISOString())
      }
    }
    tx.save(row)
  })
}
function teamErrorClass(error) {
  const message = String(error || "").toLowerCase()
  if (/\b5\d\d\b|authentication|credential|recipient.*invalid|mailbox.*unavailable/.test(message)) return { outcome: "PERMANENT", code: "SMTP_PERMANENT" }
  return { outcome: "RETRYABLE", code: "SMTP_RETRYABLE" }
}
function teamDeliver() {
  const claimed = teamClaim(50)
  for (const item of claimed) {
    if ($os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") !== "true" || $os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") !== "true") { teamComplete(item, "DEFERRED", "DELIVERY_DISABLED"); continue }
    let current = teamApplicable($app, item)
    if (!current) { teamComplete(item, "CANCELLED", "NO_LONGER_APPLICABLE"); continue }
    let inviter; try { inviter = $app.findRecordById("users", current.invitation.getString("invited_by")) } catch { teamComplete(item, "CANCELLED", "INVITER_NOT_FOUND"); continue }
    const publicUrl = teamPublicUrl(); if (!publicUrl) { teamComplete(item, "PERMANENT", "PUBLIC_URL_MISSING"); continue }
    current = teamApplicable($app, item)
    if (!current) { teamComplete(item, "CANCELLED", "NO_LONGER_APPLICABLE"); continue }
    const inviteUrl = `${publicUrl}/invitations/${encodeURIComponent(current.invitation.getString("public_id"))}`
    const companyName = current.company.getString("name").replace(/[\r\n]+/g, " "); const inviterName = (inviter.getString("name") || inviter.getString("email") || "Anggota Jornal").replace(/[\r\n]+/g, " ")
    const mail = require(`${__hooks}/email_template.js`)
    const recipientEmail = current.delivery.getString("recipient_email")
    const expires = mail.emailFormatDateTime(current.invitation.getString("expires_at"))
    const messageId = `<team-${current.invitation.id}-${current.delivery.getInt("generation")}@jornal.dropify.id>`
    try {
      const settings = $app.settings()
      $app.newMailClient().send(new MailerMessage({
        from: { address: settings.meta.senderAddress, name: settings.meta.senderName || "Jornal" },
        to: [{ address: recipientEmail }],
        headers: { "Message-ID": messageId },
        subject: `Anda diundang ke ${companyName} di Jornal`,
        text: `${inviterName} mengundang Anda ke ${companyName} di Jornal. Gunakan akun Google ${recipientEmail} untuk masuk. Anda akan mendapat akses penuh untuk mengelola company ini, termasuk transaksi dan pengaturan. Undangan berlaku sampai ${expires}. Buka Jornal: ${inviteUrl}`,
        html: mail.emailLayout({
          publicUrl, title: `Undangan ke ${companyName} di Jornal`, preheader: `${inviterName} mengundang Anda ke ${companyName} di Jornal.`,
          heading: `Anda diundang ke ${mail.emailEscape(companyName)}`,
          paragraphs: [
            `<strong>${mail.emailEscape(inviterName)}</strong> mengundang Anda bergabung ke <strong>${mail.emailEscape(companyName)}</strong> di Jornal.`,
            `Masuk dengan akun Google <strong>${mail.emailEscape(recipientEmail)}</strong>. Anda akan mendapat akses penuh untuk mengelola company ini, termasuk transaksi dan pengaturan.`,
          ],
          cta: { label: "Terima undangan", url: inviteUrl },
          note: `Undangan berlaku sampai <strong>${mail.emailEscape(expires)}</strong>.`,
        }),
      }))
      $app.runInTransaction((tx) => {
        const row = tx.findRecordById("team_invitation_deliveries", item.id)
        if (row.getString("status") === "LEASED" && row.getString("lease_id") === item.leaseId) { row.set("message_id", messageId); tx.save(row) }
      })
      teamComplete(item, "SENT", "")
    } catch (error) { const kind = teamErrorClass(error); teamComplete(item, kind.outcome, kind.code) }
  }
  return { claimed: claimed.length }
}
function teamRecoverLeases() {
  const now = new Date().toISOString()
  let recovered = 0
  while (true) {
    const rows = $app.findRecordsByFilter("team_invitation_deliveries", "status = 'LEASED' && lease_until < {:now}", "lease_until,id", 100, 0, { now })
    if (!rows.length) break
    for (const row of rows) {
      const attempts = row.getInt("attempt_count") + 1; row.set("attempt_count", attempts)
      row.set("status", attempts >= 5 ? "PERMANENTLY_FAILED" : "RETRYABLE_FAILED")
      row.set("lease_id", ""); row.set("lease_until", ""); row.set("last_error_code", "LEASE_EXPIRED"); row.set("next_attempt_at", new Date(Date.now() + 60_000).toISOString()); $app.save(row)
      recovered += 1
    }
  }
  return recovered
}
function teamExpireInvitations() {
  const now = new Date().toISOString()
  const helpers = require(`${__hooks}/team_helpers.js`)
  let expired = 0
  while (true) {
    const rows = $app.findRecordsByFilter("company_invitations", "status = 'PENDING' && expires_at <= {:now}", "expires_at,id", 100, 0, { now })
    if (!rows.length) break
    for (const row of rows) { row.set("status", "EXPIRED"); row.set("revision", row.getInt("revision") + 1); $app.save(row); helpers.cancelDeliveries($app, row.id, "INVITATION_EXPIRED"); expired += 1 }
  }
  return expired
}
module.exports = { teamApplicable, teamClaim, teamComplete, teamDeliver, teamEscape, teamExpireInvitations, teamPublicUrl, teamRecoverLeases }

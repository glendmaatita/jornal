routerAdd("GET", "/api/jornal/companies", (event) => {
  const helpers = require(`${__hooks}/team_helpers.js`)
  const query = event.requestInfo().query || {}
  return event.json(200, helpers.catalog($app, event.auth.id, String(query.cursor || ""), query.limit))
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/session/bootstrap", (event) => {
  const helpers = require(`${__hooks}/team_helpers.js`)
  const access = require(`${__hooks}/company_access.js`)
  const input = helpers.body(event)
  const identity = helpers.identityFor($app, event.auth.id)
  const invitationPublicId = String(input.invitationPublicId || "").trim()
  const cursor = String(input.claimCursor || "").trim()
  const acceptedCompanyIds = []
  let invitationStatus = invitationPublicId ? "UNAVAILABLE" : null
  let invitationCompanyId = ""
  let claimComplete = true
  let nextCursor = null

  if (helpers.enabled() && identity) {
    const email = identity.getString("email_normalized")
    const filter = `email_normalized = {:email} && status = 'PENDING'${cursor ? " && id > {:cursor}" : ""}`
    const params = { email }; if (cursor) params.cursor = cursor
    const candidates = $app.findRecordsByFilter("company_invitations", filter, "id", 101, 0, params)
    claimComplete = candidates.length <= 100
    if (!claimComplete) nextCursor = candidates[99].id
    for (const candidate of candidates.slice(0, 100)) {
      let accepted = false
      try {
        $app.runInTransaction((tx) => {
          accepted = helpers.claimInvitation(tx, candidate.id, event.auth.id, email).accepted
        })
      } catch (error) {
        // Unique membership races are resolved by observing the committed row.
        try { access.membershipFor($app, event.auth.id, candidate.getString("company_id"), true); accepted = true } catch { throw error }
      }
      if (accepted) acceptedCompanyIds.push(candidate.getString("company_id"))
    }
  }

  if (invitationPublicId) {
    let invitation
    try { invitation = $app.findFirstRecordByFilter("company_invitations", "public_id = {:public}", { public: invitationPublicId }) } catch { invitation = null }
    if (invitation && identity && invitation.getString("email_normalized") === identity.getString("email_normalized")) {
      invitationStatus = invitation.getString("status")
      invitationCompanyId = invitation.getString("company_id")
      if (access.actorCanAccessCompany($app, event.auth.id, invitationCompanyId)) invitationStatus = "ACCEPTED"
    } else if (!identity) invitationStatus = "GOOGLE_LOGIN_REQUIRED"
  }
  const catalog = helpers.catalog($app, event.auth.id, "", 50)
  const target = invitationCompanyId && catalog.items.some((company) => company.id === invitationCompanyId)
    ? invitationCompanyId
    : acceptedCompanyIds.find((id) => catalog.items.some((company) => company.id === id)) || ""
  return event.json(200, {
    acceptedCompanyIds: [...new Set(acceptedCompanyIds)], claimCursor: nextCursor, claimComplete,
    invitationStatus, targetCompanyId: target || null, requiresGoogleLogin: !identity,
    nextAction: target || catalog.items.length ? "COMPANY" : "NO_COMPANY",
    companies: catalog.items, companyCursor: catalog.cursor, companyHasMore: catalog.hasMore,
  })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/invitations/{publicId}", (event) => {
  // Public links reveal neither existence nor company/recipient metadata.
  return event.json(200, { authenticationRequired: true })
})

routerAdd("GET", "/api/jornal/companies/{id}/team", (event) => {
  const access = require(`${__hooks}/company_access.js`); const helpers = require(`${__hooks}/team_helpers.js`)
  const companyId = event.request.pathValue("id"); access.eventScope(event, companyId, {})
  const query = event.requestInfo().query || {}; const limit = Math.max(1, Math.min(100, Number(query.limit || 50)))
  const memberCursor = String(query.memberCursor || ""); const invitationCursor = String(query.invitationCursor || "")
  const memberParams = { company: companyId }; if (memberCursor) memberParams.cursor = memberCursor
  const memberRows = $app.findRecordsByFilter("company_memberships", `company_id = {:company} && status = 'ACTIVE'${memberCursor ? " && id > {:cursor}" : ""}`, "id", limit + 1, 0, memberParams)
  const members = memberRows.slice(0, limit).map((membership) => {
    let user; try { user = $app.findRecordById("users", membership.getString("user_id")) } catch { user = null }
    return helpers.membershipResponse(membership, user)
  })
  const invitationParams = { company: companyId }; if (invitationCursor) invitationParams.cursor = invitationCursor
  const invitationRows = $app.findRecordsByFilter("company_invitations", `company_id = {:company}${invitationCursor ? " && id > {:cursor}" : ""}`, "id", limit + 1, 0, invitationParams)
  const invitations = invitationRows.slice(0, limit).map((row) => helpers.invitationResponse(row, helpers.latestDelivery($app, row.id)))
  return event.json(200, {
    members, invitations,
    memberCursor: memberRows.length > limit ? memberRows[limit - 1].id : null,
    invitationCursor: invitationRows.length > limit ? invitationRows[limit - 1].id : null,
  })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/invitations", (event) => {
  const access = require(`${__hooks}/company_access.js`); const helpers = require(`${__hooks}/team_helpers.js`)
  helpers.requireFeature(); helpers.requireEmail($app)
  const companyId = event.request.pathValue("id"); const scope = access.eventScope(event, companyId, { writable: true }); const input = helpers.body(event)
  if (!scope.company.getString("onboarding_completed_at")) helpers.error(409, "COMPANY_NOT_READY", "Company belum selesai disiapkan")
  const email = helpers.normalizeEmail(input.email); const command = helpers.commandInput(input, "INVITE", email)
  const replay = helpers.replayCommand($app, event.auth.id, companyId, command); if (replay) return event.json(replay.status, replay.body)
  let existingIdentity
  try { existingIdentity = $app.findFirstRecordByFilter("user_google_identities", "email_normalized = {:email} && email_verified = true", { email }) } catch { existingIdentity = null }
  if (existingIdentity && access.actorCanAccessCompany($app, existingIdentity.getString("user_id"), companyId)) helpers.error(409, "ALREADY_MEMBER", "Email tersebut sudah menjadi anggota")
  let pending
  try { pending = $app.findFirstRecordByFilter("company_invitations", "company_id = {:company} && email_normalized = {:email} && status = 'PENDING'", { company: companyId, email }) } catch { pending = null }
  if (pending && Date.parse(pending.getString("expires_at").replace(" ", "T")) > Date.now()) {
    const response = helpers.invitationResponse(pending, helpers.latestDelivery($app, pending.id))
    $app.runInTransaction((tx) => helpers.saveCommand(tx, event.auth.id, companyId, command, 200, response))
    return event.json(200, response)
  }
  let response; let responseStatus = 201
  try {
    $app.runInTransaction((tx) => {
      helpers.rateLimit(tx, event.auth.id, companyId, email)
      if (pending) { pending.set("status", "EXPIRED"); pending.set("revision", pending.getInt("revision") + 1); tx.save(pending); helpers.cancelDeliveries(tx, pending.id, "INVITATION_EXPIRED") }
      const timestamp = helpers.now()
      const invitation = new Record(tx.findCollectionByNameOrId("company_invitations"), {
        company_id: companyId, email_normalized: email, public_id: $security.randomString(48), status: "PENDING",
        invited_by: event.auth.id, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        send_generation: 1, last_requested_at: timestamp, revision: 1,
      })
      tx.save(invitation); const delivery = helpers.queueDelivery(tx, invitation, event.auth.id)
      response = helpers.invitationResponse(invitation, delivery)
      helpers.saveCommand(tx, event.auth.id, companyId, command, 201, response)
      helpers.audit(tx, scope, "team-invited", command.key, { email, invitationId: invitation.id })
    })
  } catch (error) {
    const committedReplay = helpers.replayCommand($app, event.auth.id, companyId, command)
    if (committedReplay) return event.json(committedReplay.status, committedReplay.body)
    let winner
    try { winner = $app.findFirstRecordByFilter("company_invitations", "company_id = {:company} && email_normalized = {:email} && status = 'PENDING'", { company: companyId, email }) } catch { throw error }
    if (Date.parse(winner.getString("expires_at").replace(" ", "T")) <= Date.now()) throw error
    response = helpers.invitationResponse(winner, helpers.latestDelivery($app, winner.id)); responseStatus = 200
    $app.runInTransaction((tx) => helpers.saveCommand(tx, event.auth.id, companyId, command, responseStatus, response))
  }
  return event.json(responseStatus, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/invitations/{invitationId}/resend", (event) => {
  const access = require(`${__hooks}/company_access.js`); const helpers = require(`${__hooks}/team_helpers.js`); const input = helpers.body(event)
  helpers.requireFeature(); helpers.requireEmail($app)
  const companyId = event.request.pathValue("id"); const scope = access.eventScope(event, companyId, { writable: true })
  const invitationId = event.request.pathValue("invitationId"); const command = helpers.commandInput(input, "RESEND", invitationId)
  const replay = helpers.replayCommand($app, event.auth.id, companyId, command); if (replay) return event.json(replay.status, replay.body)
  const current = helpers.findInvitation($app, invitationId, companyId); helpers.assertExpectedRevision(current, input.expectedRevision)
  if (current.getString("status") !== "PENDING" || Date.parse(current.getString("expires_at").replace(" ", "T")) <= Date.now()) helpers.error(409, "INVITATION_NOT_PENDING", "Undangan tidak lagi aktif")
  let response
  $app.runInTransaction((tx) => {
    const invitation = helpers.findInvitation(tx, invitationId, companyId); helpers.assertExpectedRevision(invitation, input.expectedRevision)
    helpers.rateLimit(tx, event.auth.id, companyId, invitation.getString("email_normalized"))
    helpers.cancelDeliveries(tx, invitation.id, "SUPERSEDED_BY_RESEND")
    invitation.set("send_generation", invitation.getInt("send_generation") + 1); invitation.set("expires_at", new Date(Date.now() + 7 * 86_400_000).toISOString()); invitation.set("last_requested_at", helpers.now()); invitation.set("revision", invitation.getInt("revision") + 1); tx.save(invitation)
    const delivery = helpers.queueDelivery(tx, invitation, event.auth.id); response = helpers.invitationResponse(invitation, delivery)
    helpers.saveCommand(tx, event.auth.id, companyId, command, 200, response); helpers.audit(tx, scope, "team-resent", command.key, { email: invitation.getString("email_normalized"), invitationId })
  })
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/invitations/{invitationId}/revoke", (event) => {
  const access = require(`${__hooks}/company_access.js`); const helpers = require(`${__hooks}/team_helpers.js`); const input = helpers.body(event)
  const companyId = event.request.pathValue("id"); const scope = access.eventScope(event, companyId, { writable: true }); const invitationId = event.request.pathValue("invitationId")
  const command = helpers.commandInput(input, "REVOKE_INVITATION", invitationId); const replay = helpers.replayCommand($app, event.auth.id, companyId, command); if (replay) return event.json(replay.status, replay.body)
  let response
  $app.runInTransaction((tx) => {
    const invitation = helpers.findInvitation(tx, invitationId, companyId); helpers.assertExpectedRevision(invitation, input.expectedRevision)
    if (invitation.getString("status") !== "PENDING") helpers.error(409, "INVITATION_NOT_PENDING", "Undangan tidak lagi aktif")
    invitation.set("status", "REVOKED"); invitation.set("revoked_by", event.auth.id); invitation.set("revoked_at", helpers.now()); invitation.set("revision", invitation.getInt("revision") + 1); tx.save(invitation); helpers.cancelDeliveries(tx, invitation.id, "INVITATION_REVOKED")
    response = helpers.invitationResponse(invitation, helpers.latestDelivery(tx, invitation.id)); helpers.saveCommand(tx, event.auth.id, companyId, command, 200, response); helpers.audit(tx, scope, "team-invitation-revoked", command.key, { email: invitation.getString("email_normalized"), invitationId })
  })
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/members/{userId}/remove", (event) => require(`${__hooks}/team_helpers.js`).revokeMember(event, event.request.pathValue("userId"), false), $apis.requireAuth())
routerAdd("POST", "/api/jornal/companies/{id}/leave", (event) => require(`${__hooks}/team_helpers.js`).revokeMember(event, event.auth.id, true), $apis.requireAuth())

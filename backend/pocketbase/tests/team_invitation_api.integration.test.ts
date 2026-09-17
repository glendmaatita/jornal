import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const pocketBaseBin = process.env.POCKETBASE_BIN
const integrationTest = pocketBaseBin && process.env.RUN_POCKETBASE_INTEGRATION === "1" ? test : test.skip
let pocketbase: ReturnType<typeof Bun.spawn> | null = null
let smtp: ReturnType<typeof Bun.listen> | null = null
let dataDirectory = ""

afterAll(async () => {
  pocketbase?.kill()
  if (pocketbase) await pocketbase.exited.catch(() => undefined)
  smtp?.stop(true)
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

integrationTest("team invitations are Google-bound, idempotent, shared, revocable, and delivered through SMTP", async () => {
  const messages: string[] = []
  let smtpMode: "SUCCESS" | "TRANSIENT" | "PERMANENT" = "SUCCESS"
  let buffer = ""
  let data = ""
  let inData = false
  smtp = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
    open(socket) { socket.write("220 localhost Jornal test SMTP\r\n") },
    data(socket, chunk) {
      buffer += Buffer.from(chunk).toString("utf8")
      if (inData) {
        data += buffer; buffer = ""
        const end = data.indexOf("\r\n.\r\n")
        if (end >= 0) {
          messages.push(data.slice(0, end)); data = data.slice(end + 5); inData = false
          socket.write(smtpMode === "TRANSIENT" ? "450 4.2.0 temporary failure\r\n" : smtpMode === "PERMANENT" ? "550 5.1.1 recipient rejected\r\n" : "250 2.0.0 queued\r\n")
        }
        return
      }
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n"); const line = buffer.slice(0, index); buffer = buffer.slice(index + 2)
        const command = line.toUpperCase()
        if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250-localhost\r\n250 SIZE 12000000\r\n")
        else if (command.startsWith("MAIL FROM") || command.startsWith("RCPT TO")) socket.write("250 2.1.0 OK\r\n")
        else if (command === "DATA") { inData = true; socket.write("354 End data\r\n") }
        else if (command === "QUIT") { socket.write("221 bye\r\n"); socket.end() }
        else socket.write("250 OK\r\n")
      }
    },
  } })

  dataDirectory = await mkdtemp(join(tmpdir(), "jornal-team-integration-"))
  const migrations = resolve(import.meta.dir, "../pb_migrations")
  const hooks = resolve(import.meta.dir, "../pb_hooks")
  const run = (args: string[]) => {
    const result = Bun.spawnSync([pocketBaseBin!, ...args], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  run(["migrate", "up", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks])
  run(["superuser", "upsert", "admin@example.com", "StrongPass123!", "--dir", dataDirectory])
  const port = 33_000 + Math.floor(Math.random() * 1_000)
  const origin = `http://127.0.0.1:${port}`
  pocketbase = Bun.spawn([
    pocketBaseBin!, "serve", "--dir", dataDirectory, "--migrationsDir", migrations,
    "--hooksDir", hooks, `--http=127.0.0.1:${port}`,
  ], {
    stdout: "ignore", stderr: "pipe",
    env: { ...process.env, JORNAL_TEAM_INVITATIONS_ENABLED: "true", JORNAL_TEAM_INVITATION_EMAIL_ENABLED: "true", JORNAL_PUBLIC_URL: origin },
  })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) break
    await Bun.sleep(50)
  }
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}${path}`, init)
    // Integration assertions intentionally traverse heterogeneous PocketBase payloads.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { response, data: await response.json().catch(() => ({})) as Record<string, any> }
  }
  const headers = (token: string) => ({ Authorization: token, "Content-Type": "application/json" })
  const admin = await send("/api/collections/_superusers/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin@example.com", password: "StrongPass123!" }),
  })
  const adminToken = String(admin.data.token)
  const settings = await send("/api/settings", {
    method: "PATCH", headers: headers(adminToken), body: JSON.stringify({
      smtp: { enabled: true, host: "127.0.0.1", port: smtp.port, username: "", password: "", authMethod: "PLAIN", tls: false, localName: "localhost" },
      meta: { appName: "Jornal", appURL: origin, senderName: "Jornal", senderAddress: "noreply@jornal.test", hideControls: false },
    }),
  })
  expect(settings.response.status).toBe(200)

  const createUser = async (email: string, name: string, withGoogleIdentity = true) => {
    const created = await send("/api/collections/users/records", {
      method: "POST", headers: headers(adminToken),
      body: JSON.stringify({ email, name, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" }),
    })
    expect(created.response.status).toBe(200)
    if (withGoogleIdentity) {
      const identity = await send("/api/collections/user_google_identities/records", {
        method: "POST", headers: headers(adminToken),
        body: JSON.stringify({ user_id: created.data.id, provider_subject: `google-${created.data.id}`, email_normalized: email.trim().toLowerCase(), email_verified: true, verified_at: new Date().toISOString() }),
      })
      expect(identity.response.status).toBe(200)
    }
    const auth = await send(`/api/collections/users/impersonate/${created.data.id}`, { method: "POST", headers: { Authorization: adminToken } })
    return { id: String(created.data.id), token: String(auth.data.token), email }
  }
  const owner = await createUser("owner@example.com", "<Owner & Co>")
  const invited = await createUser("member+team@example.com", "Member")
  const wrong = await createUser("wrong@example.com", "Wrong")
  const revoked = await createUser("revoked@example.com", "Revoked")
  const setupCompany = async (user: typeof owner, name: string, key: string) => send("/api/jornal/companies/setup", {
    method: "POST", headers: headers(user.token), body: JSON.stringify({
      name, creationKey: key, requestId: key, initialSetup: true,
      profile: { businessName: name, businessType: "INDIVIDUAL", taxScheme: "NOT_CALCULATED" },
      accounts: [{ id: `${key}-cash`, name: "Cash", type: "CASH", openingBalance: 321_000, includedInCash: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }),
  })
  const setup = await setupCompany(owner, "<Toko & Co>", "owner-company")
  expect(setup.response.status).toBe(201)
  const companyId = String(setup.data.id)

  const passwordLogin = await send("/api/collections/users/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: owner.email, password: "UserPass123!" }),
  })
  expect(passwordLogin.response.status).toBe(403)
  const publicProbe = await send("/api/jornal/invitations/not-a-real-id")
  expect(publicProbe.data).toEqual({ authenticationRequired: true })

  const inviteBody = { email: "  Member+Team@Example.com ", commandKey: "invite-member" }
  const invitation = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify(inviteBody) })
  expect(invitation.response.status).toBe(201)
  expect(invitation.data.email).toBe("member+team@example.com")
  expect(invitation.data.delivery.status).toBe("QUEUED")
  const replay = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify(inviteBody) })
  expect(replay.response.status).toBe(201)
  expect(replay.data.id).toBe(invitation.data.id)
  const duplicate = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: invited.email, commandKey: "invite-member-duplicate" }) })
  expect(duplicate.response.status).toBe(200)
  expect(duplicate.data.id).toBe(invitation.data.id)

  const wrongBootstrap = await send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(wrong.token), body: JSON.stringify({ invitationPublicId: invitation.data.publicId }) })
  expect(wrongBootstrap.data.invitationStatus).toBe("UNAVAILABLE")
  expect(wrongBootstrap.data.acceptedCompanyIds).toEqual([])
  const noGoogle = await createUser("nogoogle@example.com", "No Google", false)
  const noGoogleBootstrap = await send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(noGoogle.token), body: "{}" })
  expect(noGoogleBootstrap.data.requiresGoogleLogin).toBe(true)

  const runJobs = await send("/api/jornal/admin/team/run-jobs", { method: "POST", headers: { Authorization: adminToken } })
  expect(runJobs.response.status).toBe(200)
  expect(runJobs.data.claimed).toBe(1)
  for (let attempt = 0; attempt < 20 && messages.length === 0; attempt += 1) await Bun.sleep(25)
  expect(messages).toHaveLength(1)
  expect(messages[0]).toContain("member+team@example.com")
  expect(messages[0]).toContain(String(invitation.data.publicId))
  expect(messages[0]).toContain("&lt;Owner &amp; Co&gt;")
  expect(messages[0]).toContain("&lt;T=")
  expect(messages[0]).toContain("oko &amp; Co&gt;")
  expect(messages[0]).not.toContain("321000")

  const racingInvites = await Promise.all([
    send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: "race@example.com", commandKey: "race-invite-a" }) }),
    send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: "race@example.com", commandKey: "race-invite-b" }) }),
  ])
  expect(racingInvites.map((item) => item.response.status).sort()).toEqual([200, 201])
  expect(racingInvites[0].data.id).toBe(racingInvites[1].data.id)
  const racingDeliveries = await send(`/api/collections/team_invitation_deliveries/records?filter=${encodeURIComponent(`invitation_id = '${racingInvites[0].data.id}'`)}`, { headers: { Authorization: adminToken } })
  expect(racingDeliveries.data.totalItems).toBe(1)
  await send(`/api/jornal/companies/${companyId}/invitations/${racingInvites[0].data.id}/revoke`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ expectedRevision: racingInvites[0].data.revision, commandKey: "race-cleanup" }) })

  const accepted = await Promise.all([
    send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(invited.token), body: JSON.stringify({ invitationPublicId: invitation.data.publicId }) }),
    send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(invited.token), body: JSON.stringify({ invitationPublicId: invitation.data.publicId }) }),
  ])
  expect(accepted.every((result) => result.response.status === 200)).toBe(true)
  const catalog = await send("/api/jornal/companies?limit=100", { headers: { Authorization: invited.token } })
  expect(catalog.data.items).toHaveLength(1)
  expect(catalog.data.items[0].id).toBe(companyId)
  expect(catalog.data.items[0].tenantId).toBe(owner.id)
  const alreadyMember = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: invited.email, commandKey: "already-member" }) })
  expect(alreadyMember.response.status).toBe(409)
  expect(alreadyMember.data.data.code.code).toBe("ALREADY_MEMBER")
  const records = await send("/api/collections/jornal_records/records?perPage=100", { headers: { Authorization: invited.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": companyId } })
  expect(records.response.status).toBe(200)
  expect(records.data.totalItems).toBe(3)
  const oldInvoiceClient = await send(`/api/jornal/invoicing/settings?companyId=${companyId}&dataEpoch=1`, { headers: { Authorization: invited.token } })
  expect(oldInvoiceClient.response.status).toBe(426)
  const invoiceAccess = await send(`/api/jornal/invoicing/settings?companyId=${companyId}&dataEpoch=1`, { headers: { Authorization: invited.token, "X-Jornal-Protocol": "3" } })
  expect(invoiceAccess.response.status).toBe(200)
  const documentAccess = await send(`/api/jornal/documents?companyId=${companyId}&dataEpoch=1`, { headers: { Authorization: invited.token, "X-Jornal-Protocol": "3" } })
  expect(documentAccess.response.status).toBe(200)
  const taxAccess = await send(`/api/jornal/tax/configuration?companyId=${companyId}`, { headers: { Authorization: invited.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": companyId } })
  expect(taxAccess.response.status).toBe(200)
  const renamed = await send(`/api/jornal/companies/${companyId}`, { method: "PATCH", headers: headers(invited.token), body: JSON.stringify({ name: "Shared Company", revision: setup.data.revision, requestId: "shared-rename" }) })
  expect(renamed.response.status).toBe(200)
  expect(renamed.data.membershipRevision).toBe(1)
  const ownerCatalogAfterRename = await send("/api/jornal/companies?limit=100", { headers: { Authorization: owner.token } })
  expect(ownerCatalogAfterRename.data.items[0].name).toBe("Shared Company")
  const sharedCustomer = await send("/api/jornal/invoicing/customers", { method: "POST", headers: { ...headers(invited.token), "X-Jornal-Protocol": "3" }, body: JSON.stringify({ companyId, dataEpoch: 1, commandKey: "shared-customer", name: "Pelanggan Anggota" }) })
  expect(sharedCustomer.response.status).toBe(201)
  const ownerCustomers = await send(`/api/jornal/invoicing/customers?companyId=${companyId}&dataEpoch=1`, { headers: { Authorization: owner.token, "X-Jornal-Protocol": "3" } })
  expect(ownerCustomers.data.items.some((item: Record<string, unknown>) => item.name === "Pelanggan Anggota")).toBe(true)
  const invoiceAudit = await send(`/api/collections/invoice_audit/records?filter=${encodeURIComponent("command_key = 'shared-customer'")}`, { headers: { Authorization: adminToken } })
  expect(invoiceAudit.data.items[0].actor_id).toBe(invited.id)

  const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
  const documentForm = new FormData()
  documentForm.set("companyId", companyId); documentForm.set("dataEpoch", "1"); documentForm.set("source", "UPLOAD"); documentForm.set("filename", "shared.png"); documentForm.set("contentBase64", tinyPng)
  documentForm.set("file", new File([Uint8Array.from(atob(tinyPng), (value) => value.charCodeAt(0))], "shared.png", { type: "image/png" }))
  const sharedDocument = await send("/api/jornal/documents", { method: "POST", headers: { Authorization: invited.token, "X-Jornal-Protocol": "3" }, body: documentForm })
  expect(sharedDocument.response.status).toBe(201)
  const ownerDocuments = await send(`/api/jornal/documents?companyId=${companyId}&dataEpoch=1`, { headers: { Authorization: owner.token, "X-Jornal-Protocol": "3" } })
  expect(ownerDocuments.data.items.some((item: Record<string, unknown>) => item.filename === "shared.png")).toBe(true)

  const sharedTax = await send("/api/jornal/tax/setup", { method: "POST", headers: { ...headers(invited.token), "X-Jornal-Protocol": "3", "X-Jornal-Company": companyId }, body: JSON.stringify({ commandKey: "shared-tax", label: "Pajak Shared", subjectType: "INDIVIDUAL", companyIds: [companyId], effectiveFrom: "2026-01-01", registrations: [], inAppEnabled: true }) })
  expect(sharedTax.response.status).toBe(201)
  const ownerTax = await send(`/api/jornal/tax/configuration?companyId=${companyId}`, { headers: { Authorization: owner.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": companyId } })
  expect(ownerTax.data.subjects).toHaveLength(1)

  const team = await send(`/api/jornal/companies/${companyId}/team`, { headers: { Authorization: invited.token } })
  expect(team.data.members).toHaveLength(2)
  const invitedMembership = team.data.members.find((member: Record<string, unknown>) => member.userId === invited.id)
  expect(invitedMembership.revision).toBe(1)
  const nativeMembershipMutation = await send(`/api/collections/company_memberships/records/${invitedMembership.id}`, { method: "PATCH", headers: headers(invited.token), body: JSON.stringify({ status: "REVOKED" }) })
  expect(nativeMembershipMutation.response.status).toBe(403)

  const revokedInvite = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(invited.token), body: JSON.stringify({ email: revoked.email, commandKey: "invite-revoked" }) })
  expect(revokedInvite.response.status).toBe(201)
  const revokedResult = await send(`/api/jornal/companies/${companyId}/invitations/${revokedInvite.data.id}/revoke`, { method: "POST", headers: headers(invited.token), body: JSON.stringify({ expectedRevision: revokedInvite.data.revision, commandKey: "revoke-before-claim" }) })
  expect(revokedResult.data.status).toBe("REVOKED")
  const revokedBootstrap = await send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(revoked.token), body: JSON.stringify({ invitationPublicId: revokedInvite.data.publicId }) })
  expect(revokedBootstrap.data.invitationStatus).toBe("REVOKED")
  expect(revokedBootstrap.data.nextAction).toBe("NO_COMPANY")

  smtpMode = "TRANSIENT"
  const retryInvite = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: "smtp-retry@example.com", commandKey: "smtp-retry" }) })
  expect(retryInvite.response.status).toBe(201)
  await send("/api/jornal/admin/team/run-jobs", { method: "POST", headers: { Authorization: adminToken } })
  let deliveryList = await send(`/api/collections/team_invitation_deliveries/records?filter=${encodeURIComponent(`invitation_id = '${retryInvite.data.id}'`)}`, { headers: { Authorization: adminToken } })
  expect(deliveryList.data.items[0].status).toBe("RETRYABLE_FAILED")
  expect(deliveryList.data.items[0].attempt_count).toBe(1)
  await send(`/api/collections/team_invitation_deliveries/records/${deliveryList.data.items[0].id}`, { method: "PATCH", headers: headers(adminToken), body: JSON.stringify({ next_attempt_at: new Date(Date.now() - 1000).toISOString() }) })
  smtpMode = "SUCCESS"
  await send("/api/jornal/admin/team/run-jobs", { method: "POST", headers: { Authorization: adminToken } })
  deliveryList = await send(`/api/collections/team_invitation_deliveries/records?filter=${encodeURIComponent(`invitation_id = '${retryInvite.data.id}'`)}`, { headers: { Authorization: adminToken } })
  expect(deliveryList.data.items[0].status).toBe("SENT")
  expect(deliveryList.data.items[0].attempt_count).toBe(2)

  smtpMode = "PERMANENT"
  const permanentInvite = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: "smtp-permanent@example.com", commandKey: "smtp-permanent" }) })
  expect(permanentInvite.response.status).toBe(201)
  await send("/api/jornal/admin/team/run-jobs", { method: "POST", headers: { Authorization: adminToken } })
  const permanentDeliveries = await send(`/api/collections/team_invitation_deliveries/records?filter=${encodeURIComponent(`invitation_id = '${permanentInvite.data.id}'`)}`, { headers: { Authorization: adminToken } })
  expect(permanentDeliveries.data.items[0].status).toBe("PERMANENTLY_FAILED")
  expect(permanentDeliveries.data.items[0].attempt_count).toBe(1)
  smtpMode = "SUCCESS"

  const onboardingUser = await createUser("onboarding-race@example.com", "Onboarding Race")
  const onboardingInvite = await send(`/api/jornal/companies/${companyId}/invitations`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ email: onboardingUser.email, commandKey: "invite-onboarding-race" }) })
  expect(onboardingInvite.response.status).toBe(201)
  const interceptedSetup = await setupCompany(onboardingUser, "Should Not Exist", "racing-setup")
  expect(interceptedSetup.response.status).toBe(200)
  expect(interceptedSetup.data.id).toBe(companyId)
  const ownedByOnboardingUser = await send(`/api/collections/companies/records?filter=${encodeURIComponent(`tenant_id = '${onboardingUser.id}'`)}`, { headers: { Authorization: adminToken } })
  expect(ownedByOnboardingUser.data.totalItems).toBe(0)

  const archivedByMember = await send(`/api/jornal/companies/${companyId}`, { method: "PATCH", headers: headers(invited.token), body: JSON.stringify({ status: "ARCHIVED", revision: renamed.data.revision, requestId: "shared-archive" }) })
  expect(archivedByMember.response.status).toBe(200)
  expect(archivedByMember.data.status).toBe("ARCHIVED")
  const restoredByMember = await send(`/api/jornal/companies/${companyId}`, { method: "PATCH", headers: headers(invited.token), body: JSON.stringify({ status: "ACTIVE", revision: archivedByMember.data.revision, requestId: "shared-restore" }) })
  expect(restoredByMember.response.status).toBe(200)
  expect(restoredByMember.data.status).toBe("ACTIVE")

  const remove = await send(`/api/jornal/companies/${companyId}/members/${invited.id}/remove`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ expectedRevision: invitedMembership.revision, commandKey: "remove-invited" }) })
  expect(remove.data.status).toBe("REVOKED")
  const revokedAccess = await send("/api/collections/jornal_records/records?perPage=100", { headers: { Authorization: invited.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": companyId } })
  expect(revokedAccess.response.status).toBe(404)
  const oldLink = await send("/api/jornal/session/bootstrap", { method: "POST", headers: headers(invited.token), body: JSON.stringify({ invitationPublicId: invitation.data.publicId }) })
  expect(oldLink.data.acceptedCompanyIds).toEqual([])
  expect(oldLink.data.targetCompanyId).toBeNull()

  const ownerTeam = await send(`/api/jornal/companies/${companyId}/team`, { headers: { Authorization: owner.token } })
  const ownerMembership = ownerTeam.data.members.find((member: Record<string, unknown>) => member.userId === owner.id)
  const removeOnboarding = await send(`/api/jornal/companies/${companyId}/members/${onboardingUser.id}/remove`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ expectedRevision: 1, commandKey: "remove-onboarding" }) })
  expect(removeOnboarding.response.status).toBe(200)
  const lastMember = await send(`/api/jornal/companies/${companyId}/leave`, { method: "POST", headers: headers(owner.token), body: JSON.stringify({ expectedRevision: ownerMembership.revision, commandKey: "last-member-leave" }) })
  expect(lastMember.response.status).toBe(409)
  expect(lastMember.data.data.code.code).toBe("LAST_MEMBER")

  const expiredAt = new Date(Date.now() - 60_000).toISOString()
  for (let index = 0; index < 501; index += 1) {
    const seeded = await send("/api/collections/company_invitations/records", {
      method: "POST", headers: headers(adminToken), body: JSON.stringify({
        company_id: companyId, email_normalized: `expired-${index}@example.com`, public_id: `expired-public-${String(index).padStart(4, "0")}`,
        status: "PENDING", invited_by: owner.id, expires_at: expiredAt, send_generation: 1,
        last_requested_at: expiredAt, revision: 1,
      }),
    })
    if (seeded.response.status !== 200) throw new Error(`scale invitation ${index} failed: ${JSON.stringify(seeded.data)}`)
  }
  const expireScale = await send("/api/jornal/admin/team/run-jobs", { method: "POST", headers: { Authorization: adminToken } })
  expect(expireScale.data.expired).toBe(501)
  let invitationCursor = ""
  const invitationIds = new Set<string>()
  do {
    const page = await send(`/api/jornal/companies/${companyId}/team?limit=100${invitationCursor ? `&invitationCursor=${encodeURIComponent(invitationCursor)}` : ""}`, { headers: { Authorization: owner.token } })
    for (const item of page.data.invitations) invitationIds.add(String(item.id))
    invitationCursor = String(page.data.invitationCursor || "")
  } while (invitationCursor)
  expect(invitationIds.size).toBeGreaterThan(500)

  const lastRaceOwner = await createUser("last-race-owner@example.com", "Last Race Owner")
  const lastRaceMember = await createUser("last-race-member@example.com", "Last Race Member")
  const lastRaceSetup = await setupCompany(lastRaceOwner, "Last Member Race", "last-member-race")
  const lastRaceCompanyId = String(lastRaceSetup.data.id)
  const seededMembership = await send("/api/collections/company_memberships/records", { method: "POST", headers: headers(adminToken), body: JSON.stringify({ company_id: lastRaceCompanyId, user_id: lastRaceMember.id, status: "ACTIVE", joined_at: new Date().toISOString(), revision: 1 }) })
  expect(seededMembership.response.status).toBe(200)
  const lastRace = await Promise.all([
    send(`/api/jornal/companies/${lastRaceCompanyId}/leave`, { method: "POST", headers: headers(lastRaceOwner.token), body: JSON.stringify({ expectedRevision: 1, commandKey: "race-owner-leave" }) }),
    send(`/api/jornal/companies/${lastRaceCompanyId}/leave`, { method: "POST", headers: headers(lastRaceMember.token), body: JSON.stringify({ expectedRevision: 1, commandKey: "race-member-leave" }) }),
  ])
  expect(lastRace.map((item) => item.response.status).sort()).toEqual([200, 409])
  const activeAfterRace = await send(`/api/collections/company_memberships/records?filter=${encodeURIComponent(`company_id = '${lastRaceCompanyId}' && status = 'ACTIVE'`)}`, { headers: { Authorization: adminToken } })
  expect(activeAfterRace.data.totalItems).toBe(1)

  const health = await send("/api/jornal/admin/team/health", { headers: { Authorization: adminToken } })
  expect(health.response.status).toBe(200)
  expect(health.data.invitationEnabled).toBe(true)
  expect(health.data.emailEnabled).toBe(true)
}, 60_000)

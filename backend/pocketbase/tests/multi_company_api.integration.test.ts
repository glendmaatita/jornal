import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const pocketBaseBin = process.env.POCKETBASE_BIN
const creationFlagDisabled = process.env.JORNAL_MULTI_COMPANY_ENABLED === "false"
const integrationTest = pocketBaseBin ? test : test.skip
let server: ReturnType<typeof Bun.spawn> | null = null
let dataDirectory = ""

afterAll(async () => {
  server?.kill()
  if (server) await server.exited.catch(() => undefined)
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

integrationTest("PocketBase enforces multi-company isolation and lifecycle", async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "jornal-pb-integration-"))
  const migrations = resolve(import.meta.dir, "../pb_migrations")
  const hooks = resolve(import.meta.dir, "../pb_hooks")
  const run = (args: string[]) => {
    const result = Bun.spawnSync([pocketBaseBin!, ...args], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  run(["migrate", "up", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks])
  run(["superuser", "upsert", "admin@example.com", "StrongPass123!", "--dir", dataDirectory])

  const port = 20_000 + Math.floor(Math.random() * 10_000)
  const origin = `http://127.0.0.1:${port}`
  server = Bun.spawn([
    pocketBaseBin!, "serve", "--dir", dataDirectory, "--migrationsDir", migrations,
    "--hooksDir", hooks, `--http=127.0.0.1:${port}`,
  ], { stdout: "ignore", stderr: "pipe" })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) break
    await Bun.sleep(50)
  }

  const send = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}${path}`, init)
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    return { response, data }
  }
  const authHeader = (token: string) => ({ Authorization: token })
  const adminAuth = await send("/api/collections/_superusers/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin@example.com", password: "StrongPass123!" }),
  })
  const adminToken = String(adminAuth.data.token)

  const createUser = async (email: string) => {
    const created = await send("/api/collections/users/records", {
      method: "POST", headers: { ...authHeader(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ email, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" }),
    })
    const auth = await send(`/api/collections/users/impersonate/${created.data.id}`, {
      method: "POST", headers: authHeader(adminToken),
    })
    return { id: String(created.data.id), token: String(auth.data.token) }
  }
  const owner = await createUser("owner@example.com")
  const foreign = await createUser("foreign@example.com")
  const racing = await createUser("racing@example.com")
  const scaleUser = await createUser("scale@example.com")
  const limitedUser = await createUser("limited@example.com")

  const setup = async (user: typeof owner, name: string, key: string, accountId: string, initialSetup: boolean) => {
    const result = await send("/api/jornal/companies/setup", {
      method: "POST", headers: { ...authHeader(user.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name, creationKey: key, requestId: key, initialSetup,
        profile: { businessName: name, businessType: "INDIVIDUAL", taxScheme: "NOT_CALCULATED" },
        accounts: [{ id: accountId, name: "Cash", type: "CASH", openingBalance: 0, includedInCash: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      }),
    })
    expect([200, 201]).toContain(result.response.status)
    return result.data
  }
  const companyA = await setup(owner, "Company A", "create-a", "account-a", true)
  const retryA = await setup(owner, "Company A", "create-a", "account-a", true)
  expect(retryA.id).toBe(companyA.id)
  if (creationFlagDisabled) {
    const blocked = await send("/api/jornal/companies/setup", {
      method: "POST", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Company B", creationKey: "create-b", initialSetup: false,
        profile: { businessName: "Company B", businessType: "INDIVIDUAL", taxScheme: "NOT_CALCULATED" }, accounts: [],
      }),
    })
    expect(blocked.response.status).toBe(403)
    return
  }
  const companyB = await setup(owner, "Company B", "create-b", "account-b", false)
  const mismatchedRetry = await send("/api/jornal/companies/setup", {
    method: "POST", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Different B", creationKey: "create-b", initialSetup: false, profile: {}, accounts: [] }),
  })
  expect(mismatchedRetry.response.status).toBe(409)
  const rawCompanyCreate = await send("/api/collections/companies/records", {
    method: "POST", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: owner.id, name: "Bypass", status: "ACTIVE", creation_key: "bypass", data_epoch: 1, revision: 1 }),
  })
  expect(rawCompanyCreate.response.status).toBe(403)
  const rawCompanyUpdate = await send(`/api/collections/companies/records/${companyA.id}`, {
    method: "PATCH", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ARCHIVED" }),
  })
  expect(rawCompanyUpdate.response.status).toBe(403)
  await setup(foreign, "Foreign", "create-x", "account-x", true)
  const foreignLifecycle = await send(`/api/jornal/companies/${companyA.id}`, {
    method: "PATCH", headers: { ...authHeader(foreign.token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Stolen", revision: 1 }),
  })
  expect(foreignLifecycle.response.status).toBe(404)
  const racingResults = await Promise.all([
    setup(racing, "Race One", "race-one", "race-account-one", true),
    setup(racing, "Race Two", "race-two", "race-account-two", true),
  ])
  expect(racingResults[0].id).toBe(racingResults[1].id)
  const racingCatalog = await send("/api/collections/companies/records?perPage=100", { headers: authHeader(racing.token) })
  expect(racingCatalog.data.totalItems).toBe(1)

  // There is no business-level company cap. Seed through the superuser so the
  // creation endpoint's independent abuse rate limit does not distort paging.
  const scaleCompanies: Record<string, unknown>[] = []
  for (let index = 0; index < 50; index += 1) {
    const created = await send("/api/collections/companies/records", {
      method: "POST", headers: { ...authHeader(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: scaleUser.id, name: `Scale ${String(index + 1).padStart(2, "0")}`,
        status: "ACTIVE", onboarding_completed_at: new Date().toISOString(),
        creation_key: `scale-${index}`, data_epoch: 1, revision: 1,
      }),
    })
    expect(created.response.status).toBe(200)
    scaleCompanies.push(created.data)
  }
  const scalePage1 = await send("/api/collections/companies/records?sort=created&perPage=20&page=1", { headers: authHeader(scaleUser.token) })
  const scalePage3 = await send("/api/collections/companies/records?sort=created&perPage=20&page=3", { headers: authHeader(scaleUser.token) })
  expect(scalePage1.data.totalItems).toBe(50)
  expect((scalePage1.data.items as unknown[]).length).toBe(20)
  expect((scalePage3.data.items as unknown[]).length).toBe(10)

  for (let index = 0; index < 10; index += 1) {
    await setup(limitedUser, `Limited ${index + 1}`, `limited-${index}`, `limited-account-${index}`, index === 0)
  }
  const rateLimited = await send("/api/jornal/companies/setup", {
    method: "POST", headers: { ...authHeader(limitedUser.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Limited 11", creationKey: "limited-10", initialSetup: false,
      profile: { businessName: "Limited 11", businessType: "INDIVIDUAL", taxScheme: "NOT_CALCULATED" },
      accounts: [{ id: "limited-account-10", name: "Cash", type: "CASH", openingBalance: 0, includedInCash: true }],
    }),
  })
  expect(rateLimited.response.status).toBe(429)

  const listRecords = (token: string, companyId?: unknown) => send("/api/collections/jornal_records/records?perPage=100", {
    headers: companyId ? { ...authHeader(token), "X-Jornal-Protocol": "2", "X-Jornal-Company": String(companyId) } : authHeader(token),
  })
  expect((await listRecords(owner.token)).data.totalItems).toBe(0)
  expect((await listRecords(owner.token, companyA.id)).data.totalItems).toBe(3)
  expect((await listRecords(owner.token, companyB.id)).data.totalItems).toBe(3)
  expect((await listRecords(foreign.token, companyA.id)).data.totalItems).toBe(0)

  const batchBypass = await send("/api/batch", {
    method: "POST", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{
      method: "POST", url: "/api/collections/jornal_records/records",
      headers: { "X-Jornal-Protocol": "2", "X-Jornal-Company": String(companyA.id) },
      body: { business_id: owner.id, company_id: companyB.id, data_epoch: 1, entity: "transactions", app_id: "batch-cross", revision: 1, payload: { id: "batch-cross", classification: "REVENUE", accountId: "account-b", updatedAt: new Date().toISOString() } },
    }] }),
  })
  expect(batchBypass.response.status).toBe(403)

  const recordHeaders = (token: string, companyId: unknown) => ({
    ...authHeader(token), "X-Jornal-Protocol": "2", "X-Jornal-Company": String(companyId), "Content-Type": "application/json",
  })

  const scaleCompanyId = String(scaleCompanies[0].id)
  const scaleAccount = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(scaleUser.token, scaleCompanyId),
    body: JSON.stringify({ business_id: scaleUser.id, company_id: scaleCompanyId, data_epoch: 1, entity: "accounts", app_id: "scale-account", revision: 1, payload: { id: "scale-account", name: "Scale Cash", type: "CASH", openingBalance: 0, includedInCash: true, updatedAt: new Date().toISOString() } }),
  })
  expect(scaleAccount.response.status).toBe(200)
  for (let index = 0; index < 120; index += 1) {
    const largeRecord = await send("/api/collections/jornal_records/records", {
      method: "POST", headers: recordHeaders(scaleUser.token, scaleCompanyId),
      body: JSON.stringify({ business_id: scaleUser.id, company_id: scaleCompanyId, data_epoch: 1, entity: "transactions", app_id: `scale-txn-${index}`, revision: 1, payload: { id: `scale-txn-${index}`, classification: "REVENUE", accountId: "scale-account", amount: index + 1, updatedAt: new Date().toISOString() } }),
    })
    expect(largeRecord.response.status).toBe(200)
  }
  const scaleRecordsPage3 = await send(`/api/collections/jornal_records/records?perPage=50&page=3&sort=created`, {
    headers: { ...authHeader(scaleUser.token), "X-Jornal-Protocol": "2", "X-Jornal-Company": scaleCompanyId },
  })
  expect(scaleRecordsPage3.data.totalItems).toBe(121)
  expect((scaleRecordsPage3.data.items as unknown[]).length).toBe(21)
  const crossReference = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ business_id: owner.id, company_id: companyA.id, data_epoch: 1, entity: "transactions", app_id: "cross", revision: 1, payload: { id: "cross", classification: "REVENUE", accountId: "account-b", updatedAt: new Date().toISOString() } }),
  })
  expect(crossReference.response.status).toBe(400)
  const payloadScopeMismatch = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ business_id: owner.id, company_id: companyA.id, data_epoch: 1, entity: "transactions", app_id: "payload-cross", revision: 1, payload: { id: "payload-cross", businessId: owner.id, companyId: companyB.id, classification: "REVENUE", accountId: "account-a", updatedAt: new Date().toISOString() } }),
  })
  expect(payloadScopeMismatch.response.status).toBe(400)
  const referencedTransaction = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ business_id: owner.id, company_id: companyA.id, data_epoch: 1, entity: "transactions", app_id: "references-account", revision: 1, payload: { id: "references-account", businessId: owner.id, companyId: companyA.id, classification: "REVENUE", accountId: "account-a", updatedAt: new Date().toISOString() } }),
  })
  expect(referencedTransaction.response.status).toBe(200)
  const companyARecords = await listRecords(owner.token, companyA.id)
  const accountRecord = (companyARecords.data.items as Array<Record<string, unknown>>).find((item) => item.entity === "accounts" && item.app_id === "account-a")
  const referencedDelete = await send(`/api/collections/jornal_records/records/${accountRecord?.id}`, {
    method: "DELETE", headers: recordHeaders(owner.token, companyA.id),
  })
  expect(referencedDelete.response.status).toBe(409)

  const attachment = new FormData()
  for (const [key, value] of Object.entries({ business_id: owner.id, company_id: String(companyA.id), data_epoch: "1", entity: "transactions", app_id: "attachment", revision: "1", payload: JSON.stringify({ id: "attachment", classification: "REVENUE", accountId: "account-a", updatedAt: new Date().toISOString() }) })) attachment.append(key, value)
  attachment.append("attachment", new File(["proof"], "proof.txt", { type: "text/plain" }))
  const fileRecord = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: { ...authHeader(owner.token), "X-Jornal-Protocol": "2", "X-Jornal-Company": String(companyA.id) }, body: attachment,
  })
  expect(fileRecord.response.status).toBe(200)
  const oldView = await send(`/api/collections/jornal_records/records/${fileRecord.data.id}`, { headers: authHeader(owner.token) })
  expect(oldView.response.status).toBe(426)
  const staleRevision = await send(`/api/collections/jornal_records/records/${fileRecord.data.id}`, {
    method: "PATCH", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ revision: 9, payload: { id: "attachment", classification: "REVENUE", accountId: "account-a", updatedAt: new Date().toISOString() } }),
  })
  expect(staleRevision.response.status).toBe(409)
  const ownerFileToken = await send("/api/files/token", { method: "POST", headers: authHeader(owner.token) })
  const foreignFileToken = await send("/api/files/token", { method: "POST", headers: authHeader(foreign.token) })
  const filePath = `/api/files/jornal_records/${fileRecord.data.id}/${fileRecord.data.attachment}`
  expect((await fetch(`${origin}${filePath}?protocol=2&company=${companyA.id}&token=${ownerFileToken.data.token}`)).status).toBe(200)
  expect((await fetch(`${origin}${filePath}?protocol=2&company=${companyA.id}&token=${foreignFileToken.data.token}`)).status).toBe(404)
  expect((await fetch(`${origin}${filePath}?token=${ownerFileToken.data.token}`)).status).toBe(426)

  const archive = await send(`/api/jornal/companies/${companyA.id}`, {
    method: "PATCH", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ARCHIVED", revision: 1, requestId: "archive-a" }),
  })
  expect(archive.response.status).toBe(200)
  const lateWrite = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ business_id: owner.id, company_id: companyA.id, data_epoch: 1, entity: "transactions", app_id: "late", revision: 1, payload: { id: "late", classification: "REVENUE", accountId: "account-a", updatedAt: new Date().toISOString() } }),
  })
  expect(lateWrite.response.status).toBe(409)
  const restore = await send(`/api/jornal/companies/${companyA.id}`, {
    method: "PATCH", headers: { ...authHeader(owner.token), "Content-Type": "application/json" },
    body: JSON.stringify({ status: "ACTIVE", revision: 2, requestId: "restore-a" }),
  })
  expect(restore.response.status).toBe(200)
  const reset = await send(`/api/jornal/companies/${companyA.id}/reset`, { method: "POST", headers: authHeader(owner.token) })
  expect(reset.data.dataEpoch).toBe(2)
  expect((await listRecords(owner.token, companyB.id)).data.totalItems).toBe(3)
  const staleEpoch = await send("/api/collections/jornal_records/records", {
    method: "POST", headers: recordHeaders(owner.token, companyA.id),
    body: JSON.stringify({ business_id: owner.id, company_id: companyA.id, data_epoch: 1, entity: "transactions", app_id: "stale", revision: 1, payload: { id: "stale", classification: "REVENUE", accountId: null, updatedAt: new Date().toISOString() } }),
  })
  expect(staleEpoch.response.status).toBe(409)
}, 30_000)

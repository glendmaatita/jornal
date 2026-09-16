import { expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"

const pocketBaseBin = process.env.POCKETBASE_BIN
const integrationTest = pocketBaseBin ? test : test.skip

integrationTest("migrates a populated single-company database without changing ledger payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "jornal-pb-populated-"))
  const data = join(root, "data")
  const legacyMigrations = join(root, "legacy-migrations")
  const legacyHooks = join(root, "legacy-hooks")
  const allMigrations = resolve(import.meta.dir, "../pb_migrations")
  const hooks = resolve(import.meta.dir, "../pb_hooks")
  await mkdir(legacyMigrations)
  await mkdir(legacyHooks)
  const legacyFiles = [
    "20260903_0001_jornal_records.js", "20260903_0002_multi_tenant.js",
    "20260914_0003_configure_google_oauth.js", "20260914_0004_sync_metadata.js",
    "20260915_0005_revision_tombstones.js",
  ]
  for (const file of legacyFiles) await copyFile(join(allMigrations, file), join(legacyMigrations, basename(file)))
  const run = (args: string[]) => {
    const result = Bun.spawnSync([pocketBaseBin!, ...args], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  let server: ReturnType<typeof Bun.spawn> | null = null
  const port = 30_000 + Math.floor(Math.random() * 2_000)
  const origin = `http://127.0.0.1:${port}`
  const start = async (migrations: string, hookDirectory = hooks) => {
    server = Bun.spawn([pocketBaseBin!, "serve", "--dir", data, "--migrationsDir", migrations, "--hooksDir", hookDirectory, `--http=127.0.0.1:${port}`], { stdout: "ignore", stderr: "pipe" })
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) return
      await Bun.sleep(50)
    }
    throw new Error("PocketBase did not start")
  }
  const stop = async () => { server?.kill(); if (server) await server.exited; server = null }
  const json = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}${path}`, init)
    return { response, data: await response.json() as Record<string, unknown> }
  }
  try {
    run(["migrate", "up", "--dir", data, "--migrationsDir", legacyMigrations, "--hooksDir", hooks])
    run(["superuser", "upsert", "admin@example.com", "StrongPass123!", "--dir", data])
    await start(legacyMigrations, legacyHooks)
    const admin = await json("/api/collections/_superusers/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: "admin@example.com", password: "StrongPass123!" }) })
    const adminToken = String(admin.data.token)
    const user = await json("/api/collections/users/records", {
      method: "POST", headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "legacy@example.com", verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" }),
    })
    const userId = String(user.data.id)
    const createLegacy = async (entity: string, appId: string, payload: unknown) => json("/api/collections/jornal_records/records", {
      method: "POST", headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: userId, entity, app_id: appId, payload, revision: 1 }),
    })
    const profile = await createLegacy("profile", "profile", { businessName: "Legacy Shop", onboardingCompletedAt: "2026-01-01T00:00:00.000Z" })
    const transaction = await createLegacy("transactions", "tx-legacy", { id: "tx-legacy", amount: 987654, classification: "REVENUE", updatedAt: "2026-01-02T00:00:00.000Z" })
    const history = await createLegacy("transactionHistory", "tx-legacy:2026-01-02T00:00:00.000Z:live", { id: "tx-legacy", effectiveAt: "2026-01-02T00:00:00.000Z", deletedAt: null, value: { id: "tx-legacy", amount: 987654 } })
    expect(profile.response.status).toBe(200)
    await stop()

    run(["migrate", "up", "--dir", data, "--migrationsDir", allMigrations, "--hooksDir", hooks])
    await start(allMigrations)
    const adminAgain = await json("/api/collections/_superusers/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: "admin@example.com", password: "StrongPass123!" }) })
    const impersonated = await json(`/api/collections/users/impersonate/${userId}`, { method: "POST", headers: { Authorization: String(adminAgain.data.token) } })
    const userToken = String(impersonated.data.token)
    const catalog = await json("/api/collections/companies/records?perPage=10", { headers: { Authorization: userToken } })
    const companies = catalog.data.items as Array<Record<string, unknown>>
    expect(companies).toHaveLength(1)
    expect(companies[0]?.name).toBe("Legacy Shop")
    expect(companies[0]?.legacy_default).toBe(true)
    const companyId = String(companies[0]?.id)
    const records = await json("/api/collections/jornal_records/records?perPage=100", { headers: { Authorization: userToken, "X-Jornal-Protocol": "2", "X-Jornal-Company": companyId } })
    const items = records.data.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(3)
    expect(new Set(items.map((item) => item.company_id))).toEqual(new Set([companyId]))
    expect(items.find((item) => item.id === transaction.data.id)?.payload).toEqual(transaction.data.payload)
    expect(items.find((item) => item.id === history.data.id)?.payload).toEqual(history.data.payload)
    expect(items.every((item) => item.data_epoch === 1)).toBe(true)
  } finally {
    await stop().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

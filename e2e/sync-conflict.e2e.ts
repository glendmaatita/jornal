import { expect, test } from "@playwright/test"

const backend = "http://127.0.0.1:8090"

test("resolves sequential account conflicts from both buttons without exposing internal ids", async ({ page, request }) => {
  const adminAuth = await request.post(`${backend}/api/collections/_superusers/auth-with-password`, {
    data: { identity: "e2e-admin@jornal.test", password: "StrongPass123!" },
  })
  expect(adminAuth.ok()).toBeTruthy()
  const admin = await adminAuth.json() as { token: string }
  const email = `sync-conflict-${Date.now()}@example.com`
  const created = await request.post(`${backend}/api/collections/users/records`, {
    headers: { Authorization: admin.token },
    data: { email, name: "Sync Conflict", verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" },
  })
  expect(created.ok()).toBeTruthy()
  const user = await created.json() as { id: string; email: string; name: string; collectionId: string; collectionName: string }
  const impersonated = await request.post(`${backend}/api/collections/users/impersonate/${user.id}`, { headers: { Authorization: admin.token } })
  const auth = await impersonated.json() as { token: string }
  const accountId = crypto.randomUUID()
  const secondAccountId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const setup = await request.post(`${backend}/api/jornal/companies/setup`, {
    headers: { Authorization: auth.token },
    data: {
      name: "Company Sync E2E",
      creationKey: `sync-e2e-${Date.now()}`,
      requestId: "sync-e2e",
      initialSetup: true,
      profile: {
        businessName: "Company Sync E2E", businessType: "INDIVIDUAL", businessStartDate: "2026-01-01",
        fiscalYear: 2026, taxScheme: "NOT_CALCULATED", pkpStatus: false, useAccountTracking: true,
        openingBalance: 0, taxReserveConfirmed: 0, lastBalanceCheckIn: null, lastCheckedBalance: null,
        lastCheckInDelta: null, onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      },
      accounts: [
        { id: accountId, name: "BCA", type: "BANK", openingBalance: 0, includedInCash: true, createdAt, updatedAt: createdAt },
        { id: secondAccountId, name: "Mandiri", type: "BANK", openingBalance: 5_000_000, includedInCash: true, createdAt, updatedAt: createdAt },
      ],
    },
  })
  expect(setup.ok()).toBeTruthy()
  const company = await setup.json() as { id: string; tenantId?: string; dataEpoch?: number; membershipRevision?: number }
  const prefix = `jornal.v3.${user.id}.${user.id}.${company.id}.${company.dataEpoch ?? 1}.${company.membershipRevision ?? 1}.`
  const records = await request.get(`${backend}/api/collections/jornal_records/records?filter=${encodeURIComponent(`company_id = '${company.id}' && entity = 'accounts' && app_id = '${accountId}'`)}`, {
    headers: { Authorization: auth.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": company.id },
  })
  expect(records.ok()).toBeTruthy()
  const remoteRecord = (await records.json() as { items: Array<{ revision: number; payload: Record<string, unknown> }> }).items[0]
  const secondRecords = await request.get(`${backend}/api/collections/jornal_records/records?filter=${encodeURIComponent(`company_id = '${company.id}' && entity = 'accounts' && app_id = '${secondAccountId}'`)}`, {
    headers: { Authorization: auth.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": company.id },
  })
  expect(secondRecords.ok()).toBeTruthy()
  const secondRemoteRecord = (await secondRecords.json() as { items: Array<{ revision: number; payload: Record<string, unknown> }> }).items[0]
  const remoteAccount = remoteRecord.payload
  const secondRemoteAccount = secondRemoteRecord.payload
  const localAccount = { ...remoteAccount, openingBalance: 12_345_678, updatedAt: new Date(Date.now() + 1_000).toISOString() }
  const secondLocalAccount = { ...secondRemoteAccount, openingBalance: 9_000_000, updatedAt: new Date(Date.now() + 1_000).toISOString() }
  const conflict = (id: string, targetId = accountId, local = localAccount, remote = remoteAccount, revision = remoteRecord.revision) => ({
    id,
    message: "Conflict",
    entity: "accounts",
    appId: targetId,
    localPayload: [local],
    remotePayload: remote,
    remoteRevision: revision,
    occurredAt: new Date().toISOString(),
  })

  await page.addInitScript(({ token, record, storagePrefix, local, initialConflict }) => {
    localStorage.setItem("pocketbase_auth", JSON.stringify({ token, record }))
    if (localStorage.getItem(`${storagePrefix}jornal.accounts.v1`) === null) {
      localStorage.setItem(`${storagePrefix}jornal.accounts.v1`, JSON.stringify([local]))
    }
    if (localStorage.getItem(`${storagePrefix}jornal.sync-conflicts.v1`) === null) {
      localStorage.setItem(`${storagePrefix}jornal.sync-conflicts.v1`, JSON.stringify([initialConflict]))
    }
  }, { token: auth.token, record: user, storagePrefix: prefix, local: localAccount, initialConflict: conflict("remote-choice") })

  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`/sync?company=${company.id}`)
  const banner = page.locator("aside[aria-live='polite']")
  await expect(banner.getByText("akun keuangan “BCA”", { exact: false })).toBeVisible()
  await expect(page.getByText(accountId)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await banner.getByRole("button", { name: "Pakai server" }).click()
  await expect.poll(() => page.evaluate((storagePrefix) => localStorage.getItem(`${storagePrefix}jornal.sync-conflicts.v1`), prefix)).toBe("[]")
  await expect(banner).toHaveCount(0)

  const afterRemote = await request.get(`${backend}/api/collections/jornal_records/records?filter=${encodeURIComponent(`company_id = '${company.id}' && entity = 'accounts' && app_id = '${accountId}'`)}&check=remote`, { headers: { Authorization: auth.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": company.id, "Cache-Control": "no-cache" } })
  expect(Number(((await afterRemote.json() as { items: Array<{ payload: { openingBalance: number } }> }).items[0].payload.openingBalance))).toBe(0)

  const nextConflicts = [
    conflict("local-choice"),
    conflict("second-server-choice", secondAccountId, secondLocalAccount, secondRemoteAccount, secondRemoteRecord.revision),
  ]
  // Seed on the next document before the app initializes. Vite can trigger a
  // dependency-optimization reload in CI, so mutating the current execution
  // context here is inherently racy.
  await page.addInitScript(({ storagePrefix, locals, conflicts }) => {
    const marker = `${storagePrefix}e2e-second-conflict-seeded`
    if (sessionStorage.getItem(marker) === "1") return
    sessionStorage.setItem(marker, "1")
    localStorage.setItem(`${storagePrefix}jornal.accounts.v1`, JSON.stringify(locals))
    localStorage.setItem(`${storagePrefix}jornal.sync-conflicts.v1`, JSON.stringify(conflicts))
  }, { storagePrefix: prefix, locals: [localAccount, secondLocalAccount], conflicts: nextConflicts })
  await page.reload()
  await expect(banner.getByRole("button", { name: "Pakai perangkat" })).toBeVisible()
  await banner.getByRole("button", { name: "Pakai perangkat" }).click()
  await expect.poll(() => page.evaluate((storagePrefix) => {
    return JSON.parse(localStorage.getItem(`${storagePrefix}jornal.sync-conflicts.v1`) || "[]").length
  }, prefix)).toBe(1)
  await expect(banner.getByText("akun keuangan “Mandiri”", { exact: false })).toBeVisible()
  await banner.getByRole("button", { name: "Pakai server" }).click()
  await expect.poll(() => page.evaluate((storagePrefix) => localStorage.getItem(`${storagePrefix}jornal.sync-conflicts.v1`), prefix)).toBe("[]")
  await expect(banner).toHaveCount(0)
  expect(await page.evaluate((storagePrefix) => {
    const accounts = JSON.parse(localStorage.getItem(`${storagePrefix}jornal.accounts.v1`) || "[]") as Array<{ openingBalance: number }>
    return accounts[0]?.openingBalance
  }, prefix)).toBe(12_345_678)

  const afterLocal = await request.get(`${backend}/api/collections/jornal_records/records?filter=${encodeURIComponent(`company_id = '${company.id}' && entity = 'accounts' && app_id = '${accountId}'`)}&check=local`, { headers: { Authorization: auth.token, "X-Jornal-Protocol": "3", "X-Jornal-Company": company.id, "Cache-Control": "no-cache" } })
  expect(Number(((await afterLocal.json() as { items: Array<{ payload: { openingBalance: number } }> }).items[0].payload.openingBalance))).toBe(12_345_678)

  // A protected-route click must reuse the successful session bootstrap.
  // A transient bootstrap outage used to redirect an already-loaded user to
  // the generic "Data belum bisa dimuat" screen when tapping the add button.
  await page.route("**/api/jornal/session/bootstrap", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "temporary outage" }) }))
  await page.getByRole("button", { name: "Buat baru" }).click()
  await page.getByRole("dialog", { name: "Buat baru" }).getByRole("link", { name: /Aliran uang/ }).click()
  await expect(page.getByText("Transaksi baru", { exact: false })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Data belum bisa dimuat" })).toHaveCount(0)
})

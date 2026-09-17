import { expect, test } from "@playwright/test"

const backend = "http://127.0.0.1:8090"

test("invites a Google identity and opens the same company without onboarding", async ({ page, request }) => {
  const adminAuth = await request.post(`${backend}/api/collections/_superusers/auth-with-password`, { data: { identity: "e2e-admin@jornal.test", password: "StrongPass123!" } })
  expect(adminAuth.ok()).toBeTruthy()
  const admin = await adminAuth.json() as { token: string }
  const createUser = async (prefix: string) => {
    const email = `${prefix}-${Date.now()}@example.com`
    const response = await request.post(`${backend}/api/collections/users/records`, { headers: { Authorization: admin.token }, data: { email, name: prefix, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" } })
    expect(response.ok()).toBeTruthy()
    const user = await response.json() as { id: string; email: string; name: string; collectionId: string; collectionName: string }
    const identity = await request.post(`${backend}/api/collections/user_google_identities/records`, { headers: { Authorization: admin.token }, data: { user_id: user.id, provider_subject: `google-${user.id}`, email_normalized: email, email_verified: true, verified_at: new Date().toISOString() } })
    expect(identity.ok()).toBeTruthy()
    const impersonated = await request.post(`${backend}/api/collections/users/impersonate/${user.id}`, { headers: { Authorization: admin.token } })
    const auth = await impersonated.json() as { token: string }
    return { user, token: auth.token }
  }
  const owner = await createUser("owner-team")
  const member = await createUser("member-team")
  const setup = await request.post(`${backend}/api/jornal/companies/setup`, { headers: { Authorization: owner.token }, data: {
    name: "Company Team E2E", creationKey: `team-e2e-${Date.now()}`, requestId: "team-e2e", initialSetup: true,
    profile: {
      businessName: "Company Team E2E", businessType: "INDIVIDUAL", businessStartDate: "2026-01-01",
      fiscalYear: 2026, taxScheme: "NOT_CALCULATED", pkpStatus: false, useAccountTracking: true,
      openingBalance: 125000, taxReserveConfirmed: 0, lastBalanceCheckIn: null, lastCheckedBalance: null,
      lastCheckInDelta: null, onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    },
    accounts: [{ id: "team-cash", name: "Cash", type: "CASH", openingBalance: 125000, includedInCash: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  } })
  expect(setup.ok()).toBeTruthy()
  const company = await setup.json() as { id: string }

  await page.addInitScript(({ token, record }) => localStorage.setItem("pocketbase_auth", JSON.stringify({ token, record })), { token: owner.token, record: owner.user })
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto(`/companies/${company.id}/team?company=${company.id}`)
  await expect(page.getByRole("heading", { name: "Tim Company Team E2E" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel("Email akun Google").fill(member.user.email)
  await page.getByRole("button", { name: "Kirim undangan" }).click()
  await expect(page.getByText("Undangan dibuat. Email akan segera dikirim.")).toBeVisible()
  await expect(page.getByText(member.user.email, { exact: true })).toBeVisible()

  const bootstrap = await request.post(`${backend}/api/jornal/session/bootstrap`, { headers: { Authorization: member.token }, data: {} })
  expect(bootstrap.ok()).toBeTruthy()
  const result = await bootstrap.json() as { acceptedCompanyIds: string[]; nextAction: string }
  expect(result.acceptedCompanyIds).toContain(company.id)
  expect(result.nextAction).toBe("COMPANY")
  const owned = await request.get(`${backend}/api/collections/companies/records?filter=${encodeURIComponent(`tenant_id = '${member.user.id}'`)}`, { headers: { Authorization: admin.token } })
  expect((await owned.json() as { totalItems: number }).totalItems).toBe(0)

  await page.evaluate(({ token, record }) => localStorage.setItem("pocketbase_auth", JSON.stringify({ token, record })), { token: member.token, record: member.user })
  await page.goto(`/companies/${company.id}/team?company=${company.id}`)
  await expect(page.getByRole("heading", { name: "Tim Company Team E2E" })).toBeVisible()
  await expect(page.getByText(member.user.email, { exact: true })).toBeVisible()
  await page.goto(`/?company=${company.id}`)
  await expect(page.getByText("Dana aman dipakai", { exact: false })).toBeVisible()
  await expect(page).not.toHaveURL(/onboarding/)
})

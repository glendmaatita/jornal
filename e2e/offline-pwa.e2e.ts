import { expect, test } from "@playwright/test"

const backend = "http://127.0.0.1:8090"

test("queues customer and invoice commands offline and syncs them on reconnect", async ({ page, request, context }) => {
  await page.setViewportSize({ width: 360, height: 800 })
  const adminAuth = await request.post(`${backend}/api/collections/_superusers/auth-with-password`, { data: { identity: "e2e-admin@jornal.test", password: "StrongPass123!" } })
  const admin = await adminAuth.json() as { token: string }
  const email = `offline-e2e-${Date.now()}@example.com`
  const createdUser = await request.post(`${backend}/api/collections/users/records`, { headers: { Authorization: admin.token }, data: { email, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" } })
  const user = await createdUser.json() as { id: string; email: string; verified: boolean; collectionId: string; collectionName: string }
  const impersonated = await request.post(`${backend}/api/collections/users/impersonate/${user.id}`, { headers: { Authorization: admin.token } })
  const auth = await impersonated.json() as { token: string }
  const setup = await request.post(`${backend}/api/jornal/companies/setup`, { headers: { Authorization: auth.token }, data: {
    name: "Offline Browser", creationKey: `offline-${Date.now()}`, requestId: crypto.randomUUID(), initialSetup: true,
    profile: { businessName: "Offline Browser", businessType: "INDIVIDUAL", businessStartDate: "2026-01-01", fiscalYear: 2026, taxScheme: "UMKM_FINAL", pkpStatus: false, useAccountTracking: false, openingBalance: 0, taxReserveConfirmed: 0, lastBalanceCheckIn: null, lastCheckedBalance: null, lastCheckInDelta: null, onboardingCompletedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    accounts: [],
  } })
  expect(setup.ok()).toBeTruthy()
  const company = await setup.json() as { id: string; dataEpoch?: number; data_epoch?: number }
  const scope = `companyId=${company.id}&dataEpoch=${company.dataEpoch || company.data_epoch || 1}`
  const headers = { Authorization: auth.token, "X-Jornal-Protocol": "3" }

  await page.addInitScript(({ token, record }) => localStorage.setItem("pocketbase_auth", JSON.stringify({ token, record })), { token: auth.token, record: user })
  await page.goto(`/customers/new?company=${company.id}`)
  await expect(page.getByLabel("Nama")).toBeVisible()
  await page.getByLabel("Nama").fill("Offline Customer")
  await page.waitForTimeout(350)
  const customerDraftKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("jornal.customer-compose.")) || "")
  expect(customerDraftKey).toContain(user.id)
  expect(customerDraftKey).toContain(company.id)
  await page.evaluate((key) => localStorage.removeItem(key), customerDraftKey)
  await page.reload()
  await expect(page.getByLabel("Nama")).toHaveValue("Offline Customer")
  await context.setOffline(true)
  await page.getByRole("button", { name: "Simpan pelanggan" }).click()
  await expect(page.getByRole("status")).toContainText("disimpan di perangkat")

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  let customerId = ""
  await expect.poll(async () => {
    const response = await request.get(`${backend}/api/jornal/invoicing/customers?${scope}`, { headers })
    const body = await response.json() as { items?: Array<{ id: string }> }
    customerId = body.items?.[0]?.id || ""
    return customerId
  }, { timeout: 15_000 }).not.toBe("")

  await page.goto(`/invoices/new?company=${company.id}&customer=${customerId}`)
  await expect(page.getByRole("combobox", { name: "Ketik nama produk" })).toBeVisible()
  await page.getByRole("combobox", { name: "Ketik nama produk" }).fill("Produk Offline")
  await page.getByLabel("Harga/unit").fill("125000")
  await page.waitForTimeout(350)
  const invoiceDraftKey = await page.evaluate(() => Object.keys(localStorage).find((key) => key.startsWith("jornal.invoice-compose.")) || "")
  expect(invoiceDraftKey).toContain(user.id)
  expect(invoiceDraftKey).toContain(company.id)
  await page.evaluate((key) => { localStorage.removeItem(key); sessionStorage.removeItem(key) }, invoiceDraftKey)
  await page.reload()
  await expect(page.getByRole("combobox", { name: "Ketik nama produk" })).toHaveValue("Produk Offline")
  await expect(page.getByLabel("Harga/unit")).toHaveValue("125.000")
  await context.setOffline(true)
  await page.getByRole("button", { name: "Terbitkan" }).click()
  await expect(page.getByRole("status")).toContainText("akan diterbitkan otomatis")

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  let invoiceNumber = ""
  await expect.poll(async () => {
    const response = await request.get(`${backend}/api/jornal/invoicing/invoices?${scope}&status=UNPAID`, { headers })
    const body = await response.json() as { items?: Array<{ invoiceNumber: string | null }> }
    invoiceNumber = body.items?.[0]?.invoiceNumber || ""
    return invoiceNumber
  }, { timeout: 15_000 }).not.toBe("")

  await page.goto(`/invoices?company=${company.id}`)
  const card = page.getByText(invoiceNumber, { exact: false }).locator("xpath=ancestor::a[1]")
  await expect(card.getByText(/· Offline/)).toBeVisible()
  await expect(card.getByTitle("Jatuh tempo")).toBeVisible()
})

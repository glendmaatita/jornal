import { expect, test } from "@playwright/test"

const backend = "http://127.0.0.1:8090"

test("sets up, reconciles, pays, files, and exports a tax agenda", async ({ page, request }) => {
  const adminAuth = await request.post(`${backend}/api/collections/_superusers/auth-with-password`, { data: { identity: "e2e-admin@jornal.test", password: "StrongPass123!" } })
  expect(adminAuth.ok()).toBeTruthy()
  const admin = await adminAuth.json() as { token: string }
  const email = `tax-e2e-${Date.now()}@example.com`
  const createdUser = await request.post(`${backend}/api/collections/users/records`, {
    headers: { Authorization: admin.token }, data: { email, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" },
  })
  expect(createdUser.ok()).toBeTruthy()
  const user = await createdUser.json() as { id: string; email: string; verified: boolean; collectionId: string; collectionName: string }
  const impersonated = await request.post(`${backend}/api/collections/users/impersonate/${user.id}`, { headers: { Authorization: admin.token } })
  const auth = await impersonated.json() as { token: string }
  const companySetup = await request.post(`${backend}/api/jornal/companies/setup`, {
    headers: { Authorization: auth.token }, data: {
      name: "Toko Browser", creationKey: "tax-e2e-company", requestId: "tax-e2e-company", initialSetup: true,
      profile: {
        businessName: "Toko Browser", businessType: "INDIVIDUAL", businessStartDate: "2026-01-01", fiscalYear: 2026,
        taxScheme: "UMKM_FINAL", pkpStatus: false, useAccountTracking: false, openingBalance: 10_000_000,
        taxReserveConfirmed: 0, lastBalanceCheckIn: null, lastCheckedBalance: null, lastCheckInDelta: null,
        onboardingCompletedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      }, accounts: [],
    },
  })
  expect(companySetup.ok()).toBeTruthy()
  const company = await companySetup.json() as { id: string }
  await page.addInitScript(({ token, record }) => localStorage.setItem("pocketbase_auth", JSON.stringify({ token, record })), { token: auth.token, record: user })

  await page.goto(`/tax?company=${company.id}`)
  await expect(page.getByRole("heading", { name: "Aktifkan agenda pajak" })).toBeVisible()
  await page.getByLabel("Kelayakan PPh Final UMKM").selectOption("ELIGIBLE")
  await page.getByLabel("PPh 21/26 pegawai").check()
  await page.getByRole("button", { name: "Aktifkan agenda" }).click()
  await expect(page.getByRole("heading", { name: "Agenda Pajak" })).toBeVisible()

  await page.getByRole("button", { name: "Konfirmasi dan buat agenda" }).click()
  const payroll = page.locator("article").filter({ hasText: "PPh 21/26 pegawai" })
  await expect(payroll).toBeVisible()
  await payroll.getByRole("button", { name: "Isi nominal" }).click()
  await payroll.getByLabel("Nominal terutang").fill("100000")
  await payroll.getByLabel("Sumber nominal").fill("Payroll September")
  await payroll.getByRole("button", { name: "Simpan nominal" }).click()
  await expect(payroll.getByText("Rp100.000")).toBeVisible()

  await payroll.getByRole("button", { name: "Catat pembayaran" }).click()
  await payroll.getByLabel("Referensi/NTPN").fill("NTPN-E2E")
  await payroll.getByRole("button", { name: "Simpan pembayaran" }).click()
  await expect(payroll.getByText("Lunas")).toBeVisible()

  const payrollFiling = page.locator("article").filter({ hasText: "SPT MASA 21 26" })
  await payrollFiling.getByRole("button", { name: "Catat pelaporan" }).click()
  await payrollFiling.getByLabel("Nomor BPE/referensi").fill("BPE-E2E")
  await payrollFiling.getByRole("button", { name: "Tandai sudah dilaporkan" }).click()
  await expect(payrollFiling.getByText("FILED", { exact: true })).toBeVisible()

  await page.getByRole("button", { name: /Pengaturan dan rekap/ }).click()
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: /Rekap CSV/ }).click()
  expect((await download).suggestedFilename()).toContain("rekap-pajak")
})

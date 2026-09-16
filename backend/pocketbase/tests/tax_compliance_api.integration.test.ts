import { afterAll, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const pocketBaseBin = process.env.POCKETBASE_BIN
const integrationTest = pocketBaseBin ? test : test.skip
let server: ReturnType<typeof Bun.spawn> | null = null
let smtpServer: { port: number; stop: (closeActiveConnections?: boolean) => void } | null = null
const smtpMessages: string[] = []
let dataDirectory = ""

afterAll(async () => {
  server?.kill()
  if (server) await server.exited.catch(() => undefined)
  smtpServer?.stop(true)
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

integrationTest("tax compliance API isolates subjects and generates cumulative UMKM obligations", async () => {
  let smtpBuffer = ""; let smtpBody = ""; let smtpDataMode = false
  smtpServer = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
    open(socket) { socket.write("220 localhost Jornal test SMTP\r\n") },
    data(socket, chunk) {
      smtpBuffer += Buffer.from(chunk).toString("utf8")
      if (smtpDataMode) {
        smtpBody += smtpBuffer; smtpBuffer = ""; const end = smtpBody.indexOf("\r\n.\r\n")
        if (end >= 0) { smtpMessages.push(smtpBody.slice(0, end)); smtpBody = ""; smtpDataMode = false; socket.write("250 2.0.0 queued\r\n") }
        return
      }
      while (smtpBuffer.includes("\r\n")) {
        const index = smtpBuffer.indexOf("\r\n"); const line = smtpBuffer.slice(0, index); smtpBuffer = smtpBuffer.slice(index + 2)
        const command = line.toUpperCase()
        if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250-localhost\r\n250 SIZE 12000000\r\n")
        else if (command.startsWith("MAIL FROM") || command.startsWith("RCPT TO")) socket.write("250 2.1.0 OK\r\n")
        else if (command === "DATA") { smtpDataMode = true; socket.write("354 End data with <CR><LF>.<CR><LF>\r\n") }
        else if (command === "QUIT") { socket.write("221 2.0.0 bye\r\n"); socket.end() }
        else socket.write("250 OK\r\n")
      }
    },
  } })
  dataDirectory = await mkdtemp(join(tmpdir(), "jornal-tax-integration-"))
  const migrations = resolve(import.meta.dir, "../pb_migrations")
  const hooks = resolve(import.meta.dir, "../pb_hooks")
  const run = (args: string[]) => {
    const result = Bun.spawnSync([pocketBaseBin!, ...args], { stdout: "pipe", stderr: "pipe" })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  run(["migrate", "up", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks])
  run(["superuser", "upsert", "admin@example.com", "StrongPass123!", "--dir", dataDirectory])
  const port = 32_000 + Math.floor(Math.random() * 1_000)
  const origin = `http://127.0.0.1:${port}`
  server = Bun.spawn([pocketBaseBin!, "serve", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks, `--http=127.0.0.1:${port}`], { stdout: "ignore", stderr: "pipe", env: { ...process.env, JORNAL_TAX_EMAIL_ENABLED: "true" } })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if ((await fetch(`${origin}/api/health`).catch(() => null))?.ok) break
    await Bun.sleep(50)
  }
  const send = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${origin}${path}`, init)
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    return { response, data }
  }
  const jsonHeaders = (token: string) => ({ Authorization: token, "Content-Type": "application/json" })
  const admin = await send("/api/collections/_superusers/auth-with-password", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "admin@example.com", password: "StrongPass123!" }),
  })
  const settingsUpdate = await send("/api/settings", {
    method: "PATCH", headers: jsonHeaders(String(admin.data.token)), body: JSON.stringify({
      smtp: { enabled: true, host: "127.0.0.1", port: smtpServer.port, username: "", password: "", authMethod: "PLAIN", tls: false, localName: "localhost" },
      meta: { appName: "Jornal", appURL: origin, senderName: "Jornal", senderAddress: "noreply@jornal.test", hideControls: false },
    }),
  })
  if (settingsUpdate.response.status !== 200) throw new Error(`SMTP settings failed ${settingsUpdate.response.status}: ${JSON.stringify(settingsUpdate.data)}`)
  const createUser = async (email: string) => {
    const created = await send("/api/collections/users/records", {
      method: "POST", headers: jsonHeaders(String(admin.data.token)),
      body: JSON.stringify({ email, verified: true, password: "UserPass123!", passwordConfirm: "UserPass123!" }),
    })
    const auth = await send(`/api/collections/users/impersonate/${created.data.id}`, { method: "POST", headers: { Authorization: String(admin.data.token) } })
    return { id: String(created.data.id), token: String(auth.data.token) }
  }
  const owner = await createUser("tax-owner@example.com")
  const foreign = await createUser("tax-foreign@example.com")
  const setupCompany = async (user: typeof owner, name: string, key: string, initialSetup = true) => {
    const result = await send("/api/jornal/companies/setup", {
      method: "POST", headers: jsonHeaders(user.token), body: JSON.stringify({
        name, creationKey: key, requestId: key, initialSetup,
        profile: { businessName: name, businessType: "INDIVIDUAL", taxScheme: "UMKM_FINAL" }, accounts: [],
      }),
    })
    if (![200, 201].includes(result.response.status)) throw new Error(`company setup failed ${result.response.status}: ${JSON.stringify(result.data)}`)
    return String(result.data.id)
  }
  const companyId = await setupCompany(owner, "Toko Pajak", "company-tax")
  const foreignCompanyId = await setupCompany(foreign, "Foreign", "company-foreign")

  const setupBody = {
    commandKey: "tax-setup-1", label: "WP Toko Pajak", subjectType: "INDIVIDUAL",
    companyIds: [companyId], effectiveFrom: "2026-01-01", umkmEligibility: "ELIGIBLE",
    registrations: [{ kind: "PPH_FINAL_UMKM" }, { kind: "PPH_21_26_PAYROLL" }],
    inAppEnabled: true, emailEnabled: true,
  }
  const setup = await send("/api/jornal/tax/setup", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(setupBody) })
  expect(setup.response.status).toBe(201)
  const subject = setup.data.subject as Record<string, unknown>
  const subjectId = String(subject.id)
  expect(subject.type).toBe("INDIVIDUAL")
  expect(setup.data.registrations).toBeArrayOfSize(3)
  const replay = await send("/api/jornal/tax/setup", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(setupBody) })
  expect(replay.response.status).toBe(201)
  expect((replay.data.subject as Record<string, unknown>).id).toBe(subjectId)
  const mismatch = await send("/api/jornal/tax/setup", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ ...setupBody, label: "Changed" }) })
  expect(mismatch.response.status).toBe(409)

  const foreignAttempt = await send("/api/jornal/tax/setup", {
    method: "POST", headers: jsonHeaders(foreign.token), body: JSON.stringify({ ...setupBody, commandKey: "foreign-forge" }),
  })
  expect(foreignAttempt.response.status).toBe(404)
  const duplicateCompany = await send("/api/jornal/tax/setup", {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ ...setupBody, commandKey: "duplicate-subject" }),
  })
  expect(duplicateCompany.response.status).toBe(409)
  const secondCompanyId = await setupCompany(owner, "Cabang Pajak", "company-tax-second", false)
  const foreignSecondCompanyId = await setupCompany(foreign, "Foreign Cabang", "company-foreign-second", false)
  const linkedCompany = await send(`/api/jornal/tax/subjects/${subjectId}/companies`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ commandKey: "link-second-company", companyId: secondCompanyId, effectiveFrom: "2026-02-01" }),
  })
  expect(linkedCompany.response.status).toBe(201)

  const saveInput = async (commandKey: string, period: string, company: string | null, taxableRevenue: number, externalRevenue = 0, openingYtdRevenue = 0) => {
    const result = await send("/api/jornal/tax/period-inputs", {
      method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
        commandKey, subjectId, companyId: company, period, taxableRevenue, externalRevenue, openingYtdRevenue,
        adjustments: 0, dataStatus: "COMPLETE", sourceRevision: commandKey,
      }),
    })
    if (![200, 201].includes(result.response.status)) throw new Error(`period input failed ${result.response.status}: ${JSON.stringify(result.data)}`)
  }
  await saveInput("jan-company", "2026-01", companyId, 490_000_000)
  await saveInput("jan-external", "2026-01", null, 0, 0)
  await saveInput("feb-company", "2026-02", companyId, 10_000_000)
  await saveInput("feb-second-company", "2026-02", secondCompanyId, 20_000_000)
  await saveInput("feb-external", "2026-02", null, 0, 0)
  const generated = await send("/api/jornal/tax/obligations/generate", {
    method: "POST", headers: jsonHeaders(owner.token),
    body: JSON.stringify({ commandKey: "generate-feb", subjectId, period: "2026-02" }),
  })
  expect(generated.response.status).toBe(200)
  const obligations = generated.data.obligations as Array<Record<string, unknown>>
  const umkm = obligations.find((item) => item.kind === "PPH_FINAL_UMKM")
  expect(umkm).toMatchObject({ liability_amount: 100_000, remaining_payable: 100_000, amount_state: "CONFIRMED" })
  const payroll = obligations.find((item) => item.kind === "PPH_21_26_PAYROLL")
  expect(payroll).toMatchObject({ liability_amount: null, amount_state: "UNKNOWN", payment_status: "UNKNOWN" })

  await saveInput("opening-2027-company", "2027-01", companyId, 10_000_000)
  await saveInput("opening-2027-second-company", "2027-01", secondCompanyId, 20_000_000)
  await saveInput("opening-2027-external", "2027-01", null, 0, 0, 490_000_000)
  const generatedOpening = await send("/api/jornal/tax/obligations/generate", {
    method: "POST", headers: jsonHeaders(owner.token),
    body: JSON.stringify({ commandKey: "generate-opening-2027", subjectId, period: "2027-01" }),
  })
  expect((generatedOpening.data.obligations as Array<Record<string, unknown>>).find((item) => item.kind === "PPH_FINAL_UMKM"))
    .toMatchObject({ liability_amount: 100_000, amount_state: "CONFIRMED" })

  const agenda = await send(`/api/jornal/tax/agenda?companyId=${companyId}`, { headers: { Authorization: owner.token } })
  expect(agenda.response.status).toBe(200)
  expect((agenda.data.obligations as unknown[]).length).toBe(4)
  expect((agenda.data.filings as unknown[]).length).toBe(4)

  const sharedRegistration = await send(`/api/jornal/tax/subjects/${subjectId}/registrations`, {
    method: "POST", headers: jsonHeaders(owner.token),
    body: JSON.stringify({ commandKey: "add-shared-pph23", kind: "PPH_23_26", activeFrom: "2026-03-01" }),
  })
  expect(sharedRegistration.response.status).toBe(201)
  await saveInput("mar-company", "2026-03", companyId, 10_000_000)
  await saveInput("mar-second-company", "2026-03", secondCompanyId, 0)
  await saveInput("mar-external", "2026-03", null, 0)
  const generatedShared = await send("/api/jornal/tax/obligations/generate", {
    method: "POST", headers: jsonHeaders(owner.token),
    body: JSON.stringify({ commandKey: "generate-shared-march", subjectId, period: "2026-03" }),
  })
  const sharedObligations = generatedShared.data.obligations as Array<Record<string, unknown>>
  const marchUmkm = sharedObligations.find((item) => item.kind === "PPH_FINAL_UMKM")!
  expect(marchUmkm.liability_amount).toBe(50_000)
  expect(sharedObligations.find((item) => item.kind === "PPH_23_26")).toMatchObject({ amount_state: "UNKNOWN" })
  const paidOnlyUmkm = await send("/api/jornal/tax/settlements", {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "pay-only-umkm-shared-filing", subjectId, type: "OUTSIDE_LEDGER", amount: 50_000,
      settlementDate: "2026-04-10", reference: "NTPN-SHARED", validatedPayment: true,
      allocations: [{ obligationId: String(marchUmkm.id), amount: 50_000 }],
    }),
  })
  expect(paidOnlyUmkm.response.status).toBe(201)
  const sharedAgenda = await send(`/api/jornal/tax/agenda?subjectId=${subjectId}`, { headers: { Authorization: owner.token } })
  const sharedFiling = (sharedAgenda.data.filings as Array<Record<string, unknown>>).find((item) => item.period === "2026-03" && item.filing_group === "SPT_MASA_UNIFIKASI")!
  expect(sharedFiling.status).toBe("PENDING")

  const partialBody = {
    commandKey: "pay-partial", subjectId, type: "OUTSIDE_LEDGER", amount: 40_000,
    settlementDate: "2026-03-10", source: "Bukti bayar manual",
    allocations: [{ obligationId: String(umkm!.id), amount: 40_000 }],
  }
  const partial = await send("/api/jornal/tax/settlements", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(partialBody) })
  expect(partial.response.status).toBe(201)
  expect((partial.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ remaining_payable: 60_000, payment_status: "PARTIAL" })
  const partialReplay = await send("/api/jornal/tax/settlements", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(partialBody) })
  expect((partialReplay.data.settlement as Record<string, unknown>).id).toBe((partial.data.settlement as Record<string, unknown>).id)

  const finalPayment = await send("/api/jornal/tax/settlements", {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "pay-final", subjectId, type: "SELF_PAYMENT", amount: 60_000,
      settlementDate: "2026-03-11", reference: "NTPN-TEST", validatedPayment: true,
      allocations: [{ obligationId: String(umkm!.id), amount: 60_000 }],
      ledgerTransaction: { id: "tax-payment-feb", companyId, description: "PPh Final Februari 2026", accountId: null },
    }),
  })
  expect(finalPayment.response.status).toBe(201)
  expect((finalPayment.data.ledgerTransaction as Record<string, unknown>)).toMatchObject({
    id: "tax-payment-feb", classification: "TAX_PAYMENT", taxKind: "PPH_FINAL_UMKM", taxPeriod: "2026-02",
  })
  expect((finalPayment.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ remaining_payable: 0, payment_status: "PAID" })
  const overpayment = await send("/api/jornal/tax/settlements", {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "pay-over", subjectId, type: "OUTSIDE_LEDGER", amount: 10_000, settlementDate: "2026-03-12",
      allocations: [{ obligationId: String(umkm!.id), amount: 10_000 }],
    }),
  })
  expect((overpayment.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ overpaid_amount: 10_000, payment_status: "OVERPAID" })
  const overSettlement = overpayment.data.settlement as Record<string, unknown>
  const undoOverpayment = await send(`/api/jornal/tax/settlements/${overSettlement.id}/reverse`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ commandKey: "reverse-over", revision: overSettlement.revision, reason: "Uji koreksi lebih bayar" }),
  })
  expect((undoOverpayment.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ remaining_payable: 0, payment_status: "PAID" })
  const afterPayment = await send(`/api/jornal/tax/agenda?companyId=${companyId}`, { headers: { Authorization: owner.token } })
  const paidUmkm = (afterPayment.data.obligations as Array<Record<string, unknown>>).find((item) => item.id === umkm!.id)!
  const snoozed = await send(`/api/jornal/tax/obligations/${umkm!.id}/snooze`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ commandKey: "snooze-umkm", revision: paidUmkm.revision, snoozedUntil: "2026-10-01", reason: "Menunggu dokumen" }),
  })
  expect(snoozed.data.snoozed_until).toStartWith("2026-10-01")
  expect(snoozed.data.statutory_due_date).toBe(paidUmkm.statutory_due_date)
  const umkmFiling = (afterPayment.data.filings as Array<Record<string, unknown>>).find((item) => item.filing_group === "SPT_MASA_UNIFIKASI" && item.period === "2026-02")
  if (umkmFiling?.status !== "FULFILLED_BY_PAYMENT") throw new Error(`filing not fulfilled: ${JSON.stringify(umkmFiling)}`)
  const ledger = await send("/api/collections/jornal_records/records?filter=app_id%3D%27tax-payment-feb%27", {
    headers: { Authorization: owner.token, "X-Jornal-Protocol": "2", "X-Jornal-Company": companyId },
  })
  expect(ledger.response.status).toBe(200)
  const ledgerRecord = (ledger.data.items as Array<Record<string, unknown>>)[0]
  const blockedDelete = await send(`/api/collections/jornal_records/records/${ledgerRecord.id}`, {
    method: "DELETE", headers: { Authorization: owner.token, "X-Jornal-Protocol": "2", "X-Jornal-Company": companyId },
  })
  expect(blockedDelete.response.status).toBe(409)

  const payrollFiling = (afterPayment.data.filings as Array<Record<string, unknown>>).find((item) => item.filing_group === "SPT_MASA_21_26" && item.period === "2026-02")!
  expect(payrollFiling).toBeDefined()
  const filed = await send(`/api/jornal/tax/filings/${payrollFiling.id}/complete`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "file-payroll-feb", revision: payrollFiling.revision, filedAt: "2026-03-18", reference: "BPE-TEST",
    }),
  })
  if (filed.response.status !== 200) throw new Error(`filing completion failed ${filed.response.status}: ${JSON.stringify(filed.data)}`)
  expect(filed.data.status).toBe("FILED")
  const amended = await send(`/api/jornal/tax/filings/${payrollFiling.id}/amend`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "amend-payroll-feb", revision: filed.data.revision, filedAt: "2026-03-19", reference: "BPE-PEMBETULAN", reason: "Koreksi bukti penerimaan",
    }),
  })
  expect(amended.response.status).toBe(200)
  expect(amended.data).toMatchObject({ status: "FILED", amendment_number: 1 })

  const evidenceForm = new FormData()
  evidenceForm.append("commandKey", "evidence-payroll-feb")
  evidenceForm.append("subjectId", subjectId)
  evidenceForm.append("parentType", "filing")
  evidenceForm.append("parentId", String(payrollFiling.id))
  evidenceForm.append("sha256", "a".repeat(64))
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="), (character) => character.charCodeAt(0))
  evidenceForm.append("document", new File([png], "bukti.png", { type: "image/png" }))
  const evidence = await send("/api/jornal/tax/evidence", { method: "POST", headers: { Authorization: owner.token }, body: evidenceForm })
  if (evidence.response.status !== 201) throw new Error(`evidence upload failed ${evidence.response.status}: ${JSON.stringify(evidence.data)}`)
  expect(evidence.response.status).toBe(201)
  const evidenceDownload = await fetch(`${origin}/api/jornal/tax/evidence/${evidence.data.id}/download`, { headers: { Authorization: owner.token } })
  if (evidenceDownload.status !== 200) throw new Error(`evidence download failed ${evidenceDownload.status}: ${await evidenceDownload.text()}`)
  expect(evidenceDownload.status).toBe(200)
  expect((await evidenceDownload.arrayBuffer()).byteLength).toBe(png.byteLength)
  const foreignEvidence = await fetch(`${origin}/api/jornal/tax/evidence/${evidence.data.id}/download`, { headers: { Authorization: foreign.token } })
  expect(foreignEvidence.status).toBe(404)

  const report = await fetch(`${origin}/api/jornal/tax/subjects/${subjectId}/report/2026`, { headers: { Authorization: owner.token } })
  expect(report.status).toBe(200)
  expect(await report.text()).toContain("PPH_FINAL_UMKM")
  const exported = await send(`/api/jornal/tax/export?subjectId=${subjectId}`, { headers: { Authorization: owner.token } })
  expect(exported.response.status).toBe(200)
  expect((exported.data.manifest as Record<string, unknown>).format).toBe("jornal-tax-backup")
  expect((exported.data.manifest as Record<string, unknown>).notificationsEnabled).toBe(false)
  const preview = await send("/api/jornal/tax/import/preview", { method: "POST", headers: jsonHeaders(foreign.token), body: JSON.stringify({ backup: exported.data }) })
  expect(preview.response.status).toBe(200)
  expect(preview.data.valid).toBe(true)
  const restoreBody = { commandKey: "restore-owner-backup", backup: exported.data, companyMap: { [companyId]: foreignCompanyId, [secondCompanyId]: foreignSecondCompanyId }, confirm: true }
  const restored = await send("/api/jornal/tax/import", { method: "POST", headers: jsonHeaders(foreign.token), body: JSON.stringify(restoreBody) })
  if (restored.response.status !== 200) throw new Error(`restore failed ${restored.response.status}: ${JSON.stringify(restored.data)}`)
  expect(restored.data).toMatchObject({ restored: true, notificationOptInsDisabled: true })
  const restoredReplay = await send("/api/jornal/tax/import", { method: "POST", headers: jsonHeaders(foreign.token), body: JSON.stringify(restoreBody) })
  expect(restoredReplay.data).toEqual(restored.data)

  const overAllocated = await send("/api/jornal/tax/settlements", {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
      commandKey: "bad-allocation", subjectId, type: "OUTSIDE_LEDGER", amount: 1,
      settlementDate: "2026-03-12", allocations: [{ obligationId: String(umkm!.id), amount: 2 }],
    }),
  })
  expect(overAllocated.response.status).toBe(400)
  const annualRegistration = await send(`/api/jornal/tax/subjects/${subjectId}/registrations`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ commandKey: "add-pph29", kind: "PPH_29", activeFrom: "2026-01-01", defaultAmount: 20_000_000 }),
  })
  expect(annualRegistration.response.status).toBe(201)
  const runJobs = await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  if (runJobs.response.status !== 200) throw new Error(`tax jobs failed ${runJobs.response.status}: ${JSON.stringify(runJobs.data)}`)
  expect(smtpMessages.length).toBeGreaterThan(0)
  expect(smtpMessages.join("\n")).toContain("Pengingat agenda pajak Jornal")
  expect(smtpMessages.join("\n")).not.toContain("Total sisa terkonfirmasi")
  const health = await send("/api/jornal/admin/tax/health", { headers: { Authorization: String(admin.data.token) } })
  expect(health.response.status).toBe(200)
  expect(health.data).toMatchObject({ complianceEnabled: true, emailDeliveryEnabled: true, smtpConfigured: true })
  const annualAgenda = await send(`/api/jornal/tax/agenda?companyId=${companyId}`, { headers: { Authorization: owner.token } })
  const pph29 = (annualAgenda.data.obligations as Array<Record<string, unknown>>).find((item) => item.kind === "PPH_29" && item.period === "2026")!
  expect(pph29).toMatchObject({ liability_amount: 20_000_000, remaining_payable: 20_000_000 })
  const annualCredit = await send("/api/jornal/tax/settlements", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
    commandKey: "annual-credit", subjectId, type: "THIRD_PARTY_WITHHOLDING", amount: 12_000_000, settlementDate: "2027-02-01", reference: "BUKTI-POTONG", allocations: [{ obligationId: pph29.id, amount: 12_000_000 }],
  }) })
  expect((annualCredit.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ settled_by_third_party: 12_000_000, remaining_payable: 8_000_000 })
  const annualInstallment = await send("/api/jornal/tax/settlements", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({
    commandKey: "annual-installment", subjectId, type: "COMPENSATION", amount: 5_000_000, settlementDate: "2027-02-02", reference: "ANGSURAN-P25", allocations: [{ obligationId: pph29.id, amount: 5_000_000 }],
  }) })
  expect((annualInstallment.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ allocated_payments: 5_000_000, remaining_payable: 3_000_000 })
  // Drain bounded worker batches before asserting that a replay creates no
  // duplicate inbox rows.
  for (let batch = 0; batch < 3; batch += 1) {
    await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  }
  const inbox = await send("/api/jornal/tax/inbox", { headers: { Authorization: owner.token } })
  expect(inbox.response.status).toBe(200)
  expect((inbox.data.items as unknown[]).length).toBeGreaterThan(0)
  const inboxCount = (inbox.data.items as unknown[]).length
  await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  const inboxAfterReplay = await send("/api/jornal/tax/inbox", { headers: { Authorization: owner.token } })
  expect((inboxAfterReplay.data.items as unknown[]).length).toBe(inboxCount)
  const inboxIds = (inboxAfterReplay.data.items as Array<Record<string, unknown>>).map((item) => String(item.id))
  const readBody = { commandKey: "read-inbox", ids: inboxIds }
  const read = await send("/api/jornal/tax/inbox/read", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(readBody) })
  expect(read.data.updated).toBe(inboxCount)
  const readReplay = await send("/api/jornal/tax/inbox/read", { method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify(readBody) })
  expect(readReplay.data.updated).toBe(inboxCount)
  const emptyInbox = await send("/api/jornal/tax/inbox", { headers: { Authorization: owner.token } })
  expect(emptyInbox.data.items).toEqual([])

  const staleReminder = await send("/api/collections/tax_notifications/records", {
    method: "POST", headers: jsonHeaders(String(admin.data.token)), body: JSON.stringify({
      tenant_id: owner.id, subject_id: subjectId, obligation_id: String(umkm!.id), action: "PAY", channel: "EMAIL",
      scheduled_at: "2020-01-01T00:00:00.000Z", dedupe_key: "stale-paid-obligation-test", status: "PENDING",
      attempt_count: 0, schedule_version: "stale-test",
    }),
  })
  expect(staleReminder.response.status).toBe(200)
  await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  const staleReminderAfterRun = await send(`/api/collections/tax_notifications/records/${staleReminder.data.id}`, { headers: { Authorization: String(admin.data.token) } })
  expect(staleReminderAfterRun.data.status).toBe("CANCELLED")

  const finalSettlement = finalPayment.data.settlement as Record<string, unknown>
  const reversed = await send(`/api/jornal/tax/settlements/${finalSettlement.id}/reverse`, {
    method: "POST", headers: jsonHeaders(owner.token), body: JSON.stringify({ commandKey: "reverse-final", revision: finalSettlement.revision, reason: "Pembayaran salah dialokasikan" }),
  })
  expect(reversed.response.status).toBe(200)
  expect((reversed.data.settlement as Record<string, unknown>).status).toBe("REVERSED")
  expect((reversed.data.obligations as Array<Record<string, unknown>>)[0]).toMatchObject({ remaining_payable: 60_000, payment_status: "PARTIAL" })
  const deleteReversedLedger = await send(`/api/collections/jornal_records/records/${ledgerRecord.id}`, {
    method: "DELETE", headers: { Authorization: owner.token, "X-Jornal-Protocol": "2", "X-Jornal-Company": companyId },
  })
  expect(deleteReversedLedger.response.status).toBe(204)

  const notificationList = await send("/api/collections/tax_notifications/records?perPage=500", { headers: { Authorization: String(admin.data.token) } })
  const notifications = notificationList.data.items as Array<Record<string, unknown>>
  const sentInApp = notifications.find((item) => item.channel === "IN_APP" && item.status === "SENT")!
  const leasePatch = await send(`/api/collections/tax_notifications/records/${sentInApp.id}`, {
    method: "PATCH", headers: jsonHeaders(String(admin.data.token)),
    body: JSON.stringify({ status: "LEASED", lease_until: "2020-01-01T00:00:00.000Z" }),
  })
  expect(leasePatch.response.status).toBe(200)
  await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  const recoveredLease = await send(`/api/collections/tax_notifications/records/${sentInApp.id}`, { headers: { Authorization: String(admin.data.token) } })
  expect(recoveredLease.data.status).toBe("UNKNOWN")

  const sentEmail = notifications.find((item) => item.channel === "EMAIL" && item.status === "SENT")!
  const retryPatch = await send(`/api/collections/tax_notifications/records/${sentEmail.id}`, {
    method: "PATCH", headers: jsonHeaders(String(admin.data.token)),
    body: JSON.stringify({ status: "PENDING", scheduled_at: "2020-01-01T00:00:00.000Z", sent_at: "", attempt_count: 0, dedupe_key: `${sentEmail.dedupe_key}-smtp-failure` }),
  })
  expect(retryPatch.response.status).toBe(200)
  smtpServer.stop(true)
  smtpServer = null
  const failedDeliveryRun = await send("/api/jornal/admin/tax/run-jobs", { method: "POST", headers: { Authorization: String(admin.data.token) } })
  expect(failedDeliveryRun.response.status).toBe(200)
  const failedDelivery = await send(`/api/collections/tax_notifications/records/${sentEmail.id}`, { headers: { Authorization: String(admin.data.token) } })
  expect(failedDelivery.data.status).toBe("RETRYABLE_FAILED")
  const failureHealth = await send("/api/jornal/admin/tax/health", { headers: { Authorization: String(admin.data.token) } })
  expect(((failureHealth.data.queue as Record<string, number>).retryableFailed ?? 0)).toBeGreaterThan(0)

  const foreignAgenda = await send("/api/jornal/tax/agenda", { headers: { Authorization: foreign.token } })
  expect(foreignAgenda.response.status).toBe(200)
  expect((foreignAgenda.data.obligations as unknown[]).length).toBeGreaterThan(0)
  const rawSubjects = await send("/api/collections/tax_subjects/records", { headers: { Authorization: owner.token } })
  expect(rawSubjects.response.status).toBe(403)
}, 30_000)

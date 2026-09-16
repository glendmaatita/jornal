import { describe, expect, test } from "bun:test"

const migration = await Bun.file(new URL("../pb_migrations/20260916_0006_multi_company.js", import.meta.url)).text()
const companyRoutes = await Bun.file(new URL("../pb_hooks/companies.pb.js", import.meta.url)).text()
const recordHooks = await Bun.file(new URL("../pb_hooks/jornal_sync.pb.js", import.meta.url)).text()
const helpers = await Bun.file(new URL("../pb_hooks/jornal_helpers.js", import.meta.url)).text()

describe("multi-company backend contract", () => {
  test("requires explicit protocol scope and immutable company identity", () => {
    expect(migration).toContain("@request.headers.x_jornal_company")
    expect(migration).toContain("companies.updateRule = null")
    expect(recordHooks).toContain("onRecordDeleteRequest")
    expect(recordHooks).toContain("onRecordViewRequest")
    expect(recordHooks).toContain("onFileDownloadRequest")
    expect(helpers).toContain('protocol !== "2"')
    expect(helpers).toContain("validatePayloadReferences")
  })

  test("uses atomic lifecycle endpoints with epoch and audit", () => {
    expect(companyRoutes).toContain('$app.runInTransaction')
    expect(companyRoutes).toContain('"company-archived"')
    expect(companyRoutes).toContain('"company-restored"')
    expect(companyRoutes).toContain('company.set("data_epoch", company.getInt("data_epoch") + 1)')
    expect(migration).toContain("actor_id")
  })
})

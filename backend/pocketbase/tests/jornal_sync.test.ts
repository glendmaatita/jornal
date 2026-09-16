import { describe, expect, test } from "bun:test"

const hook = `${await Bun.file(new URL("../pb_hooks/jornal_sync.pb.js", import.meta.url)).text()}\n${await Bun.file(new URL("../pb_hooks/jornal_helpers.js", import.meta.url)).text()}`

describe("PocketBase sync hook invariants", () => {
  test("keeps tenant and logical record identity immutable", () => {
    expect(hook).toContain('for (const field of ["business_id", "company_id", "data_epoch", "entity", "app_id"])')
    expect(hook).toContain("cannot be changed")
    expect(hook).toContain("incomingRevision !== currentRevision + 1")
    expect(hook).toContain('event.record.set("revision", 1)')
  })
})

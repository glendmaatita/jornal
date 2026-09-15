import { describe, expect, test } from "bun:test"

const hook = await Bun.file(new URL("./jornal_sync.js", import.meta.url)).text()

describe("PocketBase sync hook invariants", () => {
  test("keeps tenant and logical record identity immutable", () => {
    expect(hook).toContain('for (const field of ["business_id", "entity", "app_id"])')
    expect(hook).toContain("cannot be changed")
  })
})

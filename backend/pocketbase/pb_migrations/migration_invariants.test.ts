import { describe, expect, test } from "bun:test"

const metadata = await Bun.file(new URL("./20260914_0004_sync_metadata.js", import.meta.url)).text()
const revisions = await Bun.file(new URL("./20260915_0005_revision_tombstones.js", import.meta.url)).text()

describe("PocketBase migration invariants", () => {
  test("metadata migrations tolerate already-present fields", () => {
    expect(metadata).toContain('if (!collection.fields.getByName("created"))')
    expect(metadata).toContain('if (!collection.fields.getByName("updated"))')
    expect(revisions).toContain('if (!collection.fields.getByName("revision"))')
    expect(revisions).toContain('if (!collection.fields.getByName("deleted_at"))')
    expect(metadata).toContain("Keep fields on rollback")
    expect(revisions).toContain("Keep metadata on rollback")
  })
})

import { describe, expect, test } from "bun:test"

const scheduledHookNames = [
  "document_jobs.pb.js",
  "invoice_jobs.pb.js",
  "notification_jobs.pb.js",
  "tax_jobs.pb.js",
  "team_invitation_jobs.pb.js",
]

describe("scheduled PocketBase jobs", () => {
  test("can be disabled while integration tests invoke jobs explicitly", async () => {
    for (const name of scheduledHookNames) {
      const source = await Bun.file(new URL(`../pb_hooks/${name}`, import.meta.url)).text()
      expect(source).toContain('if ($os.getenv("JORNAL_CRON_ENABLED") !== "false")')
      expect(source).toContain("cronAdd(")
    }
  })
})

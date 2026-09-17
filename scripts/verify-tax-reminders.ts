import { existsSync } from "node:fs"

const expectedVersion = "0.40.2"
const configured = process.env.POCKETBASE_BIN?.trim()
const binary = configured || Bun.which("pocketbase")

if (!binary || !existsSync(binary)) {
  console.error("Tax integration tests require PocketBase 0.40.2. Set POCKETBASE_BIN to the executable path.")
  process.exit(2)
}

const version = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
const versionText = `${version.stdout.toString()} ${version.stderr.toString()}`
if (version.exitCode !== 0 || !versionText.includes(expectedVersion)) {
  console.error(`Expected PocketBase ${expectedVersion}, received: ${versionText.trim() || "unknown"}`)
  process.exit(2)
}

const tests = [
  "backend/pocketbase/tests/multi_company_api.integration.test.ts",
  "backend/pocketbase/tests/multi_company_migration.integration.test.ts",
  "backend/pocketbase/tests/tax_compliance_api.integration.test.ts",
]
for (const file of tests) {
  console.log(`\nRunning ${file}`)
  const result = Bun.spawnSync([process.execPath, "test", file], {
    cwd: process.cwd(),
    env: { ...process.env, POCKETBASE_BIN: binary, RUN_POCKETBASE_INTEGRATION: "1" },
    stdout: "inherit",
    stderr: "inherit",
  })
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

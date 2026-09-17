import { existsSync } from "node:fs"
import { resolve } from "node:path"

const binary = process.env.POCKETBASE_BIN?.trim() || Bun.which("pocketbase")
if (!binary || !existsSync(binary)) throw new Error("Set POCKETBASE_BIN to the PocketBase 0.40.2 binary; the team gate never skips.")
const version = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
if (!`${version.stdout}${version.stderr}`.includes("0.40.2")) throw new Error("Team invitations require PocketBase 0.40.2.")
const result = Bun.spawnSync(["bun", "test", resolve(import.meta.dir, "../backend/pocketbase/tests/team_invitation_api.integration.test.ts")], {
  stdout: "inherit", stderr: "inherit", env: { ...process.env, POCKETBASE_BIN: binary },
})
if (result.exitCode !== 0) process.exit(result.exitCode)

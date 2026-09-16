import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const binary = process.env.POCKETBASE_BIN?.trim() || Bun.which("pocketbase")
if (!binary || !existsSync(binary)) throw new Error("Set POCKETBASE_BIN to PocketBase 0.40.2 for the browser gate.")
const version = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
if (!`${version.stdout}${version.stderr}`.includes("0.40.2")) throw new Error("The browser gate requires PocketBase 0.40.2.")

const dataDirectory = await mkdtemp(join(tmpdir(), "jornal-tax-e2e-"))
const migrations = resolve(import.meta.dir, "../backend/pocketbase/pb_migrations")
const hooks = resolve(import.meta.dir, "../backend/pocketbase/pb_hooks")
const run = (args: string[]) => {
  const result = Bun.spawnSync([binary, ...args], { stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`PocketBase command failed: ${args.join(" ")}`)
}
run(["migrate", "up", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks])
run(["superuser", "upsert", "e2e-admin@jornal.test", "StrongPass123!", "--dir", dataDirectory])

const child = Bun.spawn([binary, "serve", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks, "--http=127.0.0.1:8090"], {
  stdout: "inherit", stderr: "inherit", env: { ...process.env, JORNAL_TAX_EMAIL_ENABLED: "false" },
})
let closing = false
const close = async () => {
  if (closing) return; closing = true; child.kill(); await child.exited.catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true }); process.exit(0)
}
process.on("SIGINT", () => void close())
process.on("SIGTERM", () => void close())
await child.exited
await rm(dataDirectory, { recursive: true, force: true })

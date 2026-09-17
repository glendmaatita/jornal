import { mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const binary = process.env.POCKETBASE_BIN?.trim() || Bun.which("pocketbase")
if (!binary || !existsSync(binary)) throw new Error("Set POCKETBASE_BIN to PocketBase 0.40.2 for the browser gate.")
const version = Bun.spawnSync([binary, "--version"], { stdout: "pipe", stderr: "pipe" })
if (!`${version.stdout}${version.stderr}`.includes("0.40.2")) throw new Error("The browser gate requires PocketBase 0.40.2.")

const dataDirectory = await mkdtemp(join(tmpdir(), "jornal-tax-e2e-"))
let smtpBuffer = ""; let smtpBody = ""; let smtpDataMode = false
const smtp = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
  open(socket) { socket.write("220 localhost Jornal E2E SMTP\r\n") },
  data(socket, chunk) {
    smtpBuffer += Buffer.from(chunk).toString("utf8")
    if (smtpDataMode) {
      smtpBody += smtpBuffer; smtpBuffer = ""; const end = smtpBody.indexOf("\r\n.\r\n")
      if (end >= 0) { smtpBody = smtpBody.slice(end + 5); smtpDataMode = false; socket.write("250 2.0.0 queued\r\n") }
      return
    }
    while (smtpBuffer.includes("\r\n")) {
      const index = smtpBuffer.indexOf("\r\n"); const line = smtpBuffer.slice(0, index); smtpBuffer = smtpBuffer.slice(index + 2); const command = line.toUpperCase()
      if (command.startsWith("EHLO") || command.startsWith("HELO")) socket.write("250-localhost\r\n250 SIZE 12000000\r\n")
      else if (command.startsWith("MAIL FROM") || command.startsWith("RCPT TO")) socket.write("250 OK\r\n")
      else if (command === "DATA") { smtpDataMode = true; socket.write("354 End data\r\n") }
      else if (command === "QUIT") { socket.write("221 bye\r\n"); socket.end() }
      else socket.write("250 OK\r\n")
    }
  },
} })
const migrations = resolve(import.meta.dir, "../backend/pocketbase/pb_migrations")
const hooks = resolve(import.meta.dir, "../backend/pocketbase/pb_hooks")
const run = (args: string[]) => {
  const result = Bun.spawnSync([binary, ...args], { stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) throw new Error(`PocketBase command failed: ${args.join(" ")}`)
}
run(["migrate", "up", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks])
run(["superuser", "upsert", "e2e-admin@jornal.test", "StrongPass123!", "--dir", dataDirectory])

const child = Bun.spawn([binary, "serve", "--dir", dataDirectory, "--migrationsDir", migrations, "--hooksDir", hooks, "--http=127.0.0.1:8090"], {
  stdout: "inherit", stderr: "inherit", env: {
    ...process.env, JORNAL_TAX_EMAIL_ENABLED: "false", JORNAL_TEAM_INVITATIONS_ENABLED: "true",
    JORNAL_TEAM_INVITATION_EMAIL_ENABLED: "true", JORNAL_PUBLIC_URL: "http://127.0.0.1:4173",
  },
})
for (let attempt = 0; attempt < 100; attempt += 1) {
  if ((await fetch("http://127.0.0.1:8090/api/health").catch(() => null))?.ok) break
  await Bun.sleep(50)
}
const authResponse = await fetch("http://127.0.0.1:8090/api/collections/_superusers/auth-with-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identity: "e2e-admin@jornal.test", password: "StrongPass123!" }) })
const admin = await authResponse.json() as { token: string }
const settingsResponse = await fetch("http://127.0.0.1:8090/api/settings", { method: "PATCH", headers: { Authorization: admin.token, "Content-Type": "application/json" }, body: JSON.stringify({ smtp: { enabled: true, host: "127.0.0.1", port: smtp.port, username: "", password: "", authMethod: "PLAIN", tls: false, localName: "localhost" }, meta: { appName: "Jornal", appURL: "http://127.0.0.1:4173", senderName: "Jornal", senderAddress: "noreply@jornal.test", hideControls: false } }) })
if (!settingsResponse.ok) throw new Error(`Failed to configure E2E SMTP: ${await settingsResponse.text()}`)
let closing = false
const close = async () => {
  if (closing) return; closing = true; child.kill(); smtp.stop(true); await child.exited.catch(() => undefined)
  await rm(dataDirectory, { recursive: true, force: true }); process.exit(0)
}
process.on("SIGINT", () => void close())
process.on("SIGTERM", () => void close())
await child.exited
smtp.stop(true)
await rm(dataDirectory, { recursive: true, force: true })

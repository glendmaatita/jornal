// Runtime-owned delivery credentials are applied after PocketBase loads its
// persisted settings. Secrets stay in the deployment environment and never
// enter a migration or repository.
onBootstrap((event) => {
  event.next()
  const host = $os.getenv("SMTP_HOST") || ""
  const username = $os.getenv("SMTP_USERNAME") || ""
  const password = $os.getenv("SMTP_PASSWORD") || ""
  if (!host || !username || !password) return
  const port = Number($os.getenv("SMTP_PORT") || 587)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT tidak valid")
  const settings = event.app.settings()
  settings.smtp.enabled = true
  settings.smtp.host = host
  settings.smtp.port = port
  settings.smtp.username = username
  settings.smtp.password = password
  settings.smtp.authMethod = $os.getenv("SMTP_AUTH_METHOD") || "PLAIN"
  settings.smtp.tls = $os.getenv("SMTP_TLS") === "true"
  settings.smtp.localName = $os.getenv("SMTP_LOCAL_NAME") || ""
  settings.meta.senderAddress = $os.getenv("SMTP_FROM_ADDRESS") || username
  settings.meta.senderName = $os.getenv("SMTP_FROM_NAME") || "Jornal"
  event.app.save(settings)
})

// Apply Google OAuth credentials to existing installations.
// Migration 0002 only ran once, so deployments that initially started without
// GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET need this follow-up migration.
migrate(
  (app) => {
    const clientId = $os.getenv("GOOGLE_CLIENT_ID") ?? ""
    const clientSecret = $os.getenv("GOOGLE_CLIENT_SECRET") ?? ""
    if (!clientId || !clientSecret) return

    const users = app.findCollectionByNameOrId("users")
    users.oauth2.enabled = true
    users.oauth2.providers = [
      {
        name: "google",
        clientId,
        clientSecret,
      },
    ]
    app.save(users)
  },
  () => {
    // Keep the provider intact on rollback; removing it would break existing
    // users and cannot restore credentials that were supplied by the runtime.
  },
)

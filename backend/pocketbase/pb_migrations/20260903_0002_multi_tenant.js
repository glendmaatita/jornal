// Multi-tenant: Google-only auth + per-tenant data isolation.
//
// - `users` auth collection: only the Google OAuth2 provider is enabled.
//   Client id/secret are read from the GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
//   env vars at migration time (set on the container; if absent the provider
//   is left unconfigured and the migration still succeeds).
// - `jornal_records`: all API rules require an authenticated user and scope
//   every row to business_id = user id. Sign-up happens through the OAuth2
//   flow (createRule stays open for that), everything else is tenant-scoped.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")

    users.listRule = "id = @request.auth.id"
    users.viewRule = "id = @request.auth.id"
    users.updateRule = "id = @request.auth.id"
    users.deleteRule = null
    // OAuth2 sign-up creates the user record through this rule.
    users.createRule = ""

    const googleClientId = $os.getenv("GOOGLE_CLIENT_ID") ?? ""
    const googleClientSecret = $os.getenv("GOOGLE_CLIENT_SECRET") ?? ""
    if (googleClientId && googleClientSecret) {
      users.oauth2.enabled = true
      users.oauth2.providers = [
        {
          name: "google",
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
      ]
    }

    app.save(users)

    const records = app.findCollectionByNameOrId("jornal_records")
    const tenantRule = "business_id = @request.auth.id"
    records.listRule = tenantRule
    records.viewRule = tenantRule
    records.createRule = tenantRule
    records.updateRule = tenantRule
    records.deleteRule = tenantRule
    app.save(records)
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    users.listRule = null
    users.viewRule = null
    users.updateRule = null
    users.deleteRule = null
    users.createRule = null
    users.oauth2.enabled = false
    users.oauth2.providers = []
    app.save(users)

    const records = app.findCollectionByNameOrId("jornal_records")
    records.listRule = ""
    records.viewRule = ""
    records.createRule = ""
    records.updateRule = ""
    records.deleteRule = ""
    app.save(records)
  },
)

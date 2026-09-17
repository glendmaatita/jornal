// Team invitation and shared-company access. This migration is intentionally
// additive and its down migration is a no-op: removing memberships after a
// company has been shared would make valid accounting data inaccessible.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const companies = app.findCollectionByNameOrId("companies")
  // Jornal authenticates regular users through Google. Disabling the generic
  // password flow makes the server-side Google identity proof authoritative
  // for accepting invitations (superuser authentication is unaffected).
  users.passwordAuth.enabled = false
  app.save(users)

  const create = (name, indexes) => {
    let collection
    try { collection = app.findCollectionByNameOrId(name) } catch {
      collection = new Collection({
        type: "base", name,
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        indexes: [],
      })
    }
    for (const index of indexes || []) {
      const marker = String(index).match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/i)?.[1] || String(index)
      if (!collection.indexes.some((candidate) => String(candidate).includes(marker))) collection.indexes.push(index)
    }
    return collection
  }
  const field = (collection, name, factory) => { if (!collection.fields.getByName(name)) collection.fields.add(factory()) }
  const text = (collection, name, required, max) => field(collection, name, () => new TextField({ name, required: !!required, max: max || 255 }))
  const integer = (collection, name, required, min, max) => field(collection, name, () => new NumberField({ name, required: !!required, min: min ?? 0, max: max ?? 1_000_000_000, onlyInt: true }))
  const json = (collection, name, required, maxSize) => field(collection, name, () => new JSONField({ name, required: !!required, maxSize: maxSize || 262_144 }))
  const select = (collection, name, values) => field(collection, name, () => new SelectField({ name, required: true, maxSelect: 1, values }))
  const relation = (collection, name, target, required) => field(collection, name, () => new RelationField({ name, collectionId: target.id, required: !!required, maxSelect: 1, cascadeDelete: false }))
  const timestamps = (collection) => {
    field(collection, "created", () => new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
    field(collection, "updated", () => new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
  }

  const memberships = create("company_memberships", [
    "CREATE UNIQUE INDEX idx_company_membership_identity ON company_memberships (company_id, user_id)",
    "CREATE INDEX idx_company_membership_user_status ON company_memberships (user_id, status, company_id)",
    "CREATE INDEX idx_company_membership_company_status ON company_memberships (company_id, status, created, id)",
  ])
  relation(memberships, "company_id", companies, true); relation(memberships, "user_id", users, true)
  select(memberships, "status", ["ACTIVE", "REVOKED"]); text(memberships, "joined_at", true, 40)
  relation(memberships, "invited_by", users, false); text(memberships, "source_invitation_id", false, 100)
  text(memberships, "revoked_at", false, 40); relation(memberships, "revoked_by", users, false)
  integer(memberships, "revision", true, 1); timestamps(memberships); app.save(memberships)

  const invitations = create("company_invitations", [
    "CREATE UNIQUE INDEX idx_company_invitation_public ON company_invitations (public_id)",
    "CREATE UNIQUE INDEX idx_company_invitation_pending ON company_invitations (company_id, email_normalized) WHERE status = 'PENDING'",
    "CREATE INDEX idx_company_invitation_email ON company_invitations (email_normalized, status, expires_at, id)",
    "CREATE INDEX idx_company_invitation_company ON company_invitations (company_id, status, created, id)",
  ])
  relation(invitations, "company_id", companies, true); text(invitations, "email_normalized", true, 320)
  text(invitations, "public_id", true, 100); select(invitations, "status", ["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"])
  relation(invitations, "invited_by", users, true); relation(invitations, "accepted_by", users, false)
  text(invitations, "accepted_at", false, 40); text(invitations, "expires_at", true, 40)
  text(invitations, "revoked_at", false, 40); relation(invitations, "revoked_by", users, false)
  integer(invitations, "send_generation", true, 1, 1_000_000); text(invitations, "last_requested_at", true, 40)
  integer(invitations, "revision", true, 1); timestamps(invitations); app.save(invitations)

  const deliveries = create("team_invitation_deliveries", [
    "CREATE UNIQUE INDEX idx_team_delivery_generation ON team_invitation_deliveries (invitation_id, generation)",
    "CREATE INDEX idx_team_delivery_queue ON team_invitation_deliveries (status, next_attempt_at, id)",
  ])
  relation(deliveries, "invitation_id", invitations, true); relation(deliveries, "company_id", companies, true); integer(deliveries, "generation", true, 1, 1_000_000)
  relation(deliveries, "requested_by", users, true); text(deliveries, "recipient_email", true, 320)
  select(deliveries, "status", ["QUEUED", "LEASED", "SENT", "RETRYABLE_FAILED", "PERMANENTLY_FAILED", "CANCELLED"])
  integer(deliveries, "attempt_count", false, 0, 20); text(deliveries, "next_attempt_at", true, 40)
  text(deliveries, "lease_until", false, 40); text(deliveries, "lease_id", false, 100)
  text(deliveries, "message_id", false, 255); text(deliveries, "sent_at", false, 40); text(deliveries, "last_error_code", false, 100)
  timestamps(deliveries); app.save(deliveries)

  const commands = create("team_commands", [
    "CREATE UNIQUE INDEX idx_team_command_actor_company ON team_commands (actor_user_id, company_id, command_key)",
  ])
  relation(commands, "actor_user_id", users, true); relation(commands, "company_id", companies, true)
  text(commands, "command_key", true, 100); text(commands, "action", true, 80); text(commands, "request_hash", true, 64)
  integer(commands, "response_status", true, 200, 599); json(commands, "response_body", true, 1_000_000); timestamps(commands); app.save(commands)

  const identities = create("user_google_identities", [
    "CREATE UNIQUE INDEX idx_google_identity_user ON user_google_identities (user_id)",
    "CREATE UNIQUE INDEX idx_google_identity_subject ON user_google_identities (provider_subject)",
    "CREATE INDEX idx_google_identity_email ON user_google_identities (email_normalized)",
  ])
  relation(identities, "user_id", users, true); text(identities, "provider_subject", true, 255)
  text(identities, "email_normalized", true, 320); field(identities, "email_verified", () => new BoolField({ name: "email_verified" }))
  text(identities, "verified_at", true, 40); timestamps(identities); app.save(identities)

  const fileGrants = create("company_file_grants", [
    "CREATE UNIQUE INDEX idx_company_file_grant_token ON company_file_grants (token_hash)",
    "CREATE INDEX idx_company_file_grant_expiry ON company_file_grants (expires_at, id)",
  ])
  text(fileGrants, "token_hash", true, 64); relation(fileGrants, "user_id", users, true)
  relation(fileGrants, "company_id", companies, true); text(fileGrants, "expires_at", true, 40)
  timestamps(fileGrants); app.save(fileGrants)

  const audit = app.findCollectionByNameOrId("company_audit")
  relation(audit, "target_user_id", users, false); text(audit, "target_email", false, 320); text(audit, "target_invitation_id", false, 100)
  app.save(audit)

  const taxCommands = app.findCollectionByNameOrId("tax_commands")
  relation(taxCommands, "actor_user_id", users, false)
  taxCommands.indexes = taxCommands.indexes.filter((index) => !String(index).includes("idx_tax_command_key"))
  if (!taxCommands.indexes.some((index) => String(index).includes("idx_tax_command_actor_key"))) taxCommands.indexes.push("CREATE UNIQUE INDEX idx_tax_command_actor_key ON tax_commands (actor_user_id, tenant_id, command_key)")
  app.save(taxCommands)
  for (const row of app.findAllRecords(taxCommands)) if (!row.getString("actor_user_id")) { row.set("actor_user_id", row.getString("tenant_id")); app.save(row) }
  for (const definition of [["invoice_commands", "idx_invoice_command_scope", "idx_invoice_command_actor_scope"], ["document_commands", "idx_document_command_scope", "idx_document_command_actor_scope"]]) {
    const collection = app.findCollectionByNameOrId(definition[0])
    relation(collection, "actor_user_id", users, false)
    collection.indexes = collection.indexes.filter((index) => !String(index).includes(definition[1]))
    if (!collection.indexes.some((index) => String(index).includes(definition[2]))) collection.indexes.push(`CREATE UNIQUE INDEX ${definition[2]} ON ${definition[0]} (actor_user_id, tenant_id, company_id, data_epoch, command_key)`)
    app.save(collection)
    for (const row of app.findAllRecords(collection)) if (!row.getString("actor_user_id")) { row.set("actor_user_id", row.getString("tenant_id")); app.save(row) }
  }
  const assetCommands = app.findCollectionByNameOrId("company_asset_commands")
  relation(assetCommands, "actor_user_id", users, false)
  assetCommands.indexes = assetCommands.indexes.filter((index) => !String(index).includes("idx_company_asset_command_request"))
  if (!assetCommands.indexes.some((index) => String(index).includes("idx_company_asset_command_actor_request"))) assetCommands.indexes.push("CREATE UNIQUE INDEX idx_company_asset_command_actor_request ON company_asset_commands (actor_user_id, tenant_id, company_id, request_id)")
  app.save(assetCommands)
  for (const row of app.findAllRecords(assetCommands)) if (!row.getString("actor_user_id")) { row.set("actor_user_id", row.getString("tenant_id")); app.save(row) }

  // Notifications belong to the recipient actor, while tenant_id continues to
  // point at the resource namespace for backward-compatible workers.
  for (const name of ["push_subscriptions", "notification_deliveries", "tax_notification_preferences", "tax_notifications"]) {
    let collection
    try { collection = app.findCollectionByNameOrId(name) } catch { continue }
    relation(collection, "recipient_user_id", users, false)
    app.save(collection)
    const rows = app.findAllRecords(collection)
    for (const row of rows) {
      if (!row.getString("recipient_user_id") && row.getString("tenant_id")) { row.set("recipient_user_id", row.getString("tenant_id")); app.save(row) }
    }
  }
  const notificationDeliveries = app.findCollectionByNameOrId("notification_deliveries")
  text(notificationDeliveries, "lease_id", false, 100)
  app.save(notificationDeliveries)
  const taxPreferences = app.findCollectionByNameOrId("tax_notification_preferences")
  taxPreferences.indexes = taxPreferences.indexes.filter((index) => !String(index).includes("idx_tax_notification_pref"))
  if (!taxPreferences.indexes.some((index) => String(index).includes("idx_tax_notification_pref_recipient"))) taxPreferences.indexes.push("CREATE UNIQUE INDEX idx_tax_notification_pref_recipient ON tax_notification_preferences (tenant_id, recipient_user_id, subject_key)")
  app.save(taxPreferences)
  const taxNotifications = app.findCollectionByNameOrId("tax_notifications")
  taxNotifications.indexes = taxNotifications.indexes.filter((index) => !String(index).includes("idx_tax_notification_dedupe"))
  if (!taxNotifications.indexes.some((index) => String(index).includes("idx_tax_notification_recipient_dedupe"))) taxNotifications.indexes.push("CREATE UNIQUE INDEX idx_tax_notification_recipient_dedupe ON tax_notifications (recipient_user_id, dedupe_key)")
  app.save(taxNotifications)

  // Backfill exactly one active owner membership per existing company.
  let companyCursor = ""
  while (true) {
    const params = {}; if (companyCursor) params.cursor = companyCursor
    const page = app.findRecordsByFilter(companies, companyCursor ? "id > {:cursor}" : "", "id", 500, 0, params)
    for (const company of page) {
      let membership
      try { membership = app.findFirstRecordByFilter(memberships, "company_id = {:company} && user_id = {:user}", { company: company.id, user: company.getString("tenant_id") }) } catch { membership = null }
      if (!membership) {
        app.save(new Record(memberships, {
          company_id: company.id, user_id: company.getString("tenant_id"), status: "ACTIVE",
          joined_at: company.getString("created") || new Date().toISOString(), revision: 1,
        }))
      }
    }
    if (page.length < 500) break
    companyCursor = page[page.length - 1].id
  }

  // Company discovery and membership mutation only go through application
  // endpoints. Ledger native requests are additionally checked by request
  // hooks against the X-Jornal-Company header.
  companies.listRule = null; companies.viewRule = null; companies.createRule = null; companies.updateRule = null; companies.deleteRule = null
  app.save(companies)
  const records = app.findCollectionByNameOrId("jornal_records")
  records.listRule = '@request.auth.id != "" && company_id = @request.headers.x_jornal_company'
  records.viewRule = '@request.auth.id != ""'
  records.createRule = '@request.auth.id != "" && company_id = @request.headers.x_jornal_company'
  records.updateRule = '@request.auth.id != "" && company_id = @request.headers.x_jornal_company'
  records.deleteRule = '@request.auth.id != "" && company_id = @request.headers.x_jornal_company'
  app.save(records)
}, () => {
  // Non-destructive rollback contract: shared access and its audit trail remain.
})

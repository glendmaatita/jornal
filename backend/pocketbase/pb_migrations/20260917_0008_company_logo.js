// Company identity assets are deliberately independent from the accounting
// epoch: a bookkeeping reset must never discard a company's active logo or an
// invoice snapshot's historical logo.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    const companies = app.findCollectionByNameOrId("companies")
    const ensureField = (collection, name, create) => {
      if (!collection.fields.getByName(name)) collection.fields.add(create())
    }
    const ensureIndex = (collection, index) => {
      const name = String(index).match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/i)?.[1] || index
      if (!collection.indexes.some((existing) => String(existing).includes(name))) collection.indexes.push(index)
    }
    let assets
    try { assets = app.findCollectionByNameOrId("company_assets") } catch {
      assets = new Collection({
        type: "base", name: "company_assets",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        indexes: [],
      })
    }
    ensureField(assets, "tenant_id", () => new RelationField({ name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
    ensureField(assets, "company_id", () => new RelationField({ name: "company_id", collectionId: companies.id, required: true, maxSelect: 1, cascadeDelete: false }))
    ensureField(assets, "kind", () => new SelectField({ name: "kind", required: true, maxSelect: 1, values: ["COMPANY_LOGO"] }))
    ensureField(assets, "file", () => new FileField({ name: "file", required: true, maxSelect: 1, maxSize: 2_097_152, mimeTypes: ["image/png", "image/jpeg", "image/webp"] }))
    ensureField(assets, "mime", () => new TextField({ name: "mime", required: true, max: 100 }))
    ensureField(assets, "byte_size", () => new NumberField({ name: "byte_size", required: true, min: 1, onlyInt: true }))
    ensureField(assets, "width", () => new NumberField({ name: "width", required: true, min: 1, max: 4096, onlyInt: true }))
    ensureField(assets, "height", () => new NumberField({ name: "height", required: true, min: 1, max: 4096, onlyInt: true }))
    ensureField(assets, "checksum", () => new TextField({ name: "checksum", required: true, min: 64, max: 64 }))
    ensureField(assets, "content_base64", () => new JSONField({ name: "content_base64", required: true, maxSize: 3_000_000 }))
    ensureField(assets, "created", () => new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
    ensureField(assets, "updated", () => new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
    ensureIndex(assets, "CREATE INDEX idx_company_assets_scope ON company_assets (tenant_id, company_id, kind, created)")
    ensureIndex(assets, "CREATE INDEX idx_company_assets_checksum ON company_assets (tenant_id, company_id, checksum)")
    app.save(assets)

    ensureField(companies, "logo_asset_id", () => new RelationField({ name: "logo_asset_id", collectionId: assets.id, required: false, maxSelect: 1, cascadeDelete: false }))
    app.save(companies)

    let commands
    try { commands = app.findCollectionByNameOrId("company_asset_commands") } catch {
      commands = new Collection({
        type: "base", name: "company_asset_commands",
        listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
        indexes: [],
      })
    }
    ensureField(commands, "tenant_id", () => new RelationField({ name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
    ensureField(commands, "company_id", () => new RelationField({ name: "company_id", collectionId: companies.id, required: true, maxSelect: 1, cascadeDelete: false }))
    ensureField(commands, "request_id", () => new TextField({ name: "request_id", required: true, min: 1, max: 100 }))
    ensureField(commands, "action", () => new SelectField({ name: "action", required: true, maxSelect: 1, values: ["PUT_LOGO", "DELETE_LOGO"] }))
    ensureField(commands, "request_hash", () => new TextField({ name: "request_hash", required: true, min: 64, max: 64 }))
    ensureField(commands, "response", () => new JSONField({ name: "response", required: true, maxSize: 100_000 }))
    ensureField(commands, "created", () => new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
    ensureIndex(commands, "CREATE UNIQUE INDEX idx_company_asset_command_request ON company_asset_commands (tenant_id, company_id, request_id)")
    app.save(commands)
  },
  () => {
    // Keep assets and pointers on rollback: invoice snapshots may already
    // reference them, so destructive schema rollback would corrupt history.
  },
)

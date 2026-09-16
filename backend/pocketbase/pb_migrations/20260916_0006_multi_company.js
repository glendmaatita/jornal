// Multi-company foundation. business_id remains the authenticated tenant id
// for compatibility; company_id is the accounting partition.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    let companies
    try {
      companies = app.findCollectionByNameOrId("companies")
    } catch {
      companies = new Collection({
        type: "base",
        name: "companies",
        createRule: null,
        deleteRule: null,
        indexes: [
          "CREATE UNIQUE INDEX idx_companies_tenant_creation ON companies (tenant_id, creation_key)",
          "CREATE INDEX idx_companies_tenant_status_created ON companies (tenant_id, status, created)",
          "CREATE UNIQUE INDEX idx_companies_legacy_default ON companies (tenant_id) WHERE legacy_default = TRUE",
          "CREATE UNIQUE INDEX idx_companies_initial_setup ON companies (tenant_id) WHERE initial_setup_guard = TRUE",
          "CREATE UNIQUE INDEX idx_companies_initial_setup_key ON companies (initial_setup_key) WHERE initial_setup_key != ''",
        ],
      })
      companies.fields.add(new RelationField({ name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
      companies.fields.add(new TextField({ name: "name", required: true, min: 1, max: 100 }))
      companies.fields.add(new SelectField({ name: "status", required: true, maxSelect: 1, values: ["ACTIVE", "ARCHIVED"] }))
      companies.fields.add(new DateField({ name: "onboarding_completed_at", required: false }))
      companies.fields.add(new TextField({ name: "creation_key", required: true, min: 1, max: 100 }))
      companies.fields.add(new BoolField({ name: "legacy_default" }))
      companies.fields.add(new BoolField({ name: "initial_setup_guard" }))
      companies.fields.add(new TextField({ name: "initial_setup_key", required: false, max: 30 }))
      companies.fields.add(new NumberField({ name: "data_epoch", required: true, min: 1 }))
      companies.fields.add(new NumberField({ name: "revision", required: true, min: 1 }))
      companies.fields.add(new DateField({ name: "archived_at", required: false }))
      companies.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
      companies.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
      companies.listRule = "tenant_id = @request.auth.id"
      companies.viewRule = "tenant_id = @request.auth.id"
      // Lifecycle changes go through the validated application endpoint.
      companies.updateRule = null
      app.save(companies)
    }

    const records = app.findCollectionByNameOrId("jornal_records")
    if (!records.fields.getByName("company_id")) records.fields.add(new RelationField({
      name: "company_id",
      collectionId: companies.id,
      required: false, // made mandatory after legacy/orphan audit
      maxSelect: 1,
      cascadeDelete: false,
    }))
    if (!records.fields.getByName("data_epoch")) records.fields.add(new NumberField({
      name: "data_epoch",
      required: false,
      min: 0,
    }))
    records.indexes = records.indexes.filter((index) => !index.includes("idx_jornal_records_business_entity_app"))
    if (!records.indexes.some((index) => index.includes("idx_jornal_records_company_entity_app"))) {
      records.indexes.push("CREATE UNIQUE INDEX idx_jornal_records_company_entity_app ON jornal_records (business_id, company_id, entity, app_id)")
    }
    // Normal collection rules remain an ownership backstop. Request hooks
    // validate company ownership/status and protocol scope.
    const tenantRule = "business_id = @request.auth.id && company_id.tenant_id = @request.auth.id"
    const scopedRule = `${tenantRule} && company_id = @request.headers.x_jornal_company`
    // Native API calls must carry an explicit company header. An old PWA
    // without that header receives no list rows and cannot mutate records.
    records.listRule = scopedRule
    records.viewRule = tenantRule // file-token downloads use this rule
    records.createRule = scopedRule
    records.updateRule = scopedRule
    records.deleteRule = scopedRule
    app.save(records)

    try { app.findCollectionByNameOrId("company_audit") } catch {
      const audit = new Collection({
        type: "base",
        name: "company_audit",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        indexes: ["CREATE INDEX idx_company_audit_tenant_company_created ON company_audit (tenant_id, company_id, created)"],
      })
      audit.fields.add(new RelationField({ name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
      audit.fields.add(new RelationField({ name: "company_id", collectionId: companies.id, required: true, maxSelect: 1, cascadeDelete: true }))
      audit.fields.add(new RelationField({ name: "actor_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
      audit.fields.add(new TextField({ name: "action", required: true, max: 40 }))
      audit.fields.add(new TextField({ name: "request_id", required: false, max: 100 }))
      audit.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
      app.save(audit)
    }

    // Map every populated legacy tenant to one stable default company.
    const allRecords = app.findAllRecords(records)
    const byTenant = {}
    for (const record of allRecords) {
      const tenantId = record.getString("business_id")
      if (!tenantId) continue
      if (!byTenant[tenantId]) byTenant[tenantId] = []
      byTenant[tenantId].push(record)
    }
    for (const tenantId of Object.keys(byTenant)) {
      let user
      try { user = app.findRecordById(users, tenantId) } catch { throw new Error(`Orphan jornal_records tenant: ${tenantId}`) }
      if (!user) throw new Error(`Orphan jornal_records tenant: ${tenantId}`)
      let companyName = "Bisnis Saya"
      let onboardingCompletedAt = ""
      for (const record of byTenant[tenantId]) {
        if (record.getString("entity") !== "profile") continue
        let payload = record.get("payload") || {}
        try { payload = JSON.parse(record.getString("payload")) } catch { /* JSONMap fallback */ }
        const value = (key) => typeof payload.get === "function" ? payload.get(key) : payload[key]
        if (value("businessName")) companyName = String(value("businessName")).slice(0, 100)
        if (value("onboardingCompletedAt")) onboardingCompletedAt = String(value("onboardingCompletedAt"))
      }
      const company = new Record(companies, {
        tenant_id: tenantId,
        name: companyName,
        status: "ACTIVE",
        onboarding_completed_at: onboardingCompletedAt,
        creation_key: `legacy-${tenantId}`,
        legacy_default: true,
        initial_setup_guard: true,
        initial_setup_key: tenantId,
        data_epoch: 1,
        revision: 1,
      })
      app.save(company)
      for (const record of byTenant[tenantId]) {
        record.set("company_id", company.id)
        record.set("data_epoch", 1)
        app.save(record)
      }
    }
    records.fields.getByName("company_id").required = true
    records.fields.getByName("data_epoch").required = true
    records.fields.getByName("data_epoch").min = 1
    app.save(records)
  },
  () => {
    // Non-destructive rollback: once a second company exists, removing scope
    // fields or indexes would merge otherwise isolated ledgers.
  },
)

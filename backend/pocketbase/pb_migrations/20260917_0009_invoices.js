// Invoice records are domain-owned. Raw collection APIs stay closed; hooks
// enforce scope, state transitions, idempotency, and ledger linkage.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    const companies = app.findCollectionByNameOrId("companies")
    const create = (name, indexes) => {
      let collection
      try { collection = app.findCollectionByNameOrId(name) } catch {
        collection = new Collection({ type: "base", name, listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, indexes: [] })
      }
      for (const index of indexes || []) {
        const indexName = String(index).match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/i)?.[1] || index
        if (!collection.indexes.some((existing) => String(existing).includes(indexName))) collection.indexes.push(index)
      }
      return collection
    }
    const field = (collection, name, factory) => { if (!collection.fields.getByName(name)) collection.fields.add(factory()) }
    const tenant = (collection) => field(collection, "tenant_id", () => new RelationField({ name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true }))
    const company = (collection) => field(collection, "company_id", () => new RelationField({ name: "company_id", collectionId: companies.id, required: true, maxSelect: 1, cascadeDelete: false }))
    const epoch = (collection) => field(collection, "data_epoch", () => new NumberField({ name: "data_epoch", required: true, min: 1, onlyInt: true }))
    const text = (collection, name, required, max) => field(collection, name, () => new TextField({ name, required: !!required, max: max || 255 }))
    const integer = (collection, name, required, min, max) => field(collection, name, () => new NumberField({ name, required: !!required, min, max, onlyInt: true }))
    const json = (collection, name, required, maxSize) => field(collection, name, () => new JSONField({ name, required: !!required, maxSize: maxSize || 262_144 }))
    const select = (collection, name, values, required) => field(collection, name, () => new SelectField({ name, values, required: required !== false, maxSelect: 1 }))
    const relation = (collection, name, target, required) => field(collection, name, () => new RelationField({ name, collectionId: target.id, required: !!required, maxSelect: 1, cascadeDelete: false }))
    const timestamps = (collection) => {
      field(collection, "created", () => new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
      field(collection, "updated", () => new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
    }

    const customers = create("invoice_customers", [
      "CREATE UNIQUE INDEX idx_invoice_customer_email ON invoice_customers (tenant_id, company_id, data_epoch, normalized_email) WHERE normalized_email != ''",
      "CREATE INDEX idx_invoice_customer_search ON invoice_customers (tenant_id, company_id, data_epoch, status, name)",
    ])
    tenant(customers); company(customers); epoch(customers)
    text(customers, "name", true, 255); text(customers, "email", false, 255); text(customers, "normalized_email", false, 255)
    text(customers, "phone", false, 50); text(customers, "normalized_phone", false, 50)
    for (const name of ["address_line1", "address_line2", "district", "city", "province"]) text(customers, name, false, 255)
    text(customers, "postal_code", false, 30); select(customers, "status", ["ACTIVE", "ARCHIVED"]); integer(customers, "revision", true, 1)
    timestamps(customers); app.save(customers)

    const units = create("invoice_units", [
      "CREATE UNIQUE INDEX idx_invoice_unit_active_label ON invoice_units (tenant_id, company_id, data_epoch, normalized_label) WHERE status = 'ACTIVE'",
      "CREATE INDEX idx_invoice_unit_list ON invoice_units (tenant_id, company_id, data_epoch, status, sort_order)",
    ])
    tenant(units); company(units); epoch(units); text(units, "label", true, 20); text(units, "normalized_label", true, 20)
    select(units, "status", ["ACTIVE", "ARCHIVED"]); integer(units, "sort_order", false, 0); integer(units, "revision", true, 1); timestamps(units); app.save(units)

    const settings = create("invoice_settings", ["CREATE UNIQUE INDEX idx_invoice_settings_scope ON invoice_settings (tenant_id, company_id, data_epoch)"])
    tenant(settings); company(settings); epoch(settings); text(settings, "sender_name", true, 255); text(settings, "sender_phone", false, 50); text(settings, "sender_email", false, 255)
    relation(settings, "default_unit_id", units, false); integer(settings, "default_due_days", false, 0, 365); text(settings, "numbering_prefix", false, 20); integer(settings, "numbering_padding", true, 3, 12); integer(settings, "numbering_start", true, 1, 999_999_999)
    json(settings, "payment_instructions", false, 20_000); text(settings, "default_account_id", false, 100); field(settings, "reminder_enabled", () => new BoolField({ name: "reminder_enabled" }))
    text(settings, "reminder_timezone", true, 60); integer(settings, "reminder_hour", true, 0, 23); integer(settings, "reminder_repeat_days", true, 1, 365); integer(settings, "schedule_version", true, 1); integer(settings, "revision", true, 1); timestamps(settings); app.save(settings)

    const sequences = create("invoice_sequences", ["CREATE UNIQUE INDEX idx_invoice_sequence_scope ON invoice_sequences (tenant_id, company_id)"])
    tenant(sequences); company(sequences); integer(sequences, "next_value", true, 1); timestamps(sequences); app.save(sequences)

    const invoices = create("invoices", [
      "CREATE UNIQUE INDEX idx_invoice_number_scope ON invoices (tenant_id, company_id, invoice_number) WHERE invoice_number != ''",
      "CREATE INDEX idx_invoice_agenda ON invoices (tenant_id, company_id, data_epoch, status, due_date)",
      "CREATE INDEX idx_invoice_customer_history ON invoices (tenant_id, company_id, data_epoch, customer_id, issue_date)",
    ])
    tenant(invoices); company(invoices); epoch(invoices); relation(invoices, "customer_id", customers, true); select(invoices, "status", ["DRAFT", "UNPAID", "PAID", "VOID"])
    integer(invoices, "sequence", false, 1); text(invoices, "invoice_number", false, 80); text(invoices, "issue_date", true, 10); text(invoices, "due_date", true, 10); text(invoices, "timezone", true, 60)
    json(invoices, "customer_snapshot", false); json(invoices, "sender_snapshot", false); json(invoices, "payment_instructions_snapshot", false); json(invoices, "items", true)
    text(invoices, "shipping_method", false, 255); integer(invoices, "subtotal", false, 0, 1_000_000_000_000); integer(invoices, "discount_amount", false, 0, 1_000_000_000_000)
    integer(invoices, "shipping_amount", false, 0, 1_000_000_000_000); integer(invoices, "tax_rate_bps", false, 0, 10_000); integer(invoices, "tax_amount", false, 0, 1_000_000_000_000); integer(invoices, "grand_total", true, 1, 1_000_000_000_000)
    text(invoices, "currency", true, 3); text(invoices, "template_version", true, 40); text(invoices, "content_hash", false, 64); text(invoices, "issued_at", false, 40); text(invoices, "paid_at", false, 40)
    integer(invoices, "payment_cycle", true, 1); text(invoices, "void_reason", false, 500); integer(invoices, "revision", true, 1); text(invoices, "deleted_at", false, 40); timestamps(invoices); app.save(invoices)
    // A new collection does not receive its ID until its first save, so the
    // self-reference has to be attached afterwards on a fresh installation.
    relation(invoices, "replaced_invoice_id", invoices, false); app.save(invoices)

    const payments = create("invoice_payments", [
      "CREATE UNIQUE INDEX idx_invoice_active_payment ON invoice_payments (company_id, data_epoch, invoice_id) WHERE status = 'ACTIVE'",
      "CREATE UNIQUE INDEX idx_invoice_active_ledger ON invoice_payments (company_id, data_epoch, ledger_transaction_id) WHERE status = 'ACTIVE' AND ledger_transaction_id != ''",
    ])
    tenant(payments); company(payments); epoch(payments); relation(payments, "invoice_id", invoices, true); integer(payments, "amount", true, 1, 1_000_000_000_000); text(payments, "paid_on", true, 10); text(payments, "account_id", false, 100)
    text(payments, "ledger_transaction_id", false, 100); select(payments, "origin", ["CREATED", "LINKED"]); json(payments, "original_ledger_snapshot", false); select(payments, "status", ["ACTIVE", "REVERSED"]); select(payments, "lifecycle", ["CURRENT", "ARCHIVED_EPOCH"])
    text(payments, "reference", false, 255); text(payments, "reversal_reason", false, 500); text(payments, "reversed_at", false, 40); integer(payments, "revision", true, 1); timestamps(payments); app.save(payments)

    const reminders = create("invoice_reminders", [
      "CREATE UNIQUE INDEX idx_invoice_reminder_dedupe ON invoice_reminders (dedupe_key)",
      "CREATE INDEX idx_invoice_reminder_status ON invoice_reminders (tenant_id, company_id, data_epoch, status, scheduled_local_date)",
    ])
    tenant(reminders); company(reminders); epoch(reminders); relation(reminders, "invoice_id", invoices, true); integer(reminders, "payment_cycle", true, 1); integer(reminders, "schedule_version", true, 1); text(reminders, "scheduled_local_date", true, 10); select(reminders, "status", ["UNREAD", "READ", "RESOLVED"]); text(reminders, "read_at", false, 40); text(reminders, "resolved_at", false, 40); text(reminders, "dedupe_key", true, 255); timestamps(reminders); app.save(reminders)

    const commands = create("invoice_commands", ["CREATE UNIQUE INDEX idx_invoice_command_scope ON invoice_commands (tenant_id, company_id, data_epoch, command_key)"])
    tenant(commands); company(commands); epoch(commands); text(commands, "command_key", true, 100); text(commands, "action", true, 50); text(commands, "request_hash", true, 64); integer(commands, "response_status", true, 200, 599); json(commands, "response_body", true, 1_000_000); timestamps(commands); app.save(commands)

    const audit = create("invoice_audit", ["CREATE INDEX idx_invoice_audit_scope ON invoice_audit (tenant_id, company_id, created)"])
    tenant(audit); company(audit); epoch(audit); relation(audit, "actor_id", users, true); text(audit, "action", true, 80); text(audit, "entity_type", true, 40); text(audit, "entity_id", true, 100); text(audit, "command_key", false, 100); text(audit, "reason", false, 500); json(audit, "before_snapshot", false); json(audit, "after_snapshot", false); timestamps(audit); app.save(audit)
  },
  () => {
    // Invoice/payment/ledger history must remain intact on application rollback.
  },
)

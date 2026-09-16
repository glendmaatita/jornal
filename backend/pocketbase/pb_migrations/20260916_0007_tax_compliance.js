// Tax compliance is tenant-owned and intentionally separate from company ledger
// envelopes. Public collection writes are disabled; validated command endpoints
// enforce cross-collection invariants and idempotency.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId("users")
    const companies = app.findCollectionByNameOrId("companies")
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
        const indexName = String(index).match(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)/i)?.[1] || String(index)
        if (!collection.indexes.some((existing) => String(existing).includes(indexName))) collection.indexes.push(index)
      }
      return collection
    }
    const field = (collection, name, factory) => {
      if (!collection.fields.getByName(name)) collection.fields.add(factory())
    }
    const tenant = (collection) => field(collection, "tenant_id", () => new RelationField({
      name: "tenant_id", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true,
    }))
    const text = (collection, name, required, max) => field(collection, name, () => new TextField({ name, required: !!required, max: max || 200 }))
    const select = (collection, name, values, required) => field(collection, name, () => new SelectField({ name, values, required: required !== false, maxSelect: 1 }))
    const number = (collection, name, required, min, max) => field(collection, name, () => new NumberField({ name, required: !!required, min, max, onlyInt: true }))
    const date = (collection, name, required) => field(collection, name, () => new DateField({ name, required: !!required }))
    const json = (collection, name, required) => field(collection, name, () => new JSONField({ name, required: !!required, maxSize: 1_000_000 }))
    const bool = (collection, name) => field(collection, name, () => new BoolField({ name }))
    const timestamps = (collection) => {
      field(collection, "created", () => new AutodateField({ name: "created", onCreate: true, onUpdate: false }))
      field(collection, "updated", () => new AutodateField({ name: "updated", onCreate: true, onUpdate: true }))
    }
    const relation = (collection, name, target, required, cascadeDelete) => field(collection, name, () => new RelationField({
      name, collectionId: target.id, required: !!required, maxSelect: 1, cascadeDelete: !!cascadeDelete,
    }))

    const subjects = create("tax_subjects", [
      "CREATE INDEX idx_tax_subjects_tenant_status ON tax_subjects (tenant_id, status, created)",
    ])
    tenant(subjects); text(subjects, "label", true, 100)
    select(subjects, "subject_type", ["INDIVIDUAL", "ENTITY"])
    text(subjects, "entity_form", false, 40); text(subjects, "masked_tax_id", false, 32)
    number(subjects, "fiscal_year_start_month", true, 1, 12); number(subjects, "fiscal_year_start_day", true, 1, 31)
    text(subjects, "timezone", true, 60); select(subjects, "status", ["ACTIVE", "INACTIVE"])
    select(subjects, "umkm_eligibility", ["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"])
    date(subjects, "umkm_eligibility_effective_from", false); json(subjects, "eligibility_answers", false)
    number(subjects, "revision", true, 1); timestamps(subjects); app.save(subjects)

    const memberships = create("tax_company_memberships", [
      "CREATE UNIQUE INDEX idx_tax_membership_start ON tax_company_memberships (tenant_id, subject_id, company_id, effective_from)",
      "CREATE INDEX idx_tax_membership_company_dates ON tax_company_memberships (tenant_id, company_id, effective_from, effective_until)",
    ])
    tenant(memberships); relation(memberships, "subject_id", subjects, true, true); relation(memberships, "company_id", companies, true, false)
    date(memberships, "effective_from", true); date(memberships, "effective_until", false); number(memberships, "revision", true, 1)
    timestamps(memberships); app.save(memberships)

    const registrations = create("tax_registrations", [
      "CREATE UNIQUE INDEX idx_tax_registration_natural ON tax_registrations (tenant_id, subject_id, kind, filing_group, jurisdiction, active_from)",
      "CREATE INDEX idx_tax_registration_active ON tax_registrations (tenant_id, subject_id, active_from, active_until)",
    ])
    tenant(registrations); relation(registrations, "subject_id", subjects, true, true)
    select(registrations, "kind", ["PPH_FINAL_UMKM", "PPH_21_26_PAYROLL", "PPH_23_26", "PPH_4_2_OTHER", "PPH_15", "PPH_22", "PPH_25", "PPN_PPNBM", "PPN_SPECIAL", "SPT_ANNUAL_INDIVIDUAL", "SPT_ANNUAL_ENTITY", "PPH_29", "PBB", "LOCAL_TAX", "STAMP_DUTY", "ASSESSMENT", "OTHER"])
    text(registrations, "label", true, 120); select(registrations, "periodicity", ["MONTHLY", "ANNUAL", "EVENT"])
    text(registrations, "filing_group", true, 80); select(registrations, "amount_mode", ["AUTOMATIC_UMKM", "MANUAL_CONFIRMED", "DOCUMENT"])
    text(registrations, "jurisdiction", false, 120); date(registrations, "active_from", true); date(registrations, "active_until", false)
    number(registrations, "default_amount", false, 0); bool(registrations, "has_default_amount")
    date(registrations, "default_due_date", false); text(registrations, "rule_id", true, 100)
    number(registrations, "revision", true, 1); timestamps(registrations); app.save(registrations)

    const periodInputs = create("tax_period_inputs", [
      "CREATE UNIQUE INDEX idx_tax_period_input_source ON tax_period_inputs (tenant_id, subject_id, company_key, period)",
      "CREATE INDEX idx_tax_period_input_subject_period ON tax_period_inputs (tenant_id, subject_id, period)",
    ])
    tenant(periodInputs); relation(periodInputs, "subject_id", subjects, true, true); relation(periodInputs, "company_id", companies, false, false)
    text(periodInputs, "company_key", true, 30); text(periodInputs, "period", true, 7)
    number(periodInputs, "taxable_revenue", false, 0); number(periodInputs, "external_revenue", false, 0); number(periodInputs, "opening_ytd_revenue", false, 0); number(periodInputs, "adjustments", false)
    select(periodInputs, "data_status", ["COMPLETE", "INCOMPLETE", "STALE", "NEEDS_RECONCILIATION"])
    text(periodInputs, "source_revision", true, 100); number(periodInputs, "data_epoch", false, 1); text(periodInputs, "fingerprint", true, 128)
    date(periodInputs, "confirmed_at", false); timestamps(periodInputs); app.save(periodInputs)

    const obligations = create("tax_obligations", [
      "CREATE UNIQUE INDEX idx_tax_obligation_natural ON tax_obligations (tenant_id, subject_id, registration_id, period, component)",
      "CREATE INDEX idx_tax_obligation_agenda ON tax_obligations (tenant_id, effective_due_date, payment_status, filing_status)",
      "CREATE INDEX idx_tax_obligation_subject_period ON tax_obligations (tenant_id, subject_id, period)",
    ])
    tenant(obligations); relation(obligations, "subject_id", subjects, true, true); relation(obligations, "registration_id", registrations, true, true)
    text(obligations, "kind", true, 40); text(obligations, "component", true, 80); text(obligations, "period", true, 7); text(obligations, "currency", true, 3)
    select(obligations, "amount_state", ["UNKNOWN", "ESTIMATED", "CONFIRMED", "NEEDS_REVIEW"])
    number(obligations, "liability_amount", false, 0); bool(obligations, "has_liability_amount")
    number(obligations, "proposed_liability_amount", false, 0); bool(obligations, "has_proposed_liability_amount")
    number(obligations, "settled_by_third_party", false, 0); number(obligations, "allocated_payments", false, 0)
    number(obligations, "remaining_payable", false, 0); bool(obligations, "has_remaining_payable")
    number(obligations, "overpaid_amount", false, 0)
    select(obligations, "payment_status", ["UNKNOWN", "NOT_DUE", "UNPAID", "PARTIAL", "PAID", "OVERPAID", "NOT_REQUIRED"])
    select(obligations, "filing_status", ["NEEDS_REVIEW", "NOT_REQUIRED", "PENDING", "FILED", "FULFILLED_BY_PAYMENT"])
    select(obligations, "data_status", ["COMPLETE", "INCOMPLETE", "STALE", "NEEDS_RECONCILIATION"])
    date(obligations, "statutory_due_date", false); date(obligations, "effective_due_date", false); date(obligations, "penalty_relief_until", false); date(obligations, "snoozed_until", false)
    text(obligations, "deadline_source", false, 240); text(obligations, "deadline_reference", false, 240)
    select(obligations, "deadline_status", ["VERIFIED", "PROVISIONAL", "USER_CONFIRMED"])
    text(obligations, "rule_id", true, 100); text(obligations, "rule_version", true, 30); text(obligations, "input_fingerprint", false, 128)
    text(obligations, "amount_source", false, 160); date(obligations, "amount_confirmed_at", false)
    number(obligations, "revision", true, 1); timestamps(obligations); app.save(obligations)

    const filings = create("tax_filings", [
      "CREATE UNIQUE INDEX idx_tax_filing_natural ON tax_filings (tenant_id, subject_id, filing_group, period, registration_key)",
      "CREATE INDEX idx_tax_filing_agenda ON tax_filings (tenant_id, effective_due_date, status)",
    ])
    tenant(filings); relation(filings, "subject_id", subjects, true, true); text(filings, "filing_group", true, 80); text(filings, "period", true, 7)
    text(filings, "registration_key", true, 30); json(filings, "obligation_ids", true)
    select(filings, "status", ["NEEDS_REVIEW", "NOT_REQUIRED", "PENDING", "FILED", "FULFILLED_BY_PAYMENT"])
    date(filings, "statutory_due_date", false); date(filings, "effective_due_date", false); date(filings, "filed_at", false)
    text(filings, "deadline_source", false, 240); select(filings, "deadline_status", ["VERIFIED", "PROVISIONAL", "USER_CONFIRMED"])
    text(filings, "reference", false, 160); text(filings, "fulfilled_by_settlement_id", false, 30); number(filings, "revision", true, 1)
    number(filings, "amendment_number", false, 0); text(filings, "amendment_reason", false, 500)
    timestamps(filings); app.save(filings)

    const settlements = create("tax_settlements", [
      "CREATE UNIQUE INDEX idx_tax_settlement_ledger ON tax_settlements (tenant_id, ledger_company_id, ledger_transaction_id) WHERE ledger_transaction_id != ''",
      "CREATE INDEX idx_tax_settlement_subject_date ON tax_settlements (tenant_id, subject_id, settlement_date)",
    ])
    tenant(settlements); relation(settlements, "subject_id", subjects, true, true)
    select(settlements, "settlement_type", ["SELF_PAYMENT", "THIRD_PARTY_WITHHOLDING", "COMPENSATION", "TAX_DEPOSIT_USE", "OUTSIDE_LEDGER"])
    number(settlements, "amount", true, 0); date(settlements, "settlement_date", true)
    relation(settlements, "ledger_company_id", companies, false, false); text(settlements, "ledger_transaction_id", false, 80)
    text(settlements, "reference", false, 160); text(settlements, "source", true, 160); number(settlements, "revision", true, 1)
    select(settlements, "status", ["ACTIVE", "REVERSED"]); date(settlements, "reversed_at", false); text(settlements, "reversal_reason", false, 500)
    timestamps(settlements); app.save(settlements)

    const allocations = create("tax_allocations", [
      "CREATE UNIQUE INDEX idx_tax_allocation_pair ON tax_allocations (tenant_id, settlement_id, obligation_id)",
      "CREATE INDEX idx_tax_allocation_obligation ON tax_allocations (tenant_id, obligation_id)",
    ])
    tenant(allocations); relation(allocations, "settlement_id", settlements, true, true); relation(allocations, "obligation_id", obligations, true, true)
    number(allocations, "amount", true, 1); timestamps(allocations); app.save(allocations)

    const evidence = create("tax_evidence", ["CREATE INDEX idx_tax_evidence_parent ON tax_evidence (tenant_id, parent_type, parent_id, created)"])
    tenant(evidence); relation(evidence, "subject_id", subjects, true, true); text(evidence, "parent_type", true, 20); text(evidence, "parent_id", true, 30)
    field(evidence, "document", () => new FileField({ name: "document", required: true, maxSelect: 1, maxSize: 10_485_760, mimeTypes: ["application/pdf", "image/jpeg", "image/png"] }))
    text(evidence, "original_name", true, 180); text(evidence, "sha256", true, 64); timestamps(evidence); app.save(evidence)

    const preferences = create("tax_notification_preferences", [
      "CREATE UNIQUE INDEX idx_tax_notification_pref ON tax_notification_preferences (tenant_id, subject_key)",
    ])
    tenant(preferences); relation(preferences, "subject_id", subjects, false, true); text(preferences, "subject_key", true, 30)
    bool(preferences, "in_app_enabled"); bool(preferences, "email_enabled")
    bool(preferences, "include_amount_in_email"); text(preferences, "timezone", true, 60)
    number(preferences, "delivery_hour", false, 0, 23); json(preferences, "monthly_offsets", true); json(preferences, "annual_offsets", true)
    number(preferences, "overdue_weekly_limit", false, 0, 12); number(preferences, "revision", true, 1); timestamps(preferences); app.save(preferences)

    const notifications = create("tax_notifications", [
      "CREATE UNIQUE INDEX idx_tax_notification_dedupe ON tax_notifications (tenant_id, dedupe_key)",
      "CREATE INDEX idx_tax_notification_queue ON tax_notifications (status, scheduled_at)",
    ])
    tenant(notifications); relation(notifications, "subject_id", subjects, true, true); relation(notifications, "obligation_id", obligations, false, true)
    relation(notifications, "filing_id", filings, false, true); select(notifications, "action", ["PREPARE", "PAY", "FILE", "OVERDUE"])
    select(notifications, "channel", ["IN_APP", "EMAIL"]); date(notifications, "scheduled_at", true); text(notifications, "dedupe_key", true, 180)
    select(notifications, "status", ["PENDING", "LEASED", "SENT", "RETRYABLE_FAILED", "PERMANENTLY_FAILED", "CANCELLED", "UNKNOWN"])
    number(notifications, "attempt_count", false, 0); text(notifications, "last_error", false, 500); date(notifications, "lease_until", false); date(notifications, "sent_at", false)
    text(notifications, "message_id", false, 160); text(notifications, "schedule_version", true, 60); date(notifications, "read_at", false)
    timestamps(notifications); app.save(notifications)

    const commands = create("tax_commands", ["CREATE UNIQUE INDEX idx_tax_command_key ON tax_commands (tenant_id, command_key)"])
    tenant(commands); text(commands, "command_key", true, 100); text(commands, "request_hash", true, 128); text(commands, "command_type", true, 60)
    number(commands, "response_status", true, 100, 599); json(commands, "response_body", true); timestamps(commands); app.save(commands)

    const audit = create("tax_audit", ["CREATE INDEX idx_tax_audit_subject_created ON tax_audit (tenant_id, subject_id, created)"])
    tenant(audit); relation(audit, "subject_id", subjects, false, false); relation(audit, "actor_id", users, true, false)
    text(audit, "action", true, 60); text(audit, "command_key", false, 100); text(audit, "target_type", true, 40); text(audit, "target_id", false, 30)
    text(audit, "reason", false, 500); json(audit, "before", false); json(audit, "after", false); timestamps(audit); app.save(audit)
  },
  () => {
    // Deliberately non-destructive. Compliance evidence and audit history must
    // not be erased by an application rollback.
  },
)

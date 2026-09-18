routerAdd("GET", "/api/jornal/tax/catalog", (event) => {
  const { requireTaxEnabled } = require(`${__hooks}/tax_helpers.js`); requireTaxEnabled()
  const { RULES } = require(`${__hooks}/tax_rules.js`)
  return event.json(200, { items: RULES })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/configuration", (event) => {
  const { recordJson, subjectResponse } = require(`${__hooks}/tax_helpers.js`)
  require(`${__hooks}/tax_helpers.js`).requireTaxEnabled()
  const tenantId = require(`${__hooks}/tax_helpers.js`).requestTenant(event)
  const access = require(`${__hooks}/company_access.js`)
  const query = event.request.url.query(); const companyId = String(query.get("companyId") || "")
  const linkedIds = companyId ? [...new Set($app.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "id", 0, 0, { tenant: tenantId, company: companyId }).map((row) => row.getString("subject_id")))] : []
  const allowedIds = []; let restricted = false
  for (const id of linkedIds) {
    try { const subject = $app.findRecordById("tax_subjects", id); access.assertTaxSubjectAccess($app, event.auth.id, subject, true); allowedIds.push(id) } catch { restricted = true }
  }
  const find = (collection, sort) => $app.findRecordsByFilter(collection, "tenant_id = {:tenant}", sort || "created", 0, 0, { tenant: tenantId }).filter((record) => allowedIds.includes(record.getString("subject_id"))).map(recordJson)
  const subjects = $app.findRecordsByFilter("tax_subjects", "tenant_id = {:tenant}", "created", 0, 0, { tenant: tenantId }).filter((subject) => allowedIds.includes(subject.id))
  return event.json(200, {
    subjects: subjects.map(subjectResponse),
    memberships: find("tax_company_memberships"),
    registrations: find("tax_registrations"),
    preferences: find("tax_notification_preferences").filter((preference) => !preference.recipient_user_id || preference.recipient_user_id === event.auth.id),
    taxCoverage: restricted ? "RESTRICTED_SHARED_SUBJECT" : "COMPLETE",
  })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/setup", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const { ruleById } = require(`${__hooks}/tax_rules.js`)
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-setup", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const label = String(body.label || "").trim().slice(0, 100)
  const subjectType = String(body.subjectType || "")
  const companyIds = [...new Set(Array.isArray(body.companyIds) ? body.companyIds.map(String) : [])]
  if (!label || !["INDIVIDUAL", "ENTITY"].includes(subjectType) || companyIds.length === 0) throw event.badRequestError("Invalid tax subject setup", {})
  if (companyIds.length > 100) throw event.badRequestError("Too many companies", {})
  const fiscalMonth = Number(body.fiscalYearStartMonth || 1); const fiscalDay = Number(body.fiscalYearStartDay || 1)
  if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12 || !Number.isInteger(fiscalDay) || fiscalDay < 1 || fiscalDay > 31) throw event.badRequestError("Invalid fiscal year start", {})
  const fiscalProbe = new Date(Date.UTC(2000, fiscalMonth - 1, fiscalDay))
  if (fiscalProbe.getUTCMonth() !== fiscalMonth - 1 || fiscalProbe.getUTCDate() !== fiscalDay) throw event.badRequestError("Invalid fiscal year start", {})
  const effectiveFrom = helpers.isoDate(body.effectiveFrom || new Date().toISOString().slice(0, 10), "effectiveFrom")
  const registrations = Array.isArray(body.registrations) ? body.registrations : []
  if (registrations.length > 50) throw event.badRequestError("Too many tax registrations", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      for (const companyId of companyIds) {
        helpers.ownedCompany(tx, tenantId, companyId, false)
        const existing = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
        if (existing.some((membership) => {
          const end = membership.getString("effective_until")
          return !end || end >= effectiveFrom
        })) throw new ApiError(409, "Company already belongs to a tax subject for this period")
      }
      const subject = new Record(tx.findCollectionByNameOrId("tax_subjects"), {
        tenant_id: tenantId, label, subject_type: subjectType,
        entity_form: String(body.entityForm || "").slice(0, 40), masked_tax_id: String(body.maskedTaxId || "").slice(0, 32),
        fiscal_year_start_month: fiscalMonth, fiscal_year_start_day: fiscalDay,
        timezone: String(body.timezone || "Asia/Jakarta").slice(0, 60), status: "ACTIVE",
        umkm_eligibility: ["ELIGIBLE", "INELIGIBLE"].includes(String(body.umkmEligibility)) ? String(body.umkmEligibility) : "NEEDS_REVIEW",
        umkm_eligibility_effective_from: body.umkmEligibilityEffectiveFrom ? helpers.isoDate(body.umkmEligibilityEffectiveFrom, "umkmEligibilityEffectiveFrom") : "",
        eligibility_answers: body.eligibilityAnswers || {}, revision: 1,
      })
      tx.save(subject)
      for (const companyId of companyIds) tx.save(new Record(tx.findCollectionByNameOrId("tax_company_memberships"), {
        tenant_id: tenantId, subject_id: subject.id, company_id: companyId, effective_from: effectiveFrom, revision: 1,
      }))

      const requested = registrations.slice()
      const annualKind = subjectType === "INDIVIDUAL" ? "SPT_ANNUAL_INDIVIDUAL" : "SPT_ANNUAL_ENTITY"
      if (!requested.some((item) => item && item.kind === annualKind)) requested.push({ kind: annualKind })
      const createdRegistrations = []
      for (const input of requested) {
        const kind = String(input && input.kind || "")
        const rule = input && input.ruleId ? ruleById(String(input.ruleId)) : require(`${__hooks}/tax_rules.js`).ruleByKindAt(kind, effectiveFrom)
        if (!rule || rule.kind !== kind) throw new ApiError(400, `Unsupported tax kind: ${kind}`)
        const amountMode = rule.automaticAmount ? "AUTOMATIC_UMKM" : (input && input.amountMode === "DOCUMENT" ? "DOCUMENT" : "MANUAL_CONFIRMED")
        const defaultAmount = input && input.defaultAmount !== undefined ? helpers.nonNegativeMoney(input.defaultAmount, "defaultAmount", true) : null
        const defaultDueDate = input && input.defaultDueDate ? helpers.isoDate(input.defaultDueDate, "defaultDueDate") : ""
        if (rule.manualDateRequired && !defaultDueDate && rule.periodicity === "EVENT") throw new ApiError(400, `${kind} requires a document due date`)
        const registration = new Record(tx.findCollectionByNameOrId("tax_registrations"), {
          tenant_id: tenantId, subject_id: subject.id, kind, label: String(input && input.label || rule.label).slice(0, 120),
          periodicity: rule.periodicity, filing_group: rule.filingGroup, amount_mode: amountMode,
          jurisdiction: String(input && input.jurisdiction || "").slice(0, 120), active_from: effectiveFrom,
          active_until: input && input.activeUntil ? helpers.isoDate(input.activeUntil, "activeUntil") : "",
          default_amount: defaultAmount, has_default_amount: defaultAmount !== null,
          default_due_date: defaultDueDate, rule_id: rule.id, revision: 1,
        })
        tx.save(registration); createdRegistrations.push(helpers.recordJson(registration))
      }
      const preference = new Record(tx.findCollectionByNameOrId("tax_notification_preferences"), {
        tenant_id: tenantId, recipient_user_id: event.auth.id, subject_id: subject.id, subject_key: subject.id,
        in_app_enabled: body.inAppEnabled !== false, email_enabled: body.emailEnabled === true,
        include_amount_in_email: body.includeAmountInEmail === true,
        timezone: String(body.timezone || "Asia/Jakarta").slice(0, 60), delivery_hour: Number(body.deliveryHour ?? 9),
        monthly_offsets: Array.isArray(body.monthlyOffsets) ? body.monthlyOffsets : [7, 3, 1, 0],
        annual_offsets: Array.isArray(body.annualOffsets) ? body.annualOffsets : [30, 14, 7, 3, 1, 0],
        overdue_weekly_limit: Number(body.overdueWeeklyLimit ?? 4), revision: 1,
      })
      tx.save(preference)
      response = { subject: helpers.subjectResponse(subject), registrations: createdRegistrations }
      helpers.audit(tx, tenantId, subject.id, "tax-subject-created", command.key, "tax_subject", subject.id, "", null, response)
      helpers.saveCommand(tx, tenantId, "tax-setup", command, 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-setup", body)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/period-inputs", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-period-input", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const period = String(body.period || "")
  if (!/^\d{4}-\d{2}$/.test(period) || Number(period.slice(5)) < 1 || Number(period.slice(5)) > 12) throw event.badRequestError("Invalid monthly period", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, body.subjectId)
      const companyId = body.companyId ? String(body.companyId) : ""
      let companyKey = "external"
      let dataEpoch = null
      if (companyId) {
        const company = helpers.ownedCompany(tx, tenantId, companyId, false)
        const memberships = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && subject_id = {:subject} && company_id = {:company}", "", 0, 0, { tenant: tenantId, subject: subject.id, company: companyId })
        if (!memberships.some((membership) => membership.getString("effective_from").slice(0, 7) <= period && (!membership.getString("effective_until") || membership.getString("effective_until").slice(0, 7) >= period))) throw new ApiError(400, "Company is outside the tax subject for this period")
        companyKey = companyId; dataEpoch = company.getInt("data_epoch")
      }
      const values = {
        taxableRevenue: helpers.nonNegativeMoney(body.taxableRevenue ?? 0, "taxableRevenue"),
        externalRevenue: companyId ? 0 : helpers.nonNegativeMoney(body.externalRevenue ?? 0, "externalRevenue"),
        openingYtdRevenue: companyId ? 0 : helpers.nonNegativeMoney(body.openingYtdRevenue ?? 0, "openingYtdRevenue"),
        adjustments: Number(body.adjustments || 0),
      }
      if (!Number.isSafeInteger(values.adjustments)) throw new ApiError(400, "adjustments must be an integer")
      const fingerprint = $security.sha256(helpers.stableStringify({ subjectId: subject.id, companyKey, period, values, dataEpoch }))
      let input
      try { input = tx.findFirstRecordByFilter("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && company_key = {:companyKey} && period = {:period}", { tenant: tenantId, subject: subject.id, companyKey, period }) } catch { input = null }
      if (values.openingYtdRevenue > 0) {
        const otherOpenings = tx.findRecordsByFilter("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && company_key = 'external' && period >= {:start} && period <= {:end} && opening_ytd_revenue > 0", "", 0, 0, { tenant: tenantId, subject: subject.id, start: `${period.slice(0, 4)}-01`, end: `${period.slice(0, 4)}-12` })
        if (otherOpenings.some((record) => !input || record.id !== input.id)) throw new ApiError(409, "Opening YTD revenue is already recorded for this tax year")
      }
      const before = input ? helpers.recordJson(input) : null
      if (!input) input = new Record(tx.findCollectionByNameOrId("tax_period_inputs"), { tenant_id: tenantId, subject_id: subject.id, company_id: companyId, company_key: companyKey, period })
      input.set("taxable_revenue", values.taxableRevenue); input.set("external_revenue", values.externalRevenue); input.set("opening_ytd_revenue", values.openingYtdRevenue); input.set("adjustments", values.adjustments)
      input.set("data_status", body.dataStatus === "COMPLETE" ? "COMPLETE" : "INCOMPLETE")
      input.set("source_revision", String(body.sourceRevision || "manual").slice(0, 100)); input.set("data_epoch", dataEpoch || "")
      input.set("fingerprint", fingerprint); input.set("confirmed_at", body.dataStatus === "COMPLETE" ? new Date().toISOString() : "")
      tx.save(input); response = helpers.recordJson(input)
      helpers.audit(tx, tenantId, subject.id, before ? "tax-period-input-updated" : "tax-period-input-created", command.key, "tax_period_input", input.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-period-input", command, before ? 200 : 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-period-input", body)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/subjects/{id}/companies", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const subjectId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-add-company", Object.assign({}, body, { subjectId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  const companyId = String(body.companyId || ""); const effectiveFrom = helpers.isoDate(body.effectiveFrom, "effectiveFrom")
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, subjectId)
      helpers.ownedCompany(tx, tenantId, companyId, false)
      const existing = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
      if (existing.some((membership) => !membership.getString("effective_until") || membership.getString("effective_until") >= effectiveFrom)) throw new ApiError(409, "Company already belongs to a tax subject for this period")
      const membership = new Record(tx.findCollectionByNameOrId("tax_company_memberships"), {
        tenant_id: tenantId, subject_id: subject.id, company_id: companyId, effective_from: effectiveFrom, revision: 1,
      })
      tx.save(membership); response = helpers.recordJson(membership)
      helpers.audit(tx, tenantId, subject.id, "tax-company-linked", command.key, "tax_company_membership", membership.id, String(body.reason || ""), null, response)
      helpers.saveCommand(tx, tenantId, "tax-add-company", command, 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-add-company", Object.assign({}, body, { subjectId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/memberships/{id}/end", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const membershipId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { membershipId }); const command = helpers.replayCommand($app, tenantId, "tax-end-membership", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  const effectiveUntil = helpers.isoDate(body.effectiveUntil, "effectiveUntil")
  let response
  try {
    $app.runInTransaction((tx) => {
      let membership
      try { membership = tx.findRecordById("tax_company_memberships", membershipId) } catch { throw new ApiError(404, "Tax company membership not found") }
      if (membership.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax company membership not found")
      if (Number(body.revision || 0) !== membership.getInt("revision")) throw new ApiError(409, "Membership revision is out of date")
      if (effectiveUntil < membership.getString("effective_from").slice(0, 10)) throw new ApiError(400, "End date precedes start date")
      const before = helpers.recordJson(membership); membership.set("effective_until", effectiveUntil); membership.set("revision", membership.getInt("revision") + 1); tx.save(membership)
      const inputs = tx.findRecordsByFilter("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && company_id = {:company} && period > {:period}", "", 0, 0, { tenant: tenantId, subject: membership.getString("subject_id"), company: membership.getString("company_id"), period: effectiveUntil.slice(0, 7) })
      for (const input of inputs) { input.set("data_status", "NEEDS_RECONCILIATION"); tx.save(input) }
      response = helpers.recordJson(membership)
      helpers.audit(tx, tenantId, membership.getString("subject_id"), "tax-company-membership-ended", command.key, "tax_company_membership", membership.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-end-membership", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-end-membership", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/obligations/generate", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const rules = require(`${__hooks}/tax_rules.js`)
  const calendar = require(`${__hooks}/tax_calendar.js`)
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-generate", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const period = String(body.period || "")
  if (!/^\d{4}(?:-\d{2})?$/.test(period)) throw event.badRequestError("Invalid tax period", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, body.subjectId)
      if (subject.getString("status") !== "ACTIVE") throw new ApiError(409, "Tax subject is inactive")
      const registrations = tx.findRecordsByFilter("tax_registrations", "tenant_id = {:tenant} && subject_id = {:subject}", "created", 0, 0, { tenant: tenantId, subject: subject.id })
        .filter((registration) => registration.getString("active_from").slice(0, 7) <= period && (!registration.getString("active_until") || registration.getString("active_until").slice(0, 7) >= period))
      const monthly = period.length === 7
      const relevant = registrations.filter((registration) => (registration.getString("periodicity") === "MONTHLY") === monthly && registration.getString("periodicity") !== "EVENT")
      const year = Number(period.slice(0, 4))
      const startMonth = subject.getInt("fiscal_year_start_month"); const startDay = subject.getInt("fiscal_year_start_day")
      const nextStart = new Date(Date.UTC(year + 1, startMonth - 1, startDay)); nextStart.setUTCDate(nextStart.getUTCDate() - 1)
      const fiscalYearEnd = nextStart.toISOString().slice(0, 10)
      const created = []
      const filingGroups = {}
      for (const registration of relevant) {
        const ruleDate = period.length === 7 ? `${period}-01` : `${period}-12-31`
        const rule = rules.ruleByKindAt(registration.getString("kind"), ruleDate) || rules.ruleById(registration.getString("rule_id"))
        if (!rule) throw new ApiError(409, "Tax rule is unavailable")
        let amountState = "UNKNOWN"; let dataStatus = "INCOMPLETE"; let liability = null; let inputFingerprint = ""
        if (registration.getString("amount_mode") === "AUTOMATIC_UMKM") {
          const currentInputs = tx.findRecordsByFilter("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && period = {:period}", "", 0, 0, { tenant: tenantId, subject: subject.id, period })
          const previousInputs = tx.findRecordsByFilter("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && period >= {:first} && period < {:period}", "period", 0, 0, { tenant: tenantId, subject: subject.id, first: `${year}-01`, period })
          const memberships = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && subject_id = {:subject}", "", 0, 0, { tenant: tenantId, subject: subject.id })
            .filter((membership) => membership.getString("effective_from").slice(0, 7) <= period && (!membership.getString("effective_until") || membership.getString("effective_until").slice(0, 7) >= period))
          const currentCompanies = new Set(currentInputs.filter((input) => input.getString("company_id") && input.getString("data_status") === "COMPLETE").map((input) => input.getString("company_id")))
          const externalDeclared = currentInputs.some((input) => input.getString("company_key") === "external" && input.getString("data_status") === "COMPLETE")
          const dataComplete = memberships.every((membership) => currentCompanies.has(membership.getString("company_id"))) && externalDeclared
          const sum = (inputs) => inputs.reduce((total, input) => total + input.getInt("taxable_revenue") + input.getInt("external_revenue") + input.getInt("adjustments"), 0)
          const openingYtdRevenue = currentInputs.concat(previousInputs).reduce((total, input) => total + input.getInt("opening_ytd_revenue"), 0)
          const result = rules.computeUmkm({
            subjectType: subject.getString("subject_type"), eligible: subject.getString("umkm_eligibility") === "ELIGIBLE",
            dataComplete, cumulativeRevenueBefore: Math.max(0, openingYtdRevenue + sum(previousInputs)), currentMonthRevenue: Math.max(0, sum(currentInputs)),
          })
          amountState = result.amountState; dataStatus = result.dataStatus; liability = result.liabilityAmount
          inputFingerprint = $security.sha256(currentInputs.concat(previousInputs).map((input) => input.getString("fingerprint")).sort().join("|"))
        } else if (registration.getBool("has_default_amount")) {
          liability = registration.getInt("default_amount"); amountState = "CONFIRMED"; dataStatus = "COMPLETE"
        }
        const linkedAnnualFiling = rules.addMonthsClamped(fiscalYearEnd, subject.getString("subject_type") === "INDIVIDUAL" ? 3 : 4)
        const paymentDue = registration.getString("default_due_date") || rules.dueDate(rule.paymentDueRule, period, fiscalYearEnd, linkedAnnualFiling) || ""
        const filingDue = registration.getString("default_due_date") || rules.dueDate(rule.filingDueRule, period, fiscalYearEnd, null) || ""
        const statutoryDue = paymentDue || filingDue
        const adjustedPayment = calendar.adjustDueDate(statutoryDue)
        const adjustedFiling = calendar.adjustDueDate(filingDue)
        const effectiveDue = adjustedPayment.date || ""
        let obligation
        try { obligation = tx.findFirstRecordByFilter("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject} && registration_id = {:registration} && period = {:period} && component = 'PRIMARY'", { tenant: tenantId, subject: subject.id, registration: registration.id, period }) } catch { obligation = null }
        const existingAmountState = obligation ? obligation.getString("amount_state") : ""
        const existingFingerprint = obligation ? obligation.getString("input_fingerprint") : ""
        const existingLiability = obligation && obligation.getBool("has_liability_amount") ? obligation.getInt("liability_amount") : null
        const automaticChanged = Boolean(
          obligation && rule.automaticAmount && existingAmountState === "CONFIRMED" && existingFingerprint &&
          existingFingerprint !== inputFingerprint && liability !== existingLiability,
        )
        if (obligation && !rule.automaticAmount && existingAmountState === "CONFIRMED") {
          liability = existingLiability; amountState = "CONFIRMED"; dataStatus = "COMPLETE"
        }
        if (automaticChanged) {
          obligation.set("proposed_liability_amount", liability === null ? 0 : liability)
          obligation.set("has_proposed_liability_amount", liability !== null)
          liability = existingLiability; amountState = "NEEDS_REVIEW"; dataStatus = "NEEDS_RECONCILIATION"
        }
        if (!obligation) obligation = new Record(tx.findCollectionByNameOrId("tax_obligations"), {
          tenant_id: tenantId, subject_id: subject.id, registration_id: registration.id,
          kind: registration.getString("kind"), component: "PRIMARY", period, currency: "IDR", revision: 1,
          settled_by_third_party: 0, allocated_payments: 0, overpaid_amount: 0,
        })
        else obligation.set("revision", obligation.getInt("revision") + 1)
        const settlements = obligation.getInt("settled_by_third_party") + obligation.getInt("allocated_payments")
        const remaining = liability === null ? null : Math.max(0, liability - settlements)
        const overpaid = liability === null ? 0 : Math.max(0, settlements - liability)
        const paymentStatus = liability === null ? "UNKNOWN" : liability === 0 ? "NOT_REQUIRED" : settlements === 0 ? (effectiveDue && effectiveDue >= new Date().toISOString().slice(0, 10) ? "NOT_DUE" : "UNPAID") : settlements < liability ? "PARTIAL" : settlements === liability ? "PAID" : "OVERPAID"
        obligation.set("amount_state", amountState); obligation.set("liability_amount", liability === null ? 0 : liability)
        obligation.set("has_liability_amount", liability !== null)
        if (!automaticChanged) { obligation.set("proposed_liability_amount", 0); obligation.set("has_proposed_liability_amount", false) }
        obligation.set("remaining_payable", remaining === null ? 0 : remaining); obligation.set("has_remaining_payable", remaining !== null)
        obligation.set("overpaid_amount", overpaid)
        obligation.set("payment_status", paymentStatus); obligation.set("filing_status", obligation.getString("filing_status") || "PENDING")
        obligation.set("data_status", dataStatus); obligation.set("statutory_due_date", statutoryDue); obligation.set("effective_due_date", effectiveDue)
        obligation.set("deadline_status", adjustedPayment.status); obligation.set("deadline_source", adjustedPayment.source)
        obligation.set("rule_id", rule.id); obligation.set("rule_version", rule.version); obligation.set("input_fingerprint", inputFingerprint)
        obligation.set("amount_source", amountState === "CONFIRMED" ? (rule.automaticAmount ? "Omzet direkonsiliasi di Jornal" : "Nilai default terkonfirmasi") : "")
        obligation.set("amount_confirmed_at", amountState === "CONFIRMED" ? new Date().toISOString() : "")
        tx.save(obligation); created.push(helpers.obligationResponse(obligation))
        const groupKey = rule.filingGroup
        if (rule.filingDueRule) {
          if (!filingGroups[groupKey]) filingGroups[groupKey] = { statutoryDue: filingDue, due: adjustedFiling.date || "", deadlineStatus: adjustedFiling.status, deadlineSource: adjustedFiling.source, obligationIds: [] }
          filingGroups[groupKey].obligationIds.push(obligation.id)
        }
      }
      for (const groupKey of Object.keys(filingGroups)) {
        const group = filingGroups[groupKey]
        let filing
        try { filing = tx.findFirstRecordByFilter("tax_filings", "tenant_id = {:tenant} && subject_id = {:subject} && filing_group = {:group} && period = {:period} && registration_key = 'subject'", { tenant: tenantId, subject: subject.id, group: groupKey, period }) } catch { filing = null }
        if (!filing) filing = new Record(tx.findCollectionByNameOrId("tax_filings"), { tenant_id: tenantId, subject_id: subject.id, filing_group: groupKey, period, registration_key: "subject", status: "PENDING", revision: 1 })
        else filing.set("revision", filing.getInt("revision") + 1)
        filing.set("obligation_ids", [...new Set(group.obligationIds)]); filing.set("statutory_due_date", group.statutoryDue || ""); filing.set("effective_due_date", group.due || "")
        filing.set("deadline_status", group.deadlineStatus); filing.set("deadline_source", group.deadlineSource)
        tx.save(filing)
      }
      response = { subjectId: subject.id, period, obligations: created }
      helpers.audit(tx, tenantId, subject.id, "tax-obligations-generated", command.key, "tax_period", period, "", null, { count: created.length })
      helpers.saveCommand(tx, tenantId, "tax-generate", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-generate", body)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/agenda", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  const { obligationResponse, recordJson } = helpers
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event)
  const query = event.request.url.query()
  const subjectId = String(query.get("subjectId") || "")
  const companyId = String(query.get("companyId") || "")
  let subjectIds = []
  let taxCoverage = "COMPLETE"
  if (companyId) {
    let company
    try { company = $app.findRecordById("companies", companyId) } catch { throw event.notFoundError("Company not found", {}) }
    if (company.getString("tenant_id") !== tenantId) throw event.notFoundError("Company not found", {})
    const candidates = [...new Set($app.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId }).map((record) => record.getString("subject_id")))]
    subjectIds = candidates.filter((id) => { try { require(`${__hooks}/company_access.js`).assertTaxSubjectAccess($app, event.auth.id, $app.findRecordById("tax_subjects", id), true); return true } catch { taxCoverage = "RESTRICTED_SHARED_SUBJECT"; return false } })
  } else if (subjectId) {
    subjectIds = [subjectId]
  }
  const scopedAgenda = Boolean(companyId || subjectId)
  if (subjectIds.length > 0) for (const id of subjectIds) {
    let subject
    try { subject = $app.findRecordById("tax_subjects", id) } catch { throw event.notFoundError("Tax subject not found", {}) }
    if (subject.getString("tenant_id") !== tenantId) throw event.notFoundError("Tax subject not found", {})
  }
  const obligations = helpers.findAllRecords($app, "tax_obligations", "tenant_id = {:tenant}", "effective_due_date,id", { tenant: tenantId })
    .filter((record) => !scopedAgenda || subjectIds.includes(record.getString("subject_id"))).map(obligationResponse)
  const filings = helpers.findAllRecords($app, "tax_filings", "tenant_id = {:tenant}", "effective_due_date,id", { tenant: tenantId })
    .filter((record) => !scopedAgenda || subjectIds.includes(record.getString("subject_id"))).map(recordJson)
  const settlements = helpers.findAllRecords($app, "tax_settlements", "tenant_id = {:tenant}", "-settlement_date,-id", { tenant: tenantId })
    .filter((record) => !scopedAgenda || subjectIds.includes(record.getString("subject_id"))).map(recordJson)
  const settlementIds = new Set(settlements.map((record) => String(record.id)))
  const allocations = helpers.findAllRecords($app, "tax_allocations", "tenant_id = {:tenant}", "created,id", { tenant: tenantId })
    .filter((record) => settlementIds.has(record.getString("settlement_id"))).map(recordJson)
  const evidence = helpers.findAllRecords($app, "tax_evidence", "tenant_id = {:tenant}", "-created,-id", { tenant: tenantId })
    .filter((record) => !scopedAgenda || subjectIds.includes(record.getString("subject_id"))).map((record) => { const result = recordJson(record); delete result.document; return result })
  return event.json(200, { obligations, filings, settlements, allocations, evidence, taxCoverage })
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/inbox", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event)
  const items = $app.findRecordsByFilter("tax_notifications", "tenant_id = {:tenant} && recipient_user_id = {:recipient} && channel = 'IN_APP' && status = 'SENT' && read_at = ''", "-scheduled_at", 100, 0, { tenant: tenantId, recipient: event.auth.id }).map(helpers.recordJson)
  return event.json(200, { items })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/inbox/read", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-inbox-read", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))].slice(0, 100) : []
  let updated = 0
  $app.runInTransaction((tx) => {
    for (const id of ids) {
      let notification
      try { notification = tx.findRecordById("tax_notifications", id) } catch { continue }
      if (notification.getString("tenant_id") !== tenantId || notification.getString("recipient_user_id") !== event.auth.id || notification.getString("channel") !== "IN_APP") continue
      notification.set("read_at", new Date().toISOString()); tx.save(notification); updated += 1
    }
    helpers.saveCommand(tx, tenantId, "tax-inbox-read", command, 200, { updated })
  })
  return event.json(200, { updated })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/settlements", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-settlement", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const amount = helpers.nonNegativeMoney(body.amount, "amount")
  if (amount <= 0) throw event.badRequestError("Settlement amount must be greater than zero", {})
  const settlementType = String(body.type || "")
  if (!["SELF_PAYMENT", "THIRD_PARTY_WITHHOLDING", "COMPENSATION", "TAX_DEPOSIT_USE", "OUTSIDE_LEDGER"].includes(settlementType)) throw event.badRequestError("Invalid settlement type", {})
  const settlementDate = helpers.isoDate(body.settlementDate, "settlementDate")
  const allocations = Array.isArray(body.allocations) ? body.allocations : []
  if (allocations.length === 0 || allocations.length > 100) throw event.badRequestError("Settlement allocations are required", {})
  const allocationTotal = allocations.reduce((sum, allocation) => sum + helpers.nonNegativeMoney(allocation && allocation.amount, "allocation amount"), 0)
  if (allocationTotal > amount) throw event.badRequestError("Allocations exceed settlement amount", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, body.subjectId)
      const obligations = []
      for (const allocation of allocations) {
        const obligation = helpers.ownedObligation(tx, tenantId, allocation.obligationId)
        if (obligation.getString("subject_id") !== subject.id) throw new ApiError(400, "Obligation belongs to another tax subject")
        if (obligations.some((item) => item.record.id === obligation.id)) throw new ApiError(400, "Duplicate obligation allocation")
        obligations.push({ record: obligation, amount: helpers.nonNegativeMoney(allocation.amount, "allocation amount") })
      }
      let companyId = body.ledgerCompanyId ? String(body.ledgerCompanyId) : ""
      let transactionId = body.ledgerTransactionId ? String(body.ledgerTransactionId) : ""
      let ledgerPayload = null
      if (body.ledgerTransaction) {
        const input = body.ledgerTransaction
        companyId = String(input.companyId || companyId)
        transactionId = String(input.id || transactionId)
        const company = helpers.ownedCompany(tx, tenantId, companyId, true)
        if (!transactionId || transactionId.length > 80) throw new ApiError(400, "A ledger transaction id is required")
        try {
          tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, id: transactionId })
          throw new ApiError(409, "Ledger transaction already exists")
        } catch (error) {
          if (error && error.status && error.status !== 404) throw error
        }
        const now = new Date().toISOString()
        const payload = {
          id: transactionId, businessId: tenantId, companyId, direction: "MONEY_OUT", amount,
          currency: "IDR", transactionDate: settlementDate, description: String(input.description || "Pembayaran pajak").slice(0, 200),
          notes: String(input.notes || "").slice(0, 2000), categoryId: input.categoryId || null,
          paymentMethod: String(input.paymentMethod || "").slice(0, 80), supplierCustomer: "Direktorat Jenderal Pajak",
          tags: String(input.tags || "pajak").slice(0, 300), accountId: input.accountId || null, transferAccountId: null,
          attachmentName: null, attachmentDataUrl: null, receivableTransactionId: null, receivableDueDate: null,
          taxSubjectId: subject.id, taxObligationId: obligations.length === 1 ? obligations[0].record.id : null,
          taxKind: obligations.length === 1 ? obligations[0].record.getString("kind") : null,
          taxPeriod: obligations.length === 1 ? obligations[0].record.getString("period") : null,
          classification: "TAX_PAYMENT", taxClassification: "TAX_PAYMENT", businessRelevance: "BUSINESS",
          classificationSource: "USER", classificationConfidence: 1, reviewStatus: "ACCEPTED", createdAt: now, updatedAt: now,
        }
        tx.save(new Record(tx.findCollectionByNameOrId("jornal_records"), {
          business_id: tenantId, company_id: companyId, data_epoch: company.getInt("data_epoch"),
          entity: "transactions", app_id: transactionId, payload, revision: 1,
        }))
      } else if (transactionId || companyId) {
        if (!transactionId || !companyId) throw new ApiError(400, "Both ledger company and transaction are required")
        helpers.ownedCompany(tx, tenantId, companyId, false)
        let record
        try { record = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, id: transactionId }) } catch { throw new ApiError(404, "Ledger transaction not found") }
        let payload = record.get("payload") || {}
        try { payload = JSON.parse(record.getString("payload")) } catch { /* JSONMap */ }
        const get = (key) => typeof payload.get === "function" ? payload.get(key) : payload[key]
        if (get("classification") !== "TAX_PAYMENT" || Number(get("amount")) !== amount) throw new ApiError(400, "Ledger transaction is not a matching tax payment")
      }
      if ((transactionId || companyId) && ["THIRD_PARTY_WITHHOLDING", "COMPENSATION", "TAX_DEPOSIT_USE"].includes(settlementType)) throw new ApiError(400, "This settlement type must not create a second cash transaction")

      const settlement = new Record(tx.findCollectionByNameOrId("tax_settlements"), {
        tenant_id: tenantId, subject_id: subject.id, settlement_type: settlementType, amount,
        settlement_date: settlementDate, ledger_company_id: companyId, ledger_transaction_id: transactionId,
        reference: String(body.reference || "").slice(0, 160), source: String(body.source || "Dikonfirmasi pengguna").slice(0, 160), status: "ACTIVE", revision: 1,
      })
      tx.save(settlement)
      if (transactionId) {
        const transaction = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, id: transactionId })
        let payload = transaction.get("payload") || {}
        try { payload = JSON.parse(transaction.getString("payload")) } catch { /* JSONMap */ }
        const plain = typeof payload.get === "function" ? JSON.parse(transaction.getString("payload")) : payload
        plain.taxSettlementId = settlement.id
        transaction.set("payload", plain); transaction.set("revision", transaction.getInt("revision") + 1); tx.save(transaction)
        ledgerPayload = plain
      }
      for (const allocation of obligations) tx.save(new Record(tx.findCollectionByNameOrId("tax_allocations"), {
        tenant_id: tenantId, settlement_id: settlement.id, obligation_id: allocation.record.id, amount: allocation.amount,
      }))

      const obligationResponses = []
      for (const allocated of obligations) {
        const obligation = allocated.record
        const allAllocations = tx.findRecordsByFilter("tax_allocations", "tenant_id = {:tenant} && obligation_id = {:obligation}", "", 0, 0, { tenant: tenantId, obligation: obligation.id })
        let thirdParty = 0; let ownPayments = 0
        for (const allocation of allAllocations) {
          const source = tx.findRecordById("tax_settlements", allocation.getString("settlement_id"))
          if (source.getString("status") === "REVERSED") continue
          if (source.getString("settlement_type") === "THIRD_PARTY_WITHHOLDING") thirdParty += allocation.getInt("amount")
          else ownPayments += allocation.getInt("amount")
        }
        const known = obligation.getBool("has_liability_amount"); const liability = obligation.getInt("liability_amount")
        const settled = thirdParty + ownPayments
        const remaining = known ? Math.max(0, liability - settled) : null
        const overpaid = known ? Math.max(0, settled - liability) : 0
        const status = !known ? "UNKNOWN" : liability === 0 ? "NOT_REQUIRED" : settled === 0 ? "UNPAID" : settled < liability ? "PARTIAL" : settled === liability ? "PAID" : "OVERPAID"
        obligation.set("settled_by_third_party", thirdParty); obligation.set("allocated_payments", ownPayments)
        obligation.set("remaining_payable", remaining === null ? 0 : remaining); obligation.set("has_remaining_payable", remaining !== null)
        obligation.set("overpaid_amount", overpaid); obligation.set("payment_status", status); obligation.set("revision", obligation.getInt("revision") + 1)
        tx.save(obligation)

        if (body.validatedPayment === true && ["PPH_FINAL_UMKM", "PPH_25"].includes(obligation.getString("kind")) && ["PAID", "NOT_REQUIRED"].includes(status)) {
          const registration = tx.findRecordById("tax_registrations", obligation.getString("registration_id"))
          const filings = tx.findRecordsByFilter("tax_filings", "tenant_id = {:tenant} && subject_id = {:subject} && period = {:period} && filing_group = {:group}", "", 0, 0, {
            tenant: tenantId, subject: subject.id, period: obligation.getString("period"), group: registration.getString("filing_group"),
          })
          for (const filing of filings) {
            const filingObligations = helpers.jsonArray(filing, "obligation_ids").map((id) => tx.findRecordById("tax_obligations", id))
            const fullySatisfiedByPayment = filingObligations.length > 0 && filingObligations.every((candidate) =>
              ["PPH_FINAL_UMKM", "PPH_25"].includes(candidate.getString("kind"))
              && ["PAID", "NOT_REQUIRED"].includes(candidate.getString("payment_status")),
            )
            if (!fullySatisfiedByPayment || ["FILED", "NOT_REQUIRED"].includes(filing.getString("status"))) continue
            filing.set("status", "FULFILLED_BY_PAYMENT"); filing.set("fulfilled_by_settlement_id", settlement.id)
            filing.set("filed_at", settlementDate); filing.set("revision", filing.getInt("revision") + 1); tx.save(filing)
            for (const candidate of filingObligations) {
              candidate.set("filing_status", "FULFILLED_BY_PAYMENT")
              if (candidate.id !== obligation.id) candidate.set("revision", candidate.getInt("revision") + 1)
              tx.save(candidate)
            }
          }
        }
      }
      for (const allocated of obligations) obligationResponses.push(helpers.obligationResponse(tx.findRecordById("tax_obligations", allocated.record.id)))
      let ledgerRevision = null
      if (transactionId && companyId) {
        const ledgerRecord = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, id: transactionId })
        ledgerRevision = ledgerRecord.getInt("revision")
      }
      response = { settlement: helpers.recordJson(settlement), obligations: obligationResponses, ledgerTransaction: ledgerPayload, ledgerRevision }
      helpers.audit(tx, tenantId, subject.id, "tax-settlement-created", command.key, "tax_settlement", settlement.id, String(body.reason || ""), null, response)
      helpers.saveCommand(tx, tenantId, "tax-settlement", command, 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-settlement", body)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/filings/{id}/complete", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event); const filingId = event.request.pathValue("id")
  const command = helpers.replayCommand($app, tenantId, "tax-filing-complete", Object.assign({}, body, { filingId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  let response
  try {
    $app.runInTransaction((tx) => {
      let filing
      try { filing = tx.findRecordById("tax_filings", filingId) } catch { throw new ApiError(404, "Tax filing not found") }
      if (filing.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax filing not found")
      const expectedRevision = Number(body.revision || 0)
      if (expectedRevision !== filing.getInt("revision")) throw new ApiError(409, "Tax filing revision is out of date")
      const before = helpers.recordJson(filing)
      filing.set("status", "FILED"); filing.set("filed_at", helpers.isoDate(body.filedAt, "filedAt"))
      filing.set("reference", String(body.reference || "").trim().slice(0, 160)); filing.set("fulfilled_by_settlement_id", "")
      filing.set("revision", filing.getInt("revision") + 1); tx.save(filing)
      const periodObligations = tx.findRecordsByFilter("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject} && period = {:period}", "", 0, 0, {
        tenant: tenantId, subject: filing.getString("subject_id"), period: filing.getString("period"),
      })
      for (const obligation of periodObligations) {
        const registration = tx.findRecordById("tax_registrations", obligation.getString("registration_id"))
        if (registration.getString("filing_group") !== filing.getString("filing_group")) continue
        obligation.set("filing_status", "FILED"); obligation.set("revision", obligation.getInt("revision") + 1); tx.save(obligation)
      }
      response = helpers.recordJson(filing)
      helpers.audit(tx, tenantId, filing.getString("subject_id"), "tax-filing-completed", command.key, "tax_filing", filing.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-filing-complete", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-filing-complete", Object.assign({}, body, { filingId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/filings/{id}/amend", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const filingId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { filingId }); const command = helpers.replayCommand($app, tenantId, "tax-filing-amend", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  const reason = String(body.reason || "").trim().slice(0, 500)
  if (!reason) throw event.badRequestError("Amendment reason is required", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      let filing
      try { filing = tx.findRecordById("tax_filings", filingId) } catch { throw new ApiError(404, "Tax filing not found") }
      if (filing.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax filing not found")
      if (Number(body.revision || 0) !== filing.getInt("revision")) throw new ApiError(409, "Tax filing revision is out of date")
      if (!["FILED", "FULFILLED_BY_PAYMENT"].includes(filing.getString("status"))) throw new ApiError(409, "Only a completed filing can be amended")
      const before = helpers.recordJson(filing)
      filing.set("status", "FILED"); filing.set("filed_at", helpers.isoDate(body.filedAt, "filedAt"))
      filing.set("reference", String(body.reference || "").trim().slice(0, 160)); filing.set("fulfilled_by_settlement_id", "")
      filing.set("amendment_number", filing.getInt("amendment_number") + 1); filing.set("amendment_reason", reason)
      filing.set("revision", filing.getInt("revision") + 1); tx.save(filing); response = helpers.recordJson(filing)
      helpers.audit(tx, tenantId, filing.getString("subject_id"), "tax-filing-amended", command.key, "tax_filing", filing.id, reason, before, response)
      helpers.saveCommand(tx, tenantId, "tax-filing-amend", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-filing-amend", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/settlements/{id}/reverse", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const settlementId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { settlementId }); const command = helpers.replayCommand($app, tenantId, "tax-settlement-reverse", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  const reason = String(body.reason || "").trim().slice(0, 500)
  if (!reason) throw event.badRequestError("Reversal reason is required", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      let settlement
      try { settlement = tx.findRecordById("tax_settlements", settlementId) } catch { throw new ApiError(404, "Tax settlement not found") }
      if (settlement.getString("tenant_id") !== tenantId) throw new ApiError(404, "Tax settlement not found")
      if (Number(body.revision || 0) !== settlement.getInt("revision")) throw new ApiError(409, "Tax settlement revision is out of date")
      if (settlement.getString("status") === "REVERSED") throw new ApiError(409, "Tax settlement is already reversed")
      const before = helpers.recordJson(settlement)
      settlement.set("status", "REVERSED"); settlement.set("reversed_at", new Date().toISOString()); settlement.set("reversal_reason", reason)
      settlement.set("revision", settlement.getInt("revision") + 1); tx.save(settlement)
      const allocations = tx.findRecordsByFilter("tax_allocations", "tenant_id = {:tenant} && settlement_id = {:settlement}", "", 0, 0, { tenant: tenantId, settlement: settlement.id })
      const affected = []
      for (const allocation of allocations) {
        const obligation = helpers.ownedObligation(tx, tenantId, allocation.getString("obligation_id"))
        const allAllocations = tx.findRecordsByFilter("tax_allocations", "tenant_id = {:tenant} && obligation_id = {:obligation}", "", 0, 0, { tenant: tenantId, obligation: obligation.id })
        let thirdParty = 0; let ownPayments = 0
        for (const item of allAllocations) {
          const source = tx.findRecordById("tax_settlements", item.getString("settlement_id"))
          if (source.getString("status") === "REVERSED") continue
          if (source.getString("settlement_type") === "THIRD_PARTY_WITHHOLDING") thirdParty += item.getInt("amount")
          else ownPayments += item.getInt("amount")
        }
        const known = obligation.getBool("has_liability_amount"); const liability = obligation.getInt("liability_amount"); const settled = thirdParty + ownPayments
        const remaining = known ? Math.max(0, liability - settled) : null; const overpaid = known ? Math.max(0, settled - liability) : 0
        const status = !known ? "UNKNOWN" : liability === 0 ? "NOT_REQUIRED" : settled === 0 ? "UNPAID" : settled < liability ? "PARTIAL" : settled === liability ? "PAID" : "OVERPAID"
        obligation.set("settled_by_third_party", thirdParty); obligation.set("allocated_payments", ownPayments)
        obligation.set("remaining_payable", remaining === null ? 0 : remaining); obligation.set("has_remaining_payable", remaining !== null)
        obligation.set("overpaid_amount", overpaid); obligation.set("payment_status", status); obligation.set("revision", obligation.getInt("revision") + 1); tx.save(obligation)
        affected.push(helpers.obligationResponse(obligation))
      }
      const filings = tx.findRecordsByFilter("tax_filings", "tenant_id = {:tenant} && fulfilled_by_settlement_id = {:settlement}", "", 0, 0, { tenant: tenantId, settlement: settlement.id })
      for (const filing of filings) { filing.set("status", "PENDING"); filing.set("fulfilled_by_settlement_id", ""); filing.set("filed_at", ""); filing.set("revision", filing.getInt("revision") + 1); tx.save(filing) }
      const companyId = settlement.getString("ledger_company_id"); const transactionId = settlement.getString("ledger_transaction_id")
      if (companyId && transactionId) {
        try {
          const transaction = tx.findFirstRecordByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company} && entity = 'transactions' && app_id = {:id}", { tenant: tenantId, company: companyId, id: transactionId })
          let payload = transaction.get("payload") || {}; try { payload = JSON.parse(transaction.getString("payload")) } catch { /* JSONMap */ }
          const plain = typeof payload.get === "function" ? JSON.parse(transaction.getString("payload")) : payload
          plain.taxObligationId = null; plain.taxKind = null; plain.taxPeriod = null; plain.notes = `${String(plain.notes || "")}\nAlokasi pajak dibatalkan: ${reason}`.trim()
          plain.updatedAt = new Date().toISOString(); transaction.set("payload", plain); transaction.set("revision", transaction.getInt("revision") + 1); tx.save(transaction)
        } catch { /* A reset ledger may already have unlinked this transaction. */ }
      }
      response = { settlement: helpers.recordJson(settlement), obligations: affected }
      helpers.audit(tx, tenantId, settlement.getString("subject_id"), "tax-settlement-reversed", command.key, "tax_settlement", settlement.id, reason, before, response)
      helpers.saveCommand(tx, tenantId, "tax-settlement-reverse", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-settlement-reverse", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/obligations/{id}/snooze", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event); const obligationId = event.request.pathValue("id")
  const command = helpers.replayCommand($app, tenantId, "tax-snooze", Object.assign({}, body, { obligationId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  let response
  try {
    $app.runInTransaction((tx) => {
      const obligation = helpers.ownedObligation(tx, tenantId, obligationId)
      const expectedRevision = Number(body.revision || 0)
      if (expectedRevision !== obligation.getInt("revision")) throw new ApiError(409, "Tax obligation revision is out of date")
      const before = helpers.obligationResponse(obligation)
      obligation.set("snoozed_until", helpers.isoDate(body.snoozedUntil, "snoozedUntil")); obligation.set("revision", obligation.getInt("revision") + 1)
      tx.save(obligation); response = helpers.obligationResponse(obligation)
      const pending = tx.findRecordsByFilter("tax_notifications", "tenant_id = {:tenant} && obligation_id = {:obligation} && (status = 'PENDING' || status = 'RETRYABLE_FAILED')", "", 0, 0, { tenant: tenantId, obligation: obligation.id })
      for (const notification of pending) { notification.set("status", "CANCELLED"); tx.save(notification) }
      helpers.audit(tx, tenantId, obligation.getString("subject_id"), "tax-reminder-snoozed", command.key, "tax_obligation", obligation.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-snooze", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-snooze", Object.assign({}, body, { obligationId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/obligations/{id}/amount", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`)
  helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event); const obligationId = event.request.pathValue("id")
  const command = helpers.replayCommand($app, tenantId, "tax-confirm-amount", Object.assign({}, body, { obligationId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  const amount = helpers.nonNegativeMoney(body.liabilityAmount, "liabilityAmount")
  const source = String(body.source || "").trim().slice(0, 160)
  if (!source) throw event.badRequestError("Amount source is required", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const obligation = helpers.ownedObligation(tx, tenantId, obligationId)
      if (Number(body.revision || 0) !== obligation.getInt("revision")) throw new ApiError(409, "Tax obligation revision is out of date")
      const before = helpers.obligationResponse(obligation)
      const settled = obligation.getInt("settled_by_third_party") + obligation.getInt("allocated_payments")
      const remaining = Math.max(0, amount - settled); const overpaid = Math.max(0, settled - amount)
      const status = amount === 0 ? "NOT_REQUIRED" : settled === 0 ? "UNPAID" : settled < amount ? "PARTIAL" : settled === amount ? "PAID" : "OVERPAID"
      obligation.set("liability_amount", amount); obligation.set("has_liability_amount", true); obligation.set("amount_state", "CONFIRMED")
      obligation.set("proposed_liability_amount", 0); obligation.set("has_proposed_liability_amount", false)
      obligation.set("remaining_payable", remaining); obligation.set("has_remaining_payable", true); obligation.set("overpaid_amount", overpaid)
      obligation.set("payment_status", status); obligation.set("data_status", "COMPLETE"); obligation.set("amount_source", source)
      obligation.set("amount_confirmed_at", new Date().toISOString()); obligation.set("revision", obligation.getInt("revision") + 1)
      tx.save(obligation); response = helpers.obligationResponse(obligation)
      helpers.audit(tx, tenantId, obligation.getString("subject_id"), "tax-amount-confirmed", command.key, "tax_obligation", obligation.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-confirm-amount", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-confirm-amount", Object.assign({}, body, { obligationId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/subjects/{id}/registrations", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const { ruleById } = require(`${__hooks}/tax_rules.js`)
  const tenantId = helpers.requestTenant(event); const subjectId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-add-registration", Object.assign({}, body, { subjectId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  const kind = String(body.kind || ""); const requestedActiveFrom = String(body.activeFrom || new Date().toISOString().slice(0, 10)); const rule = body.ruleId ? ruleById(String(body.ruleId)) : require(`${__hooks}/tax_rules.js`).ruleByKindAt(kind, requestedActiveFrom)
  if (!rule || rule.kind !== kind) throw event.badRequestError("Unsupported tax kind", {})
  const activeFrom = helpers.isoDate(body.activeFrom || new Date().toISOString().slice(0, 10), "activeFrom")
  const defaultDueDate = body.defaultDueDate ? helpers.isoDate(body.defaultDueDate, "defaultDueDate") : ""
  if (rule.manualDateRequired && rule.periodicity === "EVENT" && !defaultDueDate) throw event.badRequestError("A document due date is required", {})
  const defaultAmount = body.defaultAmount === null || body.defaultAmount === undefined || body.defaultAmount === "" ? null : helpers.nonNegativeMoney(body.defaultAmount, "defaultAmount")
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, subjectId)
      const existing = tx.findRecordsByFilter("tax_registrations", "tenant_id = {:tenant} && subject_id = {:subject} && kind = {:kind} && filing_group = {:group}", "", 0, 0, { tenant: tenantId, subject: subject.id, kind, group: rule.filingGroup })
      if (existing.some((registration) => !registration.getString("active_until") || registration.getString("active_until") >= activeFrom)) throw new ApiError(409, "Tax registration already exists for this period")
      const registration = new Record(tx.findCollectionByNameOrId("tax_registrations"), {
        tenant_id: tenantId, subject_id: subject.id, kind, label: String(body.label || rule.label).slice(0, 120),
        periodicity: rule.periodicity, filing_group: rule.filingGroup,
        amount_mode: rule.automaticAmount ? "AUTOMATIC_UMKM" : body.amountMode === "DOCUMENT" ? "DOCUMENT" : "MANUAL_CONFIRMED",
        jurisdiction: String(body.jurisdiction || "").slice(0, 120), active_from: activeFrom,
        active_until: body.activeUntil ? helpers.isoDate(body.activeUntil, "activeUntil") : "",
        default_amount: defaultAmount === null ? 0 : defaultAmount, has_default_amount: defaultAmount !== null,
        default_due_date: defaultDueDate, rule_id: rule.id, revision: 1,
      })
      tx.save(registration); response = helpers.recordJson(registration)
      helpers.audit(tx, tenantId, subject.id, "tax-registration-created", command.key, "tax_registration", registration.id, String(body.reason || ""), null, response)
      helpers.saveCommand(tx, tenantId, "tax-add-registration", command, 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-add-registration", Object.assign({}, body, { subjectId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/registrations/{id}/end", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const registrationId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { registrationId }); const command = helpers.replayCommand($app, tenantId, "tax-end-registration", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  const activeUntil = helpers.isoDate(body.activeUntil, "activeUntil")
  let response
  try {
    $app.runInTransaction((tx) => {
      const registration = helpers.ownedRegistration(tx, tenantId, registrationId)
      if (Number(body.revision || 0) !== registration.getInt("revision")) throw new ApiError(409, "Registration revision is out of date")
      if (activeUntil < registration.getString("active_from").slice(0, 10)) throw new ApiError(400, "End date precedes start date")
      const before = helpers.recordJson(registration); registration.set("active_until", activeUntil); registration.set("revision", registration.getInt("revision") + 1); tx.save(registration)
      const future = tx.findRecordsByFilter("tax_obligations", "tenant_id = {:tenant} && registration_id = {:registration} && period > {:period}", "", 0, 0, { tenant: tenantId, registration: registration.id, period: activeUntil.slice(0, 7) })
      for (const obligation of future) { obligation.set("data_status", "NEEDS_RECONCILIATION"); obligation.set("revision", obligation.getInt("revision") + 1); tx.save(obligation) }
      response = helpers.recordJson(registration)
      helpers.audit(tx, tenantId, registration.getString("subject_id"), "tax-registration-ended", command.key, "tax_registration", registration.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-end-registration", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-end-registration", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/obligations/{id}/deadline", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const obligationId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { obligationId }); const command = helpers.replayCommand($app, tenantId, "tax-deadline-override", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  const source = String(body.source || "").trim().slice(0, 240); const reference = String(body.reference || "").trim().slice(0, 240)
  if (!source || !reference) throw event.badRequestError("Deadline source and reference are required", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const obligation = helpers.ownedObligation(tx, tenantId, obligationId)
      if (Number(body.revision || 0) !== obligation.getInt("revision")) throw new ApiError(409, "Tax obligation revision is out of date")
      const before = helpers.obligationResponse(obligation)
      obligation.set("effective_due_date", helpers.isoDate(body.effectiveDueDate, "effectiveDueDate"))
      obligation.set("penalty_relief_until", body.penaltyReliefUntil ? helpers.isoDate(body.penaltyReliefUntil, "penaltyReliefUntil") : "")
      obligation.set("deadline_source", source); obligation.set("deadline_reference", reference); obligation.set("deadline_status", "USER_CONFIRMED"); obligation.set("revision", obligation.getInt("revision") + 1); tx.save(obligation)
      response = helpers.obligationResponse(obligation)
      const pending = tx.findRecordsByFilter("tax_notifications", "tenant_id = {:tenant} && obligation_id = {:obligation} && (status = 'PENDING' || status = 'RETRYABLE_FAILED')", "", 0, 0, { tenant: tenantId, obligation: obligation.id })
      for (const notification of pending) { notification.set("status", "CANCELLED"); tx.save(notification) }
      helpers.audit(tx, tenantId, obligation.getString("subject_id"), "tax-deadline-overridden", command.key, "tax_obligation", obligation.id, String(body.reason || source), before, response)
      helpers.saveCommand(tx, tenantId, "tax-deadline-override", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-deadline-override", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/tax/subjects/{id}", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const subjectId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const command = helpers.replayCommand($app, tenantId, "tax-update-subject", Object.assign({}, body, { subjectId }))
  if (command.response) return event.json(command.response.status, command.response.body)
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, subjectId)
      if (Number(body.revision || 0) !== subject.getInt("revision")) throw new ApiError(409, "Tax subject revision is out of date")
      const before = helpers.subjectResponse(subject)
      if (body.label !== undefined) {
        const label = String(body.label || "").trim().slice(0, 100); if (!label) throw new ApiError(400, "Subject label is required")
        subject.set("label", label)
      }
      if (body.status !== undefined) {
        if (!["ACTIVE", "INACTIVE"].includes(String(body.status))) throw new ApiError(400, "Invalid tax subject status")
        subject.set("status", String(body.status))
      }
      if (body.umkmEligibility !== undefined) {
        if (!["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"].includes(String(body.umkmEligibility))) throw new ApiError(400, "Invalid UMKM eligibility")
        subject.set("umkm_eligibility", String(body.umkmEligibility)); subject.set("umkm_eligibility_effective_from", body.umkmEligibilityEffectiveFrom ? helpers.isoDate(body.umkmEligibilityEffectiveFrom, "umkmEligibilityEffectiveFrom") : "")
      }
      subject.set("revision", subject.getInt("revision") + 1); tx.save(subject); response = helpers.subjectResponse(subject)
      if (subject.getString("status") === "INACTIVE") {
        const pending = tx.findRecordsByFilter("tax_notifications", "tenant_id = {:tenant} && subject_id = {:subject} && (status = 'PENDING' || status = 'RETRYABLE_FAILED')", "", 0, 0, { tenant: tenantId, subject: subject.id })
        for (const notification of pending) { notification.set("status", "CANCELLED"); tx.save(notification) }
      }
      helpers.audit(tx, tenantId, subject.id, "tax-subject-updated", command.key, "tax_subject", subject.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-update-subject", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-update-subject", Object.assign({}, body, { subjectId }))
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/tax/preferences/{id}", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const preferenceId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { preferenceId }); const command = helpers.replayCommand($app, tenantId, "tax-update-preference", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  let response
  try {
    $app.runInTransaction((tx) => {
      let preference
      try { preference = tx.findRecordById("tax_notification_preferences", preferenceId) } catch { throw new ApiError(404, "Tax notification preference not found") }
      if (preference.getString("tenant_id") !== tenantId || preference.getString("recipient_user_id") !== event.auth.id) throw new ApiError(404, "Tax notification preference not found")
      if (Number(body.revision || 0) !== preference.getInt("revision")) throw new ApiError(409, "Preference revision is out of date")
      const before = helpers.recordJson(preference)
      if (body.inAppEnabled !== undefined) preference.set("in_app_enabled", body.inAppEnabled === true)
      if (body.emailEnabled !== undefined) preference.set("email_enabled", body.emailEnabled === true)
      if (body.includeAmountInEmail !== undefined) preference.set("include_amount_in_email", body.includeAmountInEmail === true)
      if (body.deliveryHour !== undefined) {
        const hour = Number(body.deliveryHour); if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new ApiError(400, "Invalid delivery hour")
        preference.set("delivery_hour", hour)
      }
      preference.set("revision", preference.getInt("revision") + 1); tx.save(preference); response = helpers.recordJson(preference)
      helpers.audit(tx, tenantId, preference.getString("subject_id"), "tax-preference-updated", command.key, "tax_notification_preference", preference.id, String(body.reason || ""), before, response)
      helpers.saveCommand(tx, tenantId, "tax-update-preference", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-update-preference", commandBody)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("PUT", "/api/jornal/tax/subjects/{id}/preferences/me", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const subjectId = event.request.pathValue("id"); const body = helpers.jsonBody(event)
  const commandBody = Object.assign({}, body, { subjectId }); const command = helpers.replayCommand($app, tenantId, "tax-own-preference", commandBody)
  if (command.response) return event.json(command.response.status, command.response.body)
  let response; let status = 201
  $app.runInTransaction((tx) => {
    helpers.ownedSubject(tx, tenantId, subjectId)
    let preference
    try { preference = tx.findFirstRecordByFilter("tax_notification_preferences", "tenant_id = {:tenant} && subject_id = {:subject} && recipient_user_id = {:recipient}", { tenant: tenantId, subject: subjectId, recipient: event.auth.id }); status = 200 } catch {
      preference = new Record(tx.findCollectionByNameOrId("tax_notification_preferences"), { tenant_id: tenantId, recipient_user_id: event.auth.id, subject_id: subjectId, subject_key: subjectId, revision: 0 })
    }
    const hour = Number(body.deliveryHour ?? 9); if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new ApiError(400, "Invalid delivery hour")
    preference.set("in_app_enabled", body.inAppEnabled === true); preference.set("email_enabled", body.emailEnabled === true); preference.set("include_amount_in_email", body.includeAmountInEmail === true)
    preference.set("timezone", String(body.timezone || "Asia/Jakarta").slice(0, 60)); preference.set("delivery_hour", hour)
    preference.set("monthly_offsets", Array.isArray(body.monthlyOffsets) ? body.monthlyOffsets : [7, 3, 1, 0]); preference.set("annual_offsets", Array.isArray(body.annualOffsets) ? body.annualOffsets : [30, 14, 7, 3, 1, 0]); preference.set("overdue_weekly_limit", Number(body.overdueWeeklyLimit ?? 4)); preference.set("revision", preference.getInt("revision") + 1); tx.save(preference)
    response = helpers.recordJson(preference); helpers.audit(tx, tenantId, subjectId, status === 201 ? "tax-preference-created" : "tax-preference-updated", command.key, "tax_notification_preference", preference.id, String(body.reason || ""), null, response); helpers.saveCommand(tx, tenantId, "tax-own-preference", command, status, response)
  })
  return event.json(status, response)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/subjects/{id}/evidence", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const subject = helpers.ownedSubject($app, tenantId, event.request.pathValue("id"))
  const items = $app.findRecordsByFilter("tax_evidence", "tenant_id = {:tenant} && subject_id = {:subject}", "-created", 200, 0, { tenant: tenantId, subject: subject.id }).map((record) => {
    const result = helpers.recordJson(record); delete result.document; return result
  })
  return event.json(200, { items })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/evidence", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event); const command = helpers.replayCommand($app, tenantId, "tax-evidence-upload", body)
  if (command.response) return event.json(command.response.status, command.response.body)
  const parentType = String(body.parentType || ""); const parentId = String(body.parentId || "")
  const collections = { obligation: "tax_obligations", filing: "tax_filings", settlement: "tax_settlements", registration: "tax_registrations" }
  const collectionName = collections[parentType]
  if (!collectionName || !parentId) throw event.badRequestError("Invalid evidence parent", {})
  const files = event.findUploadedFiles("document")
  if (files.length !== 1 || !files[0]) throw event.badRequestError("Exactly one evidence file is required", {})
  const file = files[0]
  if (file.size <= 0 || file.size > 10_485_760) throw event.badRequestError("Evidence must be between 1 byte and 10 MB", {})
  const suppliedHash = String(body.sha256 || "").toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(suppliedHash)) throw event.badRequestError("A SHA-256 checksum is required", {})
  let response
  try {
    $app.runInTransaction((tx) => {
      const subject = helpers.ownedSubject(tx, tenantId, body.subjectId)
      let parent
      try { parent = tx.findRecordById(collectionName, parentId) } catch { throw new ApiError(404, "Evidence parent not found") }
      if (parent.getString("tenant_id") !== tenantId || parent.getString("subject_id") !== subject.id) throw new ApiError(404, "Evidence parent not found")
      const evidence = new Record(tx.findCollectionByNameOrId("tax_evidence"), {
        tenant_id: tenantId, subject_id: subject.id, parent_type: parentType, parent_id: parent.id,
        document: file, original_name: String(file.originalName || file.name || "bukti").slice(0, 180), sha256: suppliedHash,
      })
      tx.save(evidence); response = helpers.recordJson(evidence); delete response.document
      helpers.audit(tx, tenantId, subject.id, "tax-evidence-uploaded", command.key, "tax_evidence", evidence.id, String(body.reason || ""), null, response)
      helpers.saveCommand(tx, tenantId, "tax-evidence-upload", command, 201, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-evidence-upload", body)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(201, response)
}, $apis.bodyLimit(11_000_000), $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/evidence/{id}/download", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); let evidence
  try { evidence = $app.findRecordById("tax_evidence", event.request.pathValue("id")) } catch { throw event.notFoundError("Tax evidence not found", {}) }
  if (evidence.getString("tenant_id") !== tenantId) throw event.notFoundError("Tax evidence not found", {})
  const filename = evidence.getString("document"); if (!filename) throw event.notFoundError("Tax evidence file not found", {})
  const fs = $app.newFilesystem()
  try { return fs.serve(event.response, event.request, `${evidence.baseFilesPath()}/${filename}`, evidence.getString("original_name")) }
  finally { fs.close() }
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/subjects/{id}/report/{year}", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const subject = helpers.ownedSubject($app, tenantId, event.request.pathValue("id"))
  const year = String(event.request.pathValue("year") || "")
  if (!/^\d{4}$/.test(year)) throw event.badRequestError("Invalid report year", {})
  const safeCell = (value) => {
    let text = String(value === null || value === undefined ? "" : value).replaceAll('"', '""')
    if (/^[=+\-@]/.test(text)) text = `'${text}`
    return `"${text}"`
  }
  const rows = [["jenis", "masa", "nominal_terutang", "dibayar_sendiri", "dipotong_pihak_lain", "sisa", "status_bayar", "status_lapor", "jatuh_tempo", "sumber_nominal"]]
  const obligations = $app.findRecordsByFilter("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject}", "period,kind", 0, 0, { tenant: tenantId, subject: subject.id }).filter((item) => item.getString("period").startsWith(year))
  for (const obligation of obligations) rows.push([
    obligation.getString("kind"), obligation.getString("period"), obligation.getBool("has_liability_amount") ? obligation.getInt("liability_amount") : "",
    obligation.getInt("allocated_payments"), obligation.getInt("settled_by_third_party"), obligation.getBool("has_remaining_payable") ? obligation.getInt("remaining_payable") : "",
    obligation.getString("payment_status"), obligation.getString("filing_status"), String(obligation.getString("effective_due_date") || "").slice(0, 10), obligation.getString("amount_source"),
  ])
  const csv = `\ufeff${rows.map((row) => row.map(safeCell).join(",")).join("\r\n")}\r\n`
  return event.blob(200, "text/csv; charset=utf-8", csv)
}, $apis.requireAuth())

routerAdd("GET", "/api/jornal/tax/export", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event)
  const query = event.request.url.query(); const requestedSubject = String(query.get("subjectId") || "")
  if (!requestedSubject && event.auth.id !== tenantId) throw new ApiError(400, "subjectId wajib diisi untuk company bersama")
  if (requestedSubject) helpers.ownedSubject($app, tenantId, requestedSubject)
  const collections = ["tax_subjects", "tax_company_memberships", "tax_registrations", "tax_period_inputs", "tax_obligations", "tax_filings", "tax_settlements", "tax_allocations", "tax_evidence", "tax_notification_preferences", "tax_audit"]
  const data = {}; const checksums = {}
  for (const name of collections) {
    const records = $app.findRecordsByFilter(name, "tenant_id = {:tenant}", "created", 0, 0, { tenant: tenantId }).filter((record) => {
      if (!requestedSubject) return true
      if (name === "tax_subjects") return record.id === requestedSubject
      return !record.getString("subject_id") || record.getString("subject_id") === requestedSubject
    }).map((record) => {
      const exported = JSON.parse(JSON.stringify(helpers.recordJson(record)))
      delete exported.collectionId; delete exported.collectionName
      if (name === "tax_notification_preferences") { exported.email_enabled = false; exported.in_app_enabled = false }
      if (name === "tax_filings") exported.obligation_ids = helpers.jsonArray(record, "obligation_ids")
      if (name === "tax_evidence") delete exported.document
      return exported
    })
    data[name] = records; checksums[name] = $security.sha256(helpers.stableStringify(records))
  }
  return event.json(200, {
    manifest: { format: "jornal-tax-backup", version: 1, exportedAt: new Date().toISOString(), subjectId: requestedSubject || null, notificationsEnabled: false, evidenceFilesIncluded: false },
    checksums, data,
  })
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/import/preview", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const backup = helpers.validateBackup(helpers.jsonBody(event).backup)
  const allowed = ["tax_subjects", "tax_company_memberships", "tax_registrations", "tax_period_inputs", "tax_obligations", "tax_filings", "tax_settlements", "tax_allocations", "tax_evidence", "tax_notification_preferences", "tax_audit"]
  const counts = {}; for (const name of allowed) counts[name] = Array.isArray(backup.data[name]) ? backup.data[name].length : 0
  const existing = $app.findRecordsByFilter("tax_subjects", "tenant_id = {:tenant}", "", 0, 0, { tenant: tenantId })
  const subjects = (backup.data.tax_subjects || []).map((item) => ({
    sourceId: String(item.id || ""), label: String(item.label || ""),
    action: existing.some((record) => record.id === String(item.id || "") || (record.getString("label") === String(item.label || "") && record.getString("subject_type") === String(item.subject_type || ""))) ? "MERGE" : "CREATE",
  }))
  const sourceCompanyIds = [...new Set((backup.data.tax_company_memberships || []).map((item) => String(item.company_id || "")).filter(Boolean))]
  return event.json(200, { valid: true, counts, subjects, sourceCompanyIds, notificationOptInsWillBeDisabled: true, evidenceFilesIncluded: backup.manifest.evidenceFilesIncluded === true, warnings: ["Relasi transaksi ledger tidak dipulihkan otomatis.", "File bukti perlu diunggah kembali bila tidak disertakan dalam backup."] })
}, $apis.bodyLimit(12_000_000), $apis.requireAuth())

routerAdd("POST", "/api/jornal/tax/import", (event) => {
  const helpers = require(`${__hooks}/tax_helpers.js`); helpers.requireTaxEnabled()
  const tenantId = helpers.requestTenant(event); const body = helpers.jsonBody(event); const backup = helpers.validateBackup(body.backup)
  if (body.confirm !== true) throw event.badRequestError("Restore confirmation is required", {})
  const restoreSignature = { commandKey: body.commandKey, backupChecksum: $security.sha256(helpers.stableStringify(backup.checksums)), companyMap: body.companyMap || {}, confirm: true }
  const command = helpers.replayCommand($app, tenantId, "tax-import", restoreSignature)
  if (command.response) return event.json(command.response.status, command.response.body)
  let response
  try {
    $app.runInTransaction((tx) => {
      const maps = { subjects: {}, registrations: {}, obligations: {}, filings: {}, settlements: {} }
      const counts = { created: 0, merged: 0, skipped: 0 }
      const source = (name) => Array.isArray(backup.data[name]) ? backup.data[name] : []
      const findOne = (name, filter, params) => { try { return tx.findFirstRecordByFilter(name, filter, params) } catch { return null } }
      const assign = (record, input, fields) => { for (const field of fields) if (input[field] !== undefined && input[field] !== null) record.set(field, input[field]) }

      for (const item of source("tax_subjects")) {
        let subject = null
        try { const byId = tx.findRecordById("tax_subjects", String(item.id || "")); if (byId.getString("tenant_id") === tenantId) subject = byId } catch { /* create or natural match */ }
        if (!subject) subject = findOne("tax_subjects", "tenant_id = {:tenant} && label = {:label} && subject_type = {:type}", { tenant: tenantId, label: String(item.label || ""), type: String(item.subject_type || "") })
        if (subject) counts.merged += 1
        else {
          subject = new Record(tx.findCollectionByNameOrId("tax_subjects"), { tenant_id: tenantId })
          assign(subject, item, ["label", "subject_type", "entity_form", "masked_tax_id", "fiscal_year_start_month", "fiscal_year_start_day", "timezone", "status", "umkm_eligibility", "umkm_eligibility_effective_from", "eligibility_answers", "revision"])
          if (!subject.getInt("revision")) subject.set("revision", 1)
          tx.save(subject); counts.created += 1
        }
        maps.subjects[String(item.id || "")] = subject.id
      }
      for (const item of source("tax_company_memberships")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        const companyId = String((body.companyMap || {})[String(item.company_id || "")] || item.company_id || ""); try { helpers.ownedCompany(tx, tenantId, companyId, false) } catch { counts.skipped += 1; continue }
        const existing = findOne("tax_company_memberships", "tenant_id = {:tenant} && subject_id = {:subject} && company_id = {:company} && effective_from = {:start}", { tenant: tenantId, subject: subjectId, company: companyId, start: String(item.effective_from || "").slice(0, 10) })
        if (existing) { counts.merged += 1; continue }
        const start = String(item.effective_from || "").slice(0, 10); const end = String(item.effective_until || "").slice(0, 10)
        const companyMemberships = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
        if (companyMemberships.some((record) => record.getString("effective_from").slice(0, 10) <= (end || "9999-12-31") && (!record.getString("effective_until") || record.getString("effective_until").slice(0, 10) >= start))) throw new ApiError(409, "Restored company membership would overlap; adjust companyMap")
        const record = new Record(tx.findCollectionByNameOrId("tax_company_memberships"), { tenant_id: tenantId, subject_id: subjectId, company_id: companyId })
        assign(record, item, ["effective_from", "effective_until", "revision"]); if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
      }
      for (const item of source("tax_registrations")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        let record = findOne("tax_registrations", "tenant_id = {:tenant} && subject_id = {:subject} && kind = {:kind} && filing_group = {:group} && jurisdiction = {:jurisdiction} && active_from = {:start}", { tenant: tenantId, subject: subjectId, kind: String(item.kind || ""), group: String(item.filing_group || ""), jurisdiction: String(item.jurisdiction || ""), start: String(item.active_from || "").slice(0, 10) })
        if (record) counts.merged += 1
        else {
          record = new Record(tx.findCollectionByNameOrId("tax_registrations"), { tenant_id: tenantId, subject_id: subjectId })
          assign(record, item, ["kind", "label", "periodicity", "filing_group", "amount_mode", "jurisdiction", "active_from", "active_until", "default_amount", "has_default_amount", "default_due_date", "rule_id", "revision"])
          if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
        }
        maps.registrations[String(item.id || "")] = record.id
      }
      for (const item of source("tax_period_inputs")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        const companyId = String((body.companyMap || {})[String(item.company_id || "")] || item.company_id || ""); if (companyId) { try { helpers.ownedCompany(tx, tenantId, companyId, false) } catch { counts.skipped += 1; continue } }
        const key = companyId || "external"; const existing = findOne("tax_period_inputs", "tenant_id = {:tenant} && subject_id = {:subject} && company_key = {:key} && period = {:period}", { tenant: tenantId, subject: subjectId, key, period: String(item.period || "") })
        if (existing) { counts.merged += 1; continue }
        const record = new Record(tx.findCollectionByNameOrId("tax_period_inputs"), { tenant_id: tenantId, subject_id: subjectId, company_id: companyId, company_key: key })
        assign(record, item, ["period", "taxable_revenue", "external_revenue", "opening_ytd_revenue", "adjustments", "data_status", "source_revision", "data_epoch", "fingerprint", "confirmed_at"]); tx.save(record); counts.created += 1
      }
      for (const item of source("tax_obligations")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; const registrationId = maps.registrations[String(item.registration_id || "")]
        if (!subjectId || !registrationId) { counts.skipped += 1; continue }
        let record = findOne("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject} && registration_id = {:registration} && period = {:period} && component = {:component}", { tenant: tenantId, subject: subjectId, registration: registrationId, period: String(item.period || ""), component: String(item.component || "") })
        if (record) counts.merged += 1
        else {
          record = new Record(tx.findCollectionByNameOrId("tax_obligations"), { tenant_id: tenantId, subject_id: subjectId, registration_id: registrationId })
          assign(record, item, ["kind", "component", "period", "currency", "amount_state", "liability_amount", "has_liability_amount", "proposed_liability_amount", "has_proposed_liability_amount", "settled_by_third_party", "allocated_payments", "remaining_payable", "has_remaining_payable", "overpaid_amount", "payment_status", "filing_status", "data_status", "statutory_due_date", "effective_due_date", "penalty_relief_until", "snoozed_until", "deadline_source", "deadline_reference", "deadline_status", "rule_id", "rule_version", "input_fingerprint", "amount_source", "amount_confirmed_at", "revision"])
          if (!record.getString("deadline_status")) record.set("deadline_status", "PROVISIONAL")
          if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
        }
        maps.obligations[String(item.id || "")] = record.id
      }
      for (const item of source("tax_filings")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        let record = findOne("tax_filings", "tenant_id = {:tenant} && subject_id = {:subject} && filing_group = {:group} && period = {:period} && registration_key = {:key}", { tenant: tenantId, subject: subjectId, group: String(item.filing_group || ""), period: String(item.period || ""), key: String(item.registration_key || "subject") })
        if (record) counts.merged += 1
        else {
          record = new Record(tx.findCollectionByNameOrId("tax_filings"), { tenant_id: tenantId, subject_id: subjectId, registration_key: String(item.registration_key || "subject") })
          assign(record, item, ["filing_group", "period", "status", "statutory_due_date", "effective_due_date", "deadline_source", "deadline_status", "filed_at", "reference", "amendment_number", "amendment_reason", "revision"])
          if (!record.getString("deadline_status")) record.set("deadline_status", "PROVISIONAL")
          const sourceIds = Array.isArray(item.obligation_ids) ? item.obligation_ids : []
          const mappedIds = sourceIds.map((id) => maps.obligations[String(id)]).filter(Boolean)
          if (sourceIds.length > 0 && mappedIds.length === 0) throw new ApiError(400, `Unable to map filing obligations: ${helpers.stableStringify(sourceIds)}`)
          record.set("obligation_ids", mappedIds); record.set("fulfilled_by_settlement_id", "")
          if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
        }
        maps.filings[String(item.id || "")] = record.id
      }
      for (const item of source("tax_settlements")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        let record = findOne("tax_settlements", "tenant_id = {:tenant} && subject_id = {:subject} && settlement_date = {:date} && amount = {:amount} && reference = {:reference}", { tenant: tenantId, subject: subjectId, date: String(item.settlement_date || "").slice(0, 10), amount: Number(item.amount || 0), reference: String(item.reference || "") })
        if (record) counts.merged += 1
        else {
          record = new Record(tx.findCollectionByNameOrId("tax_settlements"), { tenant_id: tenantId, subject_id: subjectId, ledger_company_id: "", ledger_transaction_id: "" })
          assign(record, item, ["settlement_type", "amount", "settlement_date", "reference", "source", "revision", "status", "reversed_at", "reversal_reason"])
          if (!record.getString("status")) record.set("status", "ACTIVE"); if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
        }
        maps.settlements[String(item.id || "")] = record.id
      }
      for (const item of source("tax_allocations")) {
        const settlementId = maps.settlements[String(item.settlement_id || "")]; const obligationId = maps.obligations[String(item.obligation_id || "")]
        if (!settlementId || !obligationId) { counts.skipped += 1; continue }
        if (findOne("tax_allocations", "tenant_id = {:tenant} && settlement_id = {:settlement} && obligation_id = {:obligation}", { tenant: tenantId, settlement: settlementId, obligation: obligationId })) { counts.merged += 1; continue }
        tx.save(new Record(tx.findCollectionByNameOrId("tax_allocations"), { tenant_id: tenantId, settlement_id: settlementId, obligation_id: obligationId, amount: Number(item.amount || 0) })); counts.created += 1
      }
      for (const item of source("tax_notification_preferences")) {
        const subjectId = maps.subjects[String(item.subject_id || "")]; if (!subjectId) { counts.skipped += 1; continue }
        const existing = findOne("tax_notification_preferences", "tenant_id = {:tenant} && subject_key = {:key}", { tenant: tenantId, key: subjectId })
        if (existing) { counts.merged += 1; continue }
        const record = new Record(tx.findCollectionByNameOrId("tax_notification_preferences"), { tenant_id: tenantId, subject_id: subjectId, subject_key: subjectId, in_app_enabled: false, email_enabled: false, include_amount_in_email: false })
        assign(record, item, ["timezone", "delivery_hour", "monthly_offsets", "annual_offsets", "overdue_weekly_limit", "revision"]); if (!record.getInt("revision")) record.set("revision", 1); tx.save(record); counts.created += 1
      }
      response = { restored: true, counts, notificationOptInsDisabled: true, evidenceFilesRestored: false }
      helpers.audit(tx, tenantId, "", "tax-backup-restored", command.key, "tax_backup", "", String(body.reason || "Restore backup pajak"), null, response)
      helpers.saveCommand(tx, tenantId, "tax-import", command, 200, response)
    })
  } catch (error) {
    const replay = helpers.replayCommand($app, tenantId, "tax-import", restoreSignature)
    if (replay.response) return event.json(replay.response.status, replay.response.body)
    throw error
  }
  return event.json(200, response)
}, $apis.bodyLimit(12_000_000), $apis.requireAuth())

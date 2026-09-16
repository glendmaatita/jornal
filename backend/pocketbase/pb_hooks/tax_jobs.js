function taxDateOnly(value) { return String(value || "").slice(0, 10) }

function taxScheduledAt(dateText, hour, timezone) {
  const offsets = { "Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9 }
  const offset = offsets[timezone] || 7
  const parts = dateText.split("-").map(Number)
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], Number(hour || 9) - offset, 0, 0)).toISOString()
}

function taxShiftDate(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function taxJsonArray(record, field, fallback) {
  try {
    const plain = JSON.parse(JSON.stringify(record.publicExport()))
    if (Array.isArray(plain[field])) {
      if (plain[field].every((item) => typeof item === "number")) {
        const decoded = JSON.parse(String.fromCharCode(...plain[field])); return Array.isArray(decoded) ? decoded.map(Number).filter(Number.isFinite) : fallback
      }
      return plain[field].map(Number).filter(Number.isFinite)
    }
    if (typeof plain[field] === "string") { const decoded = JSON.parse(plain[field]); return Array.isArray(decoded) ? decoded.map(Number).filter(Number.isFinite) : fallback }
    return fallback
  } catch { return fallback }
}

function taxPreference(subjectId, tenantId) {
  try { return $app.findFirstRecordByFilter("tax_notification_preferences", "tenant_id = {:tenant} && subject_id = {:subject}", { tenant: tenantId, subject: subjectId }) } catch { return null }
}

function taxFiscalYearEnd(subject, year) {
  const nextStart = new Date(Date.UTC(year + 1, subject.getInt("fiscal_year_start_month") - 1, subject.getInt("fiscal_year_start_day")))
  nextStart.setUTCDate(nextStart.getUTCDate() - 1)
  return nextStart.toISOString().slice(0, 10)
}

function taxEnsurePeriod(subject, period, periodicity) {
  const rules = require(`${__hooks}/tax_rules.js`)
  const calendar = require(`${__hooks}/tax_calendar.js`)
  const tenantId = subject.getString("tenant_id"); const year = Number(period.slice(0, 4)); const fiscalYearEnd = taxFiscalYearEnd(subject, year)
  const registrations = $app.findRecordsByFilter("tax_registrations", "tenant_id = {:tenant} && subject_id = {:subject} && periodicity = {:periodicity}", "created", 0, 0, {
    tenant: tenantId, subject: subject.id, periodicity,
  }).filter((registration) => registration.getString("active_from").slice(0, period.length) <= period && (!registration.getString("active_until") || registration.getString("active_until").slice(0, period.length) >= period))
  const groups = {}
  for (const registration of registrations) {
    const ruleDate = period.length === 7 ? `${period}-01` : `${period}-12-31`
    const rule = rules.ruleByKindAt(registration.getString("kind"), ruleDate) || rules.ruleById(registration.getString("rule_id")); if (!rule) continue
    let filingDue = registration.getString("default_due_date") || rules.dueDate(rule.filingDueRule, period, fiscalYearEnd, null) || ""
    let paymentDue = registration.getString("default_due_date") || rules.dueDate(rule.paymentDueRule, period, fiscalYearEnd, filingDue) || ""
    if (rule.paymentDueRule === "BEFORE_FILING" && !paymentDue) {
      const annualKind = subject.getString("subject_type") === "INDIVIDUAL" ? "SPT_ANNUAL_INDIVIDUAL" : "SPT_ANNUAL_ENTITY"
      const annualRule = rules.RULES.find((candidate) => candidate.kind === annualKind)
      paymentDue = annualRule ? rules.dueDate(annualRule.filingDueRule, period, fiscalYearEnd, null) || "" : ""
    }
    const documentDate = registration.getString("periodicity") === "EVENT"
    const paymentCalendar = documentDate ? { date: paymentDue || filingDue, status: "USER_CONFIRMED", source: "Tanggal dokumen dikonfirmasi pengguna" } : calendar.adjustDueDate(paymentDue || filingDue)
    const filingCalendar = documentDate ? { date: filingDue, status: "USER_CONFIRMED", source: "Tanggal dokumen dikonfirmasi pengguna" } : calendar.adjustDueDate(filingDue)
    let obligation
    try { obligation = $app.findFirstRecordByFilter("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject} && registration_id = {:registration} && period = {:period} && component = 'PRIMARY'", { tenant: tenantId, subject: subject.id, registration: registration.id, period }) } catch { obligation = null }
    if (!obligation) {
      const known = registration.getBool("has_default_amount"); const liability = known ? registration.getInt("default_amount") : 0
      const isReturnOnly = ["SPT_ANNUAL_INDIVIDUAL", "SPT_ANNUAL_ENTITY"].includes(registration.getString("kind"))
      obligation = new Record($app.findCollectionByNameOrId("tax_obligations"), {
        tenant_id: tenantId, subject_id: subject.id, registration_id: registration.id, kind: registration.getString("kind"),
        component: "PRIMARY", period, currency: "IDR", amount_state: known ? "CONFIRMED" : "UNKNOWN",
        liability_amount: liability, has_liability_amount: known, settled_by_third_party: 0, allocated_payments: 0,
        remaining_payable: liability, has_remaining_payable: known, overpaid_amount: 0,
        payment_status: isReturnOnly ? "NOT_REQUIRED" : known ? (liability === 0 ? "NOT_REQUIRED" : "NOT_DUE") : "UNKNOWN",
        filing_status: rule.filingDueRule ? "PENDING" : "NOT_REQUIRED", data_status: known ? "COMPLETE" : "INCOMPLETE",
        statutory_due_date: paymentDue || filingDue, effective_due_date: paymentCalendar.date || "",
        deadline_status: paymentCalendar.status, deadline_source: paymentCalendar.source,
        rule_id: rule.id, rule_version: rule.version, amount_source: known ? "Nilai default terkonfirmasi" : "",
        amount_confirmed_at: known ? new Date().toISOString() : "", revision: 1,
      })
      $app.save(obligation)
    }
    if (rule.filingDueRule) {
      if (!groups[rule.filingGroup]) groups[rule.filingGroup] = { statutoryDue: filingDue, due: filingCalendar.date || "", deadlineStatus: filingCalendar.status, deadlineSource: filingCalendar.source, ids: [] }
      groups[rule.filingGroup].ids.push(obligation.id)
    }
  }
  for (const groupName of Object.keys(groups)) {
    const group = groups[groupName]; let filing
    try { filing = $app.findFirstRecordByFilter("tax_filings", "tenant_id = {:tenant} && subject_id = {:subject} && filing_group = {:group} && period = {:period} && registration_key = 'subject'", { tenant: tenantId, subject: subject.id, group: groupName, period }) } catch { filing = null }
    if (!filing) {
      filing = new Record($app.findCollectionByNameOrId("tax_filings"), {
        tenant_id: tenantId, subject_id: subject.id, filing_group: groupName, period, registration_key: "subject",
        obligation_ids: [...new Set(group.ids)], status: "PENDING", statutory_due_date: group.statutoryDue, effective_due_date: group.due,
        deadline_status: group.deadlineStatus, deadline_source: group.deadlineSource, revision: 1,
      })
      $app.save(filing)
    } else {
      const helpers = require(`${__hooks}/tax_helpers.js`)
      const obligationIds = [...new Set(group.ids)]
      const existingIds = helpers.jsonArray(filing, "obligation_ids").sort()
      if (JSON.stringify(existingIds) !== JSON.stringify([...obligationIds].sort())) {
        filing.set("obligation_ids", obligationIds); filing.set("revision", filing.getInt("revision") + 1); $app.save(filing)
      }
    }
  }
}

function taxGenerateUpcomingObligations() {
  if ($os.getenv("JORNAL_TAX_COMPLIANCE_ENABLED") === "false") return
  const jakarta = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const year = jakarta.getUTCFullYear(); const month = jakarta.getUTCMonth() + 1
  const currentPeriod = `${year}-${String(month).padStart(2, "0")}`
  const previousDate = new Date(Date.UTC(year, month - 2, 1))
  const previousPeriod = `${previousDate.getUTCFullYear()}-${String(previousDate.getUTCMonth() + 1).padStart(2, "0")}`
  const subjects = $app.findRecordsByFilter("tax_subjects", "status = 'ACTIVE'", "created", 500, 0)
  for (const subject of subjects) {
    taxEnsurePeriod(subject, currentPeriod, "MONTHLY")
    taxEnsurePeriod(subject, previousPeriod, "MONTHLY")
    taxEnsurePeriod(subject, String(year), "ANNUAL")
    if (month <= 4) taxEnsurePeriod(subject, String(year - 1), "ANNUAL")
    taxEnsurePeriod(subject, String(year), "EVENT")
  }
}

function taxCancelOldSchedules(tenantId, obligationId, filingId, action, channel, scheduleVersion) {
  const filters = ["tenant_id = {:tenant}", "action = {:action}", "channel = {:channel}", "status = 'PENDING'"]
  const params = { tenant: tenantId, action, channel }
  if (obligationId) { filters.push("obligation_id = {:target}"); params.target = obligationId }
  else { filters.push("filing_id = {:target}"); params.target = filingId }
  const existing = $app.findRecordsByFilter("tax_notifications", filters.join(" && "), "", 0, 0, params)
  for (const record of existing) if (record.getString("schedule_version") !== scheduleVersion) {
    record.set("status", "CANCELLED"); $app.save(record)
  }
}

function taxEnsureNotification(input) {
  const dedupeKey = [input.tenantId, input.subjectId, input.obligationId || input.filingId, input.action, input.channel, input.marker, input.scheduleVersion].join(":")
  try {
    const existing = $app.findFirstRecordByFilter("tax_notifications", "tenant_id = {:tenant} && dedupe_key = {:key}", { tenant: input.tenantId, key: dedupeKey })
    if (existing.getString("status") === "CANCELLED") {
      existing.set("status", "PENDING"); existing.set("scheduled_at", input.scheduledAt)
      existing.set("last_error", ""); existing.set("lease_until", ""); $app.save(existing)
    }
    return
  } catch { /* create */ }
  taxCancelOldSchedules(input.tenantId, input.obligationId, input.filingId, input.action, input.channel, input.scheduleVersion)
  try {
    $app.save(new Record($app.findCollectionByNameOrId("tax_notifications"), {
      tenant_id: input.tenantId, subject_id: input.subjectId,
      obligation_id: input.obligationId || "", filing_id: input.filingId || "",
      action: input.action, channel: input.channel, scheduled_at: input.scheduledAt,
      dedupe_key: dedupeKey, status: "PENDING", attempt_count: 0, schedule_version: input.scheduleVersion,
    }))
  } catch (error) {
    // A second worker can win the unique dedupe key.
    try { $app.findFirstRecordByFilter("tax_notifications", "tenant_id = {:tenant} && dedupe_key = {:key}", { tenant: input.tenantId, key: dedupeKey }) } catch { throw error }
  }
}

function taxScheduleVersion(target, targetType, preference) {
  const due = taxDateOnly(target.getString("effective_due_date"))
  const snoozedUntil = targetType === "obligation" ? taxDateOnly(target.getString("snoozed_until")) : ""
  return [due, snoozedUntil, targetType === "obligation" ? target.getString("rule_version") : "filing", preference.getInt("revision")].join("-")
}

function taxScheduleAction(target, targetType, action, preference) {
  const due = taxDateOnly(target.getString("effective_due_date"))
  if (!due) return
  const annual = target.getString("period").length === 4
  const snoozedUntil = targetType === "obligation" ? taxDateOnly(target.getString("snoozed_until")) : ""
  const offsets = taxJsonArray(preference, annual ? "annual_offsets" : "monthly_offsets", annual ? [30, 14, 7, 3, 1, 0] : [7, 3, 1, 0])
  const tenantId = target.getString("tenant_id"); const subjectId = target.getString("subject_id")
  const scheduleVersion = taxScheduleVersion(target, targetType, preference)
  const channels = preference.getBool("in_app_enabled") ? ["IN_APP"] : []
  if (preference.getBool("email_enabled") && $os.getenv("JORNAL_TAX_EMAIL_ENABLED") === "true") channels.push("EMAIL")
  for (const offset of offsets) for (const channel of channels) {
    const scheduleDate = taxShiftDate(due, -offset); if (snoozedUntil && scheduleDate < snoozedUntil) continue
    taxEnsureNotification({ tenantId, subjectId, obligationId: targetType === "obligation" ? target.id : "", filingId: targetType === "filing" ? target.id : "", action, channel, marker: `before-${offset}`, scheduleVersion, scheduledAt: taxScheduledAt(scheduleDate, preference.getInt("delivery_hour"), preference.getString("timezone")) })
  }
  if (snoozedUntil) for (const channel of channels) taxEnsureNotification({
    tenantId, subjectId, obligationId: target.id, filingId: "", action, channel, marker: "snoozed", scheduleVersion,
    scheduledAt: taxScheduledAt(snoozedUntil, preference.getInt("delivery_hour"), preference.getString("timezone")),
  })
  const overdueLimit = Math.min(12, preference.getInt("overdue_weekly_limit") || 0)
  for (let week = 1; week <= overdueLimit; week += 1) for (const channel of channels) {
    const scheduleDate = taxShiftDate(due, week * 7); if (snoozedUntil && scheduleDate < snoozedUntil) continue
    taxEnsureNotification({ tenantId, subjectId, obligationId: targetType === "obligation" ? target.id : "", filingId: targetType === "filing" ? target.id : "", action: "OVERDUE", channel, marker: `overdue-${week}`, scheduleVersion, scheduledAt: taxScheduledAt(scheduleDate, preference.getInt("delivery_hour"), preference.getString("timezone")) })
  }
}

function taxGenerateNotificationQueue() {
  if ($os.getenv("JORNAL_TAX_COMPLIANCE_ENABLED") === "false") return
  const helpers = require(`${__hooks}/tax_helpers.js`)
  const obligations = helpers.findAllRecords(
    $app,
    "tax_obligations",
    "effective_due_date != '' && payment_status != 'PAID' && payment_status != 'OVERPAID' && payment_status != 'NOT_REQUIRED'",
    "effective_due_date,id",
  )
  for (const obligation of obligations) {
    const preference = taxPreference(obligation.getString("subject_id"), obligation.getString("tenant_id")); if (!preference) continue
    taxScheduleAction(obligation, "obligation", obligation.getString("amount_state") === "UNKNOWN" ? "PREPARE" : "PAY", preference)
  }
  const filings = helpers.findAllRecords(
    $app,
    "tax_filings",
    "effective_due_date != '' && status != 'FILED' && status != 'FULFILLED_BY_PAYMENT' && status != 'NOT_REQUIRED'",
    "effective_due_date,id",
  )
  for (const filing of filings) {
    const preference = taxPreference(filing.getString("subject_id"), filing.getString("tenant_id")); if (preference) taxScheduleAction(filing, "filing", "FILE", preference)
  }
}

function taxClaimDueNotifications() {
  const now = new Date().toISOString(); const claimed = []
  $app.runInTransaction((tx) => {
    const records = tx.findRecordsByFilter("tax_notifications", "(status = 'PENDING' || status = 'RETRYABLE_FAILED') && scheduled_at <= {:now}", "scheduled_at", 100, 0, { now })
    for (const record of records) {
      record.set("status", "LEASED"); record.set("lease_until", new Date(Date.now() + 5 * 60_000).toISOString()); tx.save(record)
      claimed.push({ id: record.id, tenantId: record.getString("tenant_id"), subjectId: record.getString("subject_id"), obligationId: record.getString("obligation_id"), filingId: record.getString("filing_id"), channel: record.getString("channel"), action: record.getString("action"), scheduleVersion: record.getString("schedule_version") })
    }
  })
  return claimed
}

function taxCancel(ids, reason) {
  $app.runInTransaction((tx) => {
    for (const id of ids) {
      let record
      try { record = tx.findRecordById("tax_notifications", id) } catch { continue }
      record.set("status", "CANCELLED"); record.set("lease_until", "")
      record.set("last_error", String(reason || "Reminder no longer applicable").slice(0, 500)); tx.save(record)
    }
  })
}

function taxNotificationStillApplicable(item) {
  if ($os.getenv("JORNAL_TAX_COMPLIANCE_ENABLED") === "false") return false
  const preference = taxPreference(item.subjectId, item.tenantId)
  if (!preference) return false
  if (item.channel === "IN_APP" && !preference.getBool("in_app_enabled")) return false
  if (item.channel === "EMAIL" && (!preference.getBool("email_enabled") || $os.getenv("JORNAL_TAX_EMAIL_ENABLED") !== "true")) return false
  if (item.obligationId) {
    let obligation
    try { obligation = $app.findRecordById("tax_obligations", item.obligationId) } catch { return false }
    if (obligation.getString("tenant_id") !== item.tenantId || obligation.getString("subject_id") !== item.subjectId) return false
    if (["PAID", "OVERPAID", "NOT_REQUIRED"].includes(obligation.getString("payment_status"))) return false
    const expectedAction = obligation.getString("amount_state") === "UNKNOWN" ? "PREPARE" : "PAY"
    if (item.action !== "OVERDUE" && item.action !== expectedAction) return false
    return item.scheduleVersion === taxScheduleVersion(obligation, "obligation", preference)
  }
  if (item.filingId) {
    let filing
    try { filing = $app.findRecordById("tax_filings", item.filingId) } catch { return false }
    if (filing.getString("tenant_id") !== item.tenantId || filing.getString("subject_id") !== item.subjectId) return false
    if (["FILED", "FULFILLED_BY_PAYMENT", "NOT_REQUIRED"].includes(filing.getString("status"))) return false
    if (!["FILE", "OVERDUE"].includes(item.action)) return false
    return item.scheduleVersion === taxScheduleVersion(filing, "filing", preference)
  }
  return false
}

function taxRevalidateNotifications(items) {
  const valid = []; const cancelled = []
  for (const item of items) (taxNotificationStillApplicable(item) ? valid : cancelled).push(item)
  if (cancelled.length) taxCancel(cancelled.map((item) => item.id), "Reminder cancelled after pre-send revalidation")
  return valid
}

function taxMark(ids, status, error) {
  $app.runInTransaction((tx) => {
    for (const id of ids) {
      let record
      try { record = tx.findRecordById("tax_notifications", id) } catch { continue }
      record.set("status", status); record.set("lease_until", "")
      if (status === "SENT") { record.set("sent_at", new Date().toISOString()); record.set("last_error", "") }
      else {
        const attempts = record.getInt("attempt_count") + 1; record.set("attempt_count", attempts); record.set("last_error", String(error || "Delivery failed").slice(0, 500))
        if (status === "RETRYABLE_FAILED") record.set("scheduled_at", new Date(Date.now() + Math.min(60, 5 * (2 ** attempts)) * 60_000).toISOString())
      }
      tx.save(record)
    }
  })
}

function taxDeliverNotifications() {
  const claimed = taxRevalidateNotifications(taxClaimDueNotifications())
  const inApp = claimed.filter((item) => item.channel === "IN_APP"); if (inApp.length) taxMark(inApp.map((item) => item.id), "SENT", "")
  const emailByTenant = {}
  for (const item of claimed.filter((candidate) => candidate.channel === "EMAIL")) {
    if (!emailByTenant[item.tenantId]) emailByTenant[item.tenantId] = []
    emailByTenant[item.tenantId].push(item)
  }
  for (const tenantId of Object.keys(emailByTenant)) {
    const items = taxRevalidateNotifications(emailByTenant[tenantId]); if (!items.length) continue
    let user
    try { user = $app.findRecordById("users", tenantId) } catch { taxMark(items.map((item) => item.id), "PERMANENTLY_FAILED", "Recipient not found"); continue }
    if (!user.getBool("verified") || !user.getString("email")) { taxMark(items.map((item) => item.id), "PERMANENTLY_FAILED", "Recipient email is not verified"); continue }
    const actionCounts = items.reduce((result, item) => { result[item.action] = (result[item.action] || 0) + 1; return result }, {})
    const summary = Object.keys(actionCounts).map((action) => `${action}: ${actionCounts[action]}`).join(", ")
    let amountSummary = ""
    const canIncludeAmounts = items.some((item) => { const preference = taxPreference(item.subjectId, tenantId); return preference && preference.getBool("include_amount_in_email") })
    if (canIncludeAmounts) {
      const total = items.reduce((sum, item) => {
        if (!item.obligationId) return sum
        const preference = taxPreference(item.subjectId, tenantId); if (!preference || !preference.getBool("include_amount_in_email")) return sum
        try { const obligation = $app.findRecordById("tax_obligations", item.obligationId); return obligation.getBool("has_remaining_payable") ? sum + obligation.getInt("remaining_payable") : sum } catch { return sum }
      }, 0)
      amountSummary = ` Total sisa terkonfirmasi pada agenda ini: Rp${total.toLocaleString("id-ID")}.`
    }
    try {
      const settings = $app.settings()
      $app.newMailClient().send(new MailerMessage({
        from: { address: settings.meta.senderAddress, name: settings.meta.senderName || "Jornal" },
        to: [{ address: user.getString("email") }],
        subject: "Pengingat agenda pajak Jornal",
        text: `Ada ${items.length} agenda pajak yang perlu diperiksa (${summary}).${amountSummary} Masuk ke Jornal untuk melihat tanggal, nominal, dan status terbaru.`,
        html: `<p>Ada <strong>${items.length}</strong> agenda pajak yang perlu diperiksa.</p>${amountSummary ? `<p>${amountSummary}</p>` : ""}<p>Masuk ke Jornal untuk melihat tanggal, nominal, dan status terbaru.</p>`,
      }))
      taxMark(items.map((item) => item.id), "SENT", "")
    } catch (error) {
      const maxAttempts = Math.max(...items.map((item) => {
        try { return $app.findRecordById("tax_notifications", item.id).getInt("attempt_count") } catch { return 0 }
      }))
      taxMark(items.map((item) => item.id), maxAttempts >= 4 ? "PERMANENTLY_FAILED" : "RETRYABLE_FAILED", error)
    }
  }
}

function taxRecoverExpiredLeases() {
  const now = new Date().toISOString()
  const expired = $app.findRecordsByFilter("tax_notifications", "status = 'LEASED' && lease_until < {:now}", "", 100, 0, { now })
  for (const record of expired) {
    record.set("status", "UNKNOWN"); record.set("last_error", "Delivery outcome unknown after worker interruption"); record.set("lease_until", ""); $app.save(record)
  }
}

module.exports = { taxDeliverNotifications, taxGenerateNotificationQueue, taxGenerateUpcomingObligations, taxRecoverExpiredLeases, taxScheduledAt, taxShiftDate }

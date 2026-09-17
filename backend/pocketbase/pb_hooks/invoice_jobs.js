function dateOnly(value) { return String(value || "").slice(0, 10) }
function shift(dateText, days) { const date = new Date(`${dateText}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function localClock(timezone) { const offsets = { "Asia/Jakarta": 7, "Asia/Makassar": 8, "Asia/Jayapura": 9, "UTC": 0 }; const offset = Object.prototype.hasOwnProperty.call(offsets, timezone) ? offsets[timezone] : 7; const value = new Date(Date.now() + offset * 3_600_000); return { date: value.toISOString().slice(0, 10), hour: value.getUTCHours() } }

function runInvoiceReminders() {
  if ($os.getenv("JORNAL_INVOICE_REMINDERS_ENABLED") === "false") return { created: 0, resolved: 0 }
  const helpers = require(`${__hooks}/invoice_helpers.js`); let created = 0; let resolved = 0
  const settings = helpers.findAllRecords($app, "invoice_settings", "reminder_enabled = true", "company_id,id")
  for (const preference of settings) {
    let company; try { company = $app.findRecordById("companies", preference.getString("company_id")) } catch { continue }
    if (company.getString("status") !== "ACTIVE" || company.getInt("data_epoch") !== preference.getInt("data_epoch")) continue
    const clock = localClock(preference.getString("reminder_timezone")); if (clock.hour < preference.getInt("reminder_hour")) continue; const today = clock.date
    const invoices = helpers.findAllRecords($app, "invoices", "tenant_id = {:tenant} && company_id = {:company} && data_epoch = {:epoch} && status = 'UNPAID' && due_date < {:today} && deleted_at = ''", "due_date,id", { tenant: preference.getString("tenant_id"), company: preference.getString("company_id"), epoch: preference.getInt("data_epoch"), today })
    for (const invoice of invoices) {
      const due = dateOnly(invoice.getString("due_date")); const repeat = Math.max(1, preference.getInt("reminder_repeat_days") || 7); const elapsed = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000)
      if (elapsed < 1) continue
      const marker = shift(due, 1 + Math.floor((elapsed - 1) / repeat) * repeat); const dedupe = [preference.getString("tenant_id"), invoice.id, invoice.getInt("payment_cycle"), preference.getInt("schedule_version"), marker].join(":")
      try { $app.findFirstRecordByFilter("invoice_reminders", "dedupe_key = {:key}", { key: dedupe }) } catch {
        try { $app.save(new Record($app.findCollectionByNameOrId("invoice_reminders"), { tenant_id: preference.getString("tenant_id"), company_id: preference.getString("company_id"), data_epoch: preference.getInt("data_epoch"), invoice_id: invoice.id, payment_cycle: invoice.getInt("payment_cycle"), schedule_version: preference.getInt("schedule_version"), scheduled_local_date: marker, status: "UNREAD", dedupe_key: dedupe })); created += 1 } catch { /* another runner won */ }
      }
    }
  }
  const active = helpers.findAllRecords($app, "invoice_reminders", "status != 'RESOLVED'", "created,id")
  for (const reminder of active) {
    let invoice; try { invoice = $app.findRecordById("invoices", reminder.getString("invoice_id")) } catch { invoice = null }
    if (!invoice || invoice.getString("status") !== "UNPAID" || invoice.getInt("payment_cycle") !== reminder.getInt("payment_cycle")) { reminder.set("status", "RESOLVED"); reminder.set("resolved_at", new Date().toISOString()); $app.save(reminder); resolved += 1 }
  }
  return { created, resolved }
}

module.exports = { runInvoiceReminders }

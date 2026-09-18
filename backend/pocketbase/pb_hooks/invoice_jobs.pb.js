if ($os.getenv("JORNAL_CRON_ENABLED") !== "false") {
  cronAdd("jornal-invoice-reminders", "*/15 * * * *", () => require(`${__hooks}/invoice_jobs.js`).runInvoiceReminders())
}

routerAdd("POST", "/api/jornal/admin/invoices/run-jobs", (event) => event.json(200, { ok: true, ...require(`${__hooks}/invoice_jobs.js`).runInvoiceReminders(), ranAt: new Date().toISOString() }), $apis.requireSuperuserAuth())

routerAdd("GET", "/api/jornal/admin/invoices/health", (event) => {
  const pending = $app.findRecordsByFilter("invoice_reminders", "status = 'UNREAD'", "", 0, 0).length
  return event.json(200, { remindersEnabled: $os.getenv("JORNAL_INVOICE_REMINDERS_ENABLED") !== "false", unread: pending, checkedAt: new Date().toISOString() })
}, $apis.requireSuperuserAuth())

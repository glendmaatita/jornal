cronAdd("jornal-tax-reminders", "*/5 * * * *", () => {
  const jobs = require(`${__hooks}/tax_jobs.js`)
  jobs.taxRecoverExpiredLeases()
  jobs.taxGenerateUpcomingObligations()
  jobs.taxGenerateNotificationQueue()
  jobs.taxDeliverNotifications()
})

routerAdd("POST", "/api/jornal/admin/tax/run-jobs", (event) => {
  try {
    const jobs = require(`${__hooks}/tax_jobs.js`)
    jobs.taxRecoverExpiredLeases()
    jobs.taxGenerateUpcomingObligations()
    jobs.taxGenerateNotificationQueue()
    jobs.taxDeliverNotifications()
  } catch (error) {
    throw new ApiError(500, `Tax jobs failed: ${String(error)}`)
  }
  return event.json(200, { ok: true, ranAt: new Date().toISOString() })
}, $apis.requireSuperuserAuth())

routerAdd("GET", "/api/jornal/admin/tax/health", (event) => {
  const count = (status) => $app.findRecordsByFilter("tax_notifications", "status = {:status}", "", 0, 0, { status }).length
  const settings = $app.settings()
  return event.json(200, {
    complianceEnabled: $os.getenv("JORNAL_TAX_COMPLIANCE_ENABLED") !== "false",
    emailDeliveryEnabled: $os.getenv("JORNAL_TAX_EMAIL_ENABLED") === "true",
    smtpConfigured: settings.smtp.enabled === true,
    queue: {
      pending: count("PENDING"), leased: count("LEASED"), retryableFailed: count("RETRYABLE_FAILED"),
      permanentlyFailed: count("PERMANENTLY_FAILED"), unknown: count("UNKNOWN"), sent: count("SENT"),
    },
    checkedAt: new Date().toISOString(),
  })
}, $apis.requireSuperuserAuth())

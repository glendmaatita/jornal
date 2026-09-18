if ($os.getenv("JORNAL_CRON_ENABLED") !== "false") {
  cronAdd("jornal-team-invitations", "* * * * *", () => {
    const jobs = require(`${__hooks}/team_invitation_jobs.js`)
    jobs.teamRecoverLeases(); jobs.teamExpireInvitations(); jobs.teamDeliver()
  })
}

routerAdd("POST", "/api/jornal/admin/team/run-jobs", (event) => {
  const jobs = require(`${__hooks}/team_invitation_jobs.js`)
  return event.json(200, { recovered: jobs.teamRecoverLeases(), expired: jobs.teamExpireInvitations(), ...jobs.teamDeliver(), ranAt: new Date().toISOString() })
}, $apis.requireSuperuserAuth())

routerAdd("GET", "/api/jornal/admin/team/health", (event) => {
  const count = (status) => $app.findRecordsByFilter("team_invitation_deliveries", "status = {:status}", "", 0, 0, { status }).length
  const oldest = $app.findRecordsByFilter("team_invitation_deliveries", "status = 'QUEUED' || status = 'RETRYABLE_FAILED'", "next_attempt_at,id", 1, 0)
  return event.json(200, {
    invitationEnabled: $os.getenv("JORNAL_TEAM_INVITATIONS_ENABLED") === "true",
    emailEnabled: $os.getenv("JORNAL_TEAM_INVITATION_EMAIL_ENABLED") === "true",
    smtpConfigured: $app.settings().smtp.enabled === true,
    publicUrlConfigured: Boolean(require(`${__hooks}/team_invitation_jobs.js`).teamPublicUrl()),
    queue: { queued: count("QUEUED"), leased: count("LEASED"), retryableFailed: count("RETRYABLE_FAILED"), permanentlyFailed: count("PERMANENTLY_FAILED"), cancelled: count("CANCELLED"), sent: count("SENT"), oldestPendingAt: oldest.length ? oldest[0].getString("next_attempt_at") : null },
    checkedAt: new Date().toISOString(),
  })
}, $apis.requireSuperuserAuth())

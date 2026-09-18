if ($os.getenv("JORNAL_CRON_ENABLED") !== "false") {
  cronAdd("jornal-document-ai", "*/2 * * * *", () => require(`${__hooks}/document_jobs.js`).runDocumentAiJobs())
}
routerAdd("POST", "/api/jornal/admin/documents/run-jobs", (event) => event.json(200, { ok: true, ...require(`${__hooks}/document_jobs.js`).runDocumentAiJobs(), ranAt: new Date().toISOString() }), $apis.requireSuperuserAuth())
routerAdd("GET", "/api/jornal/admin/documents/health", (event) => { const count = (status) => $app.findRecordsByFilter("ai_jobs", "status = {:status}", "", 0, 0, { status }).length; return event.json(200, { enabled: $os.getenv("JORNAL_AI_CAPTURE_ENABLED") === "true", configured: Boolean($os.getenv("OPENROUTER_API_KEY") && $os.getenv("JORNAL_AI_MODEL_PRIMARY") && $os.getenv("JORNAL_AI_ALLOWED_PROVIDERS")), queue: { queued: count("QUEUED"), running: count("RUNNING"), failed: count("FAILED"), unknown: count("UNKNOWN") }, checkedAt: new Date().toISOString() }) }, $apis.requireSuperuserAuth())

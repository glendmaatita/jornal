// Product default changed from seven days to one day. Existing values that
// still equal the old generated default are migrated; other customized terms
// remain untouched. This is deliberately non-destructive on rollback.
migrate(
  (app) => {
    let settings
    try { settings = app.findCollectionByNameOrId("invoice_settings") } catch { return }
    for (const record of app.findAllRecords(settings)) {
      if (record.getInt("default_due_days") !== 7) continue
      record.set("default_due_days", 1)
      record.set("revision", Math.max(1, record.getInt("revision") + 1))
      app.save(record)
    }
  },
  () => {
    // A rollback must not overwrite a term the user may have changed later.
  },
)

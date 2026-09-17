routerAdd("POST", "/api/jornal/companies/setup", (event) => {
  const { audit, companyResponse, jsonBody } = require(`${__hooks}/company_helpers.js`)
  const body = jsonBody(event)
  const tenantId = event.auth.id
  const name = String(body.name || "").trim().slice(0, 100)
  const initialSetup = body.initialSetup === true || String(body.initialSetup) === "true"
  const requestedCreationKey = String(body.creationKey || "").trim().slice(0, 100)
  const creationKey = initialSetup ? "__initial_company__" : requestedCreationKey
  if (!name || !requestedCreationKey || !body.profile || !Array.isArray(body.accounts)) {
    throw event.badRequestError("Invalid company setup", {})
  }
  let company
  if (body.companyId) {
    try { company = $app.findRecordById("companies", String(body.companyId)) } catch { throw event.notFoundError("Company not found", {}) }
    if (company.getString("tenant_id") !== tenantId) throw event.notFoundError("Company not found", {})
    if (company.getString("onboarding_completed_at")) return event.json(200, companyResponse(company))
  }
  if (!company) {
    try {
      company = $app.findFirstRecordByFilter("companies", "tenant_id = {:tenant} && creation_key = {:key}", { tenant: tenantId, key: creationKey })
      if (!initialSetup && company.getString("name") !== name) throw new ApiError(409, "Creation key payload differs")
      return event.json(200, companyResponse(company))
    } catch (error) {
      if (error && error.status && error.status !== 404) throw error
    }
  }
  if (initialSetup) {
    const first = $app.findRecordsByFilter("companies", "tenant_id = {:tenant}", "created", 1, 0, { tenant: tenantId })
    if (first.length > 0) return event.json(200, companyResponse(first[0]))
  }
  if (!initialSetup && !body.companyId && $os.getenv("JORNAL_MULTI_COMPANY_ENABLED") === "false") {
    throw new ApiError(403, "Creating additional companies is temporarily disabled")
  }

  const recent = $app.findRecordsByFilter(
    "company_audit",
    "tenant_id = {:tenant} && action = 'company-created'",
    "-created",
    10,
    0,
    { tenant: tenantId },
  )
  const oldestRecentAt = recent.length > 0
    ? Date.parse(recent[recent.length - 1].getString("created").replace(" ", "T"))
    : 0
  if (recent.length >= 10 && (!Number.isFinite(oldestRecentAt) || Date.now() - oldestRecentAt < 60_000)) {
    throw new ApiError(429, "Too many company creation requests")
  }

  const creatingCompany = !company
  try { $app.runInTransaction((tx) => {
    const companies = tx.findCollectionByNameOrId("companies")
    const records = tx.findCollectionByNameOrId("jornal_records")
    if (!company) {
      const existingCompanies = tx.findRecordsByFilter("companies", "tenant_id = {:tenant}", "created", 1, 0, { tenant: tenantId })
      company = new Record(companies, {
        tenant_id: tenantId,
        name,
        status: "ACTIVE",
        creation_key: creationKey,
        legacy_default: existingCompanies.length === 0,
        initial_setup_guard: existingCompanies.length === 0,
        initial_setup_key: existingCompanies.length === 0 ? tenantId : "",
        data_epoch: 1,
        revision: 1,
      })
    } else {
      company.set("name", name)
      company.set("revision", company.getInt("revision") + 1)
    }
    company.set("onboarding_completed_at", new Date().toISOString())
    tx.save(company)

    const profile = Object.assign({}, body.profile, {
      businessId: tenantId,
      companyId: company.id,
      businessName: name,
      onboardingCompletedAt: new Date().toISOString(),
    })
    const epoch = company.getInt("data_epoch")
    tx.save(new Record(records, {
      business_id: tenantId, company_id: company.id, data_epoch: epoch,
      entity: "profile", app_id: "profile", payload: profile, revision: 1,
    }))
    const settings = body.settings || { autoAccept: 0.9, needsReview: 0.7 }
    tx.save(new Record(records, {
      business_id: tenantId, company_id: company.id, data_epoch: epoch,
      entity: "settings", app_id: "settings", payload: settings, revision: 1,
    }))
    for (const account of body.accounts) {
      if (!account || !account.id || !account.name) continue
      tx.save(new Record(records, {
        business_id: tenantId, company_id: company.id, data_epoch: epoch,
        entity: "accounts", app_id: String(account.id), payload: account, revision: 1,
      }))
    }
    audit(tx, tenantId, company.id, creatingCompany ? "company-created" : "company-setup-completed", body.requestId)
  }) } catch (error) {
    // A simultaneous tab can win either unique creation_key or the unique
    // first-company guard. Resolve the winner instead of creating duplicates.
    try {
      const existing = $app.findFirstRecordByFilter("companies", "tenant_id = {:tenant} && creation_key = {:key}", { tenant: tenantId, key: creationKey })
      if (!initialSetup && existing.getString("name") !== name) throw new ApiError(409, "Creation key payload differs")
      return event.json(200, companyResponse(existing))
    } catch (lookupError) {
      if (initialSetup) {
        const first = $app.findRecordsByFilter("companies", "tenant_id = {:tenant}", "created", 1, 0, { tenant: tenantId })
        if (first.length > 0) return event.json(200, companyResponse(first[0]))
      }
      if (lookupError && lookupError.status && lookupError.status !== 404) throw lookupError
      throw error
    }
  }
  return event.json(201, companyResponse(company))
}, $apis.requireAuth())

routerAdd("PATCH", "/api/jornal/companies/{id}", (event) => {
  const { audit, companyResponse, jsonBody } = require(`${__hooks}/company_helpers.js`)
  const tenantId = event.auth.id
  const companyId = event.request.pathValue("id")
  const body = jsonBody(event)
  let response
  $app.runInTransaction((tx) => {
    let company
    try { company = tx.findRecordById("companies", companyId) } catch { throw event.notFoundError("Company not found", {}) }
    if (company.getString("tenant_id") !== tenantId) throw event.notFoundError("Company not found", {})
    const expectedRevision = Number(body.revision || 0)
    if (expectedRevision !== company.getInt("revision")) throw new ApiError(409, "Company revision is out of date")
    const actions = []
    if (body.name !== undefined) {
      const name = String(body.name || "").trim().slice(0, 100)
      if (!name) throw event.badRequestError("Company name is required", {})
      if (name !== company.getString("name")) {
        company.set("name", name)
        actions.push("company-renamed")
      }
    }
    if (body.status !== undefined) {
      const nextStatus = String(body.status)
      if (nextStatus !== "ACTIVE" && nextStatus !== "ARCHIVED") throw event.badRequestError("Invalid company status", {})
      const previousStatus = company.getString("status")
      if (nextStatus !== previousStatus) {
        company.set("status", nextStatus)
        company.set("archived_at", nextStatus === "ARCHIVED" ? new Date().toISOString() : "")
        actions.push(nextStatus === "ARCHIVED" ? "company-archived" : "company-restored")
      }
    }
    if (actions.length > 0) {
      company.set("revision", company.getInt("revision") + 1)
      tx.save(company)
      if (company.getString("status") === "ARCHIVED") {
        const reminders = tx.findRecordsByFilter("invoice_reminders", "tenant_id = {:tenant} && company_id = {:company} && status != 'RESOLVED'", "", 0, 0, { tenant: tenantId, company: companyId })
        for (const reminder of reminders) { reminder.set("status", "RESOLVED"); reminder.set("resolved_at", new Date().toISOString()); tx.save(reminder) }
        const jobs = tx.findRecordsByFilter("ai_jobs", "tenant_id = {:tenant} && company_id = {:company} && (status = 'QUEUED' || status = 'RUNNING')", "", 0, 0, { tenant: tenantId, company: companyId })
        for (const job of jobs) { job.set("status", "CANCELLED"); job.set("error_code", "COMPANY_ARCHIVED"); job.set("lease_until", ""); tx.save(job) }
        const deliveries = tx.findRecordsByFilter("notification_deliveries", "tenant_id = {:tenant} && company_id = {:company} && (status = 'PENDING' || status = 'LEASED' || status = 'RETRYABLE_FAILED')", "", 0, 0, { tenant: tenantId, company: companyId }); for (const delivery of deliveries) { delivery.set("status", "CANCELLED"); delivery.set("lease_until", ""); delivery.set("last_error", "Company archived"); tx.save(delivery) }
      }
      for (const action of actions) audit(tx, tenantId, companyId, action, String(body.requestId || ""))
    }
    response = companyResponse(company)
  })
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/reset", (event) => {
  const { audit, companyResponse } = require(`${__hooks}/company_helpers.js`)
  const taxHelpers = require(`${__hooks}/tax_helpers.js`)
  const tenantId = event.auth.id
  const companyId = event.request.pathValue("id")
  let response
  $app.runInTransaction((tx) => {
    let company
    try { company = tx.findRecordById("companies", companyId) } catch { throw event.notFoundError("Company not found", {}) }
    if (company.getString("tenant_id") !== tenantId) throw event.notFoundError("Company not found", {})
    if (company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company is archived")
    const nextEpoch = company.getInt("data_epoch") + 1
    const settlements = tx.findRecordsByFilter("tax_settlements", "tenant_id = {:tenant} && ledger_company_id = {:company} && ledger_transaction_id != ''", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const settlement of settlements) {
      settlement.set("ledger_transaction_id", ""); settlement.set("revision", settlement.getInt("revision") + 1); tx.save(settlement)
    }
    const periodInputs = tx.findRecordsByFilter("tax_period_inputs", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const input of periodInputs) {
      input.set("data_status", "NEEDS_RECONCILIATION"); input.set("data_epoch", nextEpoch); input.set("fingerprint", $security.sha256(`reset:${companyId}:${nextEpoch}:${input.id}`)); tx.save(input)
    }
    const memberships = tx.findRecordsByFilter("tax_company_memberships", "tenant_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const membership of memberships) {
      const obligations = tx.findRecordsByFilter("tax_obligations", "tenant_id = {:tenant} && subject_id = {:subject} && kind = 'PPH_FINAL_UMKM'", "", 0, 0, { tenant: tenantId, subject: membership.getString("subject_id") })
      for (const obligation of obligations) {
        obligation.set("data_status", "NEEDS_RECONCILIATION"); obligation.set("amount_state", "NEEDS_REVIEW"); obligation.set("revision", obligation.getInt("revision") + 1); tx.save(obligation)
      }
      taxHelpers.audit(tx, tenantId, membership.getString("subject_id"), "tax-ledger-reset", "", "company", companyId, "Ledger company was reset", null, { dataEpoch: nextEpoch })
    }
    const invoicePayments = tx.findRecordsByFilter("invoice_payments", "tenant_id = {:tenant} && company_id = {:company} && lifecycle = 'CURRENT'", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const payment of invoicePayments) { payment.set("lifecycle", "ARCHIVED_EPOCH"); payment.set("revision", payment.getInt("revision") + 1); tx.save(payment) }
    const invoiceReminders = tx.findRecordsByFilter("invoice_reminders", "tenant_id = {:tenant} && company_id = {:company} && status != 'RESOLVED'", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const reminder of invoiceReminders) { reminder.set("status", "RESOLVED"); reminder.set("resolved_at", new Date().toISOString()); tx.save(reminder) }
    const aiJobs = tx.findRecordsByFilter("ai_jobs", "tenant_id = {:tenant} && company_id = {:company} && (status = 'QUEUED' || status = 'RUNNING')", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const job of aiJobs) { job.set("status", "CANCELLED"); job.set("error_code", "COMPANY_RESET"); job.set("lease_until", ""); tx.save(job) }
    const deliveries = tx.findRecordsByFilter("notification_deliveries", "tenant_id = {:tenant} && company_id = {:company} && (status = 'PENDING' || status = 'LEASED' || status = 'RETRYABLE_FAILED')", "", 0, 0, { tenant: tenantId, company: companyId }); for (const delivery of deliveries) { delivery.set("status", "CANCELLED"); delivery.set("lease_until", ""); delivery.set("last_error", "Company reset"); tx.save(delivery) }
    const records = tx.findRecordsByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const record of records) tx.delete(record)
    company.set("data_epoch", nextEpoch)
    company.set("onboarding_completed_at", "")
    company.set("revision", company.getInt("revision") + 1)
    tx.save(company)
    audit(tx, tenantId, companyId, "company-reset", "")
    response = companyResponse(company)
  })
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("PUT", "/api/jornal/companies/{id}/logo", (event) => {
  const h = require(`${__hooks}/company_helpers.js`); const body = { revision: event.request.formValue("revision"), requestId: event.request.formValue("requestId"), filename: event.request.formValue("filename"), contentBase64: event.request.formValue("contentBase64") }; const tenantId = event.auth.id; const companyId = event.request.pathValue("id"); const requestId = String(body.requestId || ""); const encoded = String(body.contentBase64 || ""); if (!requestId || !encoded) throw new ApiError(400, "requestId dan file wajib diisi"); if (encoded.length > 2_800_000) throw new ApiError(413, "Logo maksimal 2 MB")
  const requestHash = $security.sha256(`PUT_LOGO:${Number(body.revision)}:${encoded}`); let existing; try { existing = $app.findFirstRecordByFilter("company_asset_commands", "tenant_id = {:tenant} && company_id = {:company} && request_id = {:request}", { tenant: tenantId, company: companyId, request: requestId }) } catch { existing = null }; if (existing) { if (existing.getString("request_hash") !== requestHash || existing.getString("action") !== "PUT_LOGO") throw new ApiError(409, "Request ID sudah digunakan"); return event.json(200, existing.get("response")) }
  const bytes = h.bytesFromBase64(encoded); if (!bytes.length || bytes.length > 2_097_152) throw new ApiError(413, "Logo maksimal 2 MB"); const info = h.imageInfo(bytes); if (info.width < 1 || info.height < 1 || info.width > 4096 || info.height > 4096 || info.width * info.height > 16_000_000) throw new ApiError(413, "Dimensi logo maksimal 4096 px dan 16 megapixel"); let response
  const uploaded = event.findUploadedFiles("file"); if (!uploaded || !uploaded.length) throw new ApiError(400, "File logo wajib diisi")
  $app.runInTransaction((tx) => { let company; try { company = tx.findRecordById("companies", companyId) } catch { throw new ApiError(404, "Company tidak ditemukan") }; if (company.getString("tenant_id") !== tenantId) throw new ApiError(404, "Company tidak ditemukan"); if (company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company diarsipkan"); if (company.getInt("revision") !== Number(body.revision)) throw new ApiError(409, "Company telah berubah"); const asset = new Record(tx.findCollectionByNameOrId("company_assets"), { tenant_id: tenantId, company_id: companyId, kind: "COMPANY_LOGO", file: uploaded[0], mime: info.mime, byte_size: bytes.length, width: info.width, height: info.height, checksum: $security.sha256(encoded), content_base64: encoded }); tx.save(asset); company.set("logo_asset_id", asset.id); company.set("revision", company.getInt("revision") + 1); tx.save(company); response = { company: h.companyResponse(company), asset: { id: asset.id, mime: info.mime, byteSize: bytes.length, width: info.width, height: info.height, checksum: asset.getString("checksum") } }; tx.save(new Record(tx.findCollectionByNameOrId("company_asset_commands"), { tenant_id: tenantId, company_id: companyId, request_id: requestId, action: "PUT_LOGO", request_hash: requestHash, response })); h.audit(tx, tenantId, companyId, "company-logo-updated", requestId) }); return event.json(200, response)
}, $apis.requireAuth())

routerAdd("DELETE", "/api/jornal/companies/{id}/logo", (event) => { const h = require(`${__hooks}/company_helpers.js`); const body = h.jsonBody(event); const tenantId = event.auth.id; const companyId = event.request.pathValue("id"); let response; $app.runInTransaction((tx) => { let company; try { company = tx.findRecordById("companies", companyId) } catch { throw new ApiError(404, "Company tidak ditemukan") }; if (company.getString("tenant_id") !== tenantId) throw new ApiError(404, "Company tidak ditemukan"); if (company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company diarsipkan"); if (company.getInt("revision") !== Number(body.revision)) throw new ApiError(409, "Company telah berubah"); company.set("logo_asset_id", ""); company.set("revision", company.getInt("revision") + 1); tx.save(company); response = { company: h.companyResponse(company) }; h.audit(tx, tenantId, companyId, "company-logo-removed", String(body.requestId || "")) }); return event.json(200, response) }, $apis.requireAuth())

routerAdd("GET", "/api/jornal/companies/{id}/assets/{assetId}", (event) => { const h = require(`${__hooks}/company_helpers.js`); const companyId = event.request.pathValue("id"); let asset; try { asset = $app.findRecordById("company_assets", event.request.pathValue("assetId")) } catch { throw new ApiError(404, "Aset tidak ditemukan") }; if (asset.getString("tenant_id") !== event.auth.id || asset.getString("company_id") !== companyId) throw new ApiError(404, "Aset tidak ditemukan"); return event.json(200, { id: asset.id, mime: asset.getString("mime"), width: asset.getInt("width"), height: asset.getInt("height"), checksum: asset.getString("checksum"), contentBase64: h.jsonValue(asset, "content_base64", "") }) }, $apis.requireAuth())

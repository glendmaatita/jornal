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
      for (const action of actions) audit(tx, tenantId, companyId, action, String(body.requestId || ""))
    }
    response = companyResponse(company)
  })
  return event.json(200, response)
}, $apis.requireAuth())

routerAdd("POST", "/api/jornal/companies/{id}/reset", (event) => {
  const { audit, companyResponse } = require(`${__hooks}/company_helpers.js`)
  const tenantId = event.auth.id
  const companyId = event.request.pathValue("id")
  let response
  $app.runInTransaction((tx) => {
    let company
    try { company = tx.findRecordById("companies", companyId) } catch { throw event.notFoundError("Company not found", {}) }
    if (company.getString("tenant_id") !== tenantId) throw event.notFoundError("Company not found", {})
    if (company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company is archived")
    const records = tx.findRecordsByFilter("jornal_records", "business_id = {:tenant} && company_id = {:company}", "", 0, 0, { tenant: tenantId, company: companyId })
    for (const record of records) tx.delete(record)
    company.set("data_epoch", company.getInt("data_epoch") + 1)
    company.set("onboarding_completed_at", "")
    company.set("revision", company.getInt("revision") + 1)
    tx.save(company)
    audit(tx, tenantId, companyId, "company-reset", "")
    response = companyResponse(company)
  })
  return event.json(200, response)
}, $apis.requireAuth())

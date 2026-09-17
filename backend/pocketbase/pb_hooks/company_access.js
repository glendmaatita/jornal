function notFound() { throw new ApiError(404, "Company tidak ditemukan") }

function membershipFor(app, actorUserId, companyId, requireActive) {
  if (!actorUserId || !companyId) return notFound()
  let membership
  try {
    membership = app.findFirstRecordByFilter(
      "company_memberships",
      "company_id = {:company} && user_id = {:user}",
      { company: String(companyId), user: String(actorUserId) },
    )
  } catch { return notFound() }
  if (requireActive !== false && membership.getString("status") !== "ACTIVE") return notFound()
  return membership
}

function companyScope(app, actorUserId, companyId, options) {
  const membership = membershipFor(app, actorUserId, companyId, true)
  let company
  try { company = app.findRecordById("companies", String(companyId)) } catch { return notFound() }
  const opts = options || {}
  if (opts.writable && company.getString("status") !== "ACTIVE") throw new ApiError(409, "Company diarsipkan")
  if (opts.epoch !== undefined && Number(opts.epoch) !== company.getInt("data_epoch")) {
    throw new ApiError(409, "Data company sudah berubah; muat ulang terlebih dahulu")
  }
  return {
    actorUserId: String(actorUserId),
    ownerTenantId: company.getString("tenant_id"),
    companyId: company.id,
    dataEpoch: company.getInt("data_epoch"),
    membershipRevision: membership.getInt("revision"),
    company,
    membership,
  }
}

function eventScope(event, companyId, options) {
  if (!event.auth) return notFound()
  return companyScope($app, event.auth.id, companyId, options)
}

function requireProtocol(event) {
  const headers = event.requestInfo().headers || {}
  if (String(headers.x_jornal_protocol || "") !== "3") {
    throw new ApiError(426, "Versi aplikasi ini sudah tidak didukung; muat ulang untuk memperbarui")
  }
}

function findAll(app, collection, filter, sort, params) {
  const rows = []; let offset = 0
  while (true) {
    const page = app.findRecordsByFilter(collection, filter, sort || "", 500, offset, params || {})
    rows.push(...page)
    if (page.length < 500) return rows
    offset += page.length
  }
}

function activeCompanyIds(app, actorUserId) {
  return findAll(app, "company_memberships", "user_id = {:user} && status = 'ACTIVE'", "company_id,id", { user: actorUserId })
    .map((row) => row.getString("company_id"))
    .filter(Boolean)
}

function assertTaxSubjectAccess(app, actorUserId, subject, requireAll) {
  const memberships = findAll(app, "tax_company_memberships", "subject_id = {:subject}", "company_id,id", { subject: subject.id })
  if (memberships.length === 0) {
    if (subject.getString("tenant_id") !== actorUserId) throw new ApiError(404, "Tax subject not found")
    return { ownerTenantId: subject.getString("tenant_id"), companyIds: [], complete: true }
  }
  const companyIds = [...new Set(memberships.map((row) => row.getString("company_id")).filter(Boolean))]
  let ownerTenantId = ""
  for (const companyId of companyIds) {
    const scope = companyScope(app, actorUserId, companyId, {})
    if (!ownerTenantId) ownerTenantId = scope.ownerTenantId
    if (scope.ownerTenantId !== ownerTenantId || scope.ownerTenantId !== subject.getString("tenant_id")) {
      throw new ApiError(409, "Subjek pajak lintas pemilik tidak didukung")
    }
  }
  if (requireAll === false) return { ownerTenantId, companyIds, complete: true }
  return { ownerTenantId, companyIds, complete: true }
}

function actorCanAccessCompany(app, actorUserId, companyId) {
  try { membershipFor(app, actorUserId, companyId, true); return true } catch { return false }
}

module.exports = {
  activeCompanyIds,
  actorCanAccessCompany,
  assertTaxSubjectAccess,
  companyScope,
  eventScope,
  findAll,
  membershipFor,
  requireProtocol,
}

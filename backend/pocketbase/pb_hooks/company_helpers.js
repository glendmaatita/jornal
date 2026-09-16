function jsonBody(event) {
  return event.requestInfo().body || {}
}

function audit(app, tenantId, companyId, action, requestId) {
  const collection = app.findCollectionByNameOrId("company_audit")
  app.save(new Record(collection, {
    tenant_id: tenantId,
    company_id: companyId,
    actor_id: tenantId,
    action,
    request_id: requestId || "",
  }))
}

function companyResponse(company) {
  return {
    id: company.id,
    tenantId: company.getString("tenant_id"),
    name: company.getString("name"),
    status: company.getString("status"),
    onboardingCompletedAt: company.getString("onboarding_completed_at") || null,
    legacyDefault: company.getBool("legacy_default"),
    dataEpoch: company.getInt("data_epoch"),
    revision: company.getInt("revision"),
    archivedAt: company.getString("archived_at") || null,
    createdAt: company.getString("created"),
    updatedAt: company.getString("updated"),
  }
}

module.exports = { audit, companyResponse, jsonBody }

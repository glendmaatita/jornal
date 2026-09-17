function jsonBody(event) {
  return event.requestInfo().body || {}
}

function audit(app, tenantId, companyId, action, requestId, actorId) {
  const collection = app.findCollectionByNameOrId("company_audit")
  app.save(new Record(collection, {
    tenant_id: tenantId,
    company_id: companyId,
    actor_id: actorId || tenantId,
    action,
    request_id: requestId || "",
  }))
}

function companyResponse(company, membership) {
  const response = {
    id: company.id,
    tenantId: company.getString("tenant_id"),
    name: company.getString("name"),
    status: company.getString("status"),
    onboardingCompletedAt: company.getString("onboarding_completed_at") || null,
    legacyDefault: company.getBool("legacy_default"),
    dataEpoch: company.getInt("data_epoch"),
    revision: company.getInt("revision"),
    logoAssetId: company.getString("logo_asset_id") || null,
    archivedAt: company.getString("archived_at") || null,
    createdAt: company.getString("created"),
    updatedAt: company.getString("updated"),
  }
  if (membership) response.membershipRevision = membership.getInt("revision")
  return response
}

function bytesFromBase64(value) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; const text = String(value || "").replace(/=+$/, ""); const output = []; let buffer = 0; let bits = 0; for (let index = 0; index < text.length; index += 1) { const digit = alphabet.indexOf(text[index]); if (digit < 0) throw new ApiError(400, "Data logo tidak valid"); buffer = (buffer << 6) | digit; bits += 6; if (bits >= 8) { bits -= 8; output.push((buffer >> bits) & 255) } }; return new Uint8Array(output) }
function imageInfo(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", width: (bytes[16] << 24) + (bytes[17] << 16) + (bytes[18] << 8) + bytes[19], height: (bytes[20] << 24) + (bytes[21] << 16) + (bytes[22] << 8) + bytes[23] }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") { const kind = String.fromCharCode(...bytes.slice(12, 16)); if (kind === "VP8X") return { mime: "image/webp", width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) }; throw new ApiError(415, "Varian WebP tidak didukung") }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { let offset = 2; while (offset + 9 < bytes.length) { if (bytes[offset] !== 0xff) { offset += 1; continue }; const marker = bytes[offset + 1]; const length = (bytes[offset + 2] << 8) + bytes[offset + 3]; if ([0xc0, 0xc1, 0xc2].includes(marker)) return { mime: "image/jpeg", height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] }; if (length < 2) break; offset += 2 + length } }
  throw new ApiError(415, "Logo harus berupa PNG, JPEG, atau WebP yang valid")
}
function jsonValue(record, field, fallback) { const raw = record.get(field); if (Array.isArray(raw) || (raw && typeof raw === "object" && typeof raw.length === "number" && typeof raw[0] === "number")) { try { return JSON.parse(String.fromCharCode(...raw)) } catch { return fallback } }; if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return raw } }; return raw ?? fallback }

module.exports = { audit, bytesFromBase64, companyResponse, imageInfo, jsonBody, jsonValue }

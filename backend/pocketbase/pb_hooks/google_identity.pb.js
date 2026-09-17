onRecordAuthWithOAuth2Request((event) => {
  if (event.collection.name !== "users" || event.providerName !== "google") return event.next()
  const providerUser = event.oAuth2User
  const subject = providerUser ? String(providerUser.id || "") : ""
  const email = providerUser ? String(providerUser.email || "").trim().toLowerCase() : ""
  if (!subject || !email) throw new ApiError(403, "Akun Google harus mempunyai email terverifikasi")
  event.next()
  if (!event.record || !event.record.id) return
  let identity
  try { identity = $app.findFirstRecordByFilter("user_google_identities", "user_id = {:user}", { user: event.record.id }) } catch {
    identity = new Record($app.findCollectionByNameOrId("user_google_identities"), { user_id: event.record.id })
  }
  identity.set("provider_subject", subject)
  identity.set("email_normalized", email)
  identity.set("email_verified", true)
  identity.set("verified_at", new Date().toISOString())
  $app.save(identity)
}, "users")

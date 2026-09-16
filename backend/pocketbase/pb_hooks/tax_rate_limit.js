const buckets = new Map()

function taxRateLimit(event) {
  const path = String(event.request.url.path || "")
  if (!path.startsWith("/api/jornal/tax/")) return
  const identity = event.auth ? event.auth.id : event.remoteIP()
  const sensitive = path.includes("/evidence") || path.includes("/import") || path.endsWith("/export")
  const limit = sensitive ? 12 : 180; const windowMs = 60_000; const now = Date.now()
  const key = `${identity}:${sensitive ? "sensitive" : "standard"}`
  let bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs }
  bucket.count += 1; buckets.set(key, bucket)
  if (bucket.count > limit) throw new ApiError(429, "Too many tax requests; retry after one minute")
  if (buckets.size > 10_000) for (const [entryKey, entry] of buckets.entries()) if (entry.resetAt <= now) buckets.delete(entryKey)
}

module.exports = { taxRateLimit }

import { extname, resolve } from "node:path"

const port = Number(process.env.PORT ?? 3000)
const distDirectory = resolve(import.meta.dir, "dist")
const indexFile = Bun.file(resolve(distDirectory, "index.html"))

// Vite emits names such as `index-C8abc123.js` (hash preceded by `-`), while
// some older builds use a dot. Match both forms so immutable caching is used
// for actual hashed assets.
const immutableAssetPattern = /(?:[-.]|^)[a-zA-Z0-9_-]{8,}\.(?:js|css|png|svg|woff2?)$/
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  // Keep OAuth popups functional while isolating the app's browsing context.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
}

// PocketBase completes the OAuth handshake by publishing to the browser's
// temporary realtime subscription and then redirects the popup to a dashboard
// route whose script calls window.close().  When PocketBase is served below
// /pb, that dashboard bundle is not a dependable completion surface (and can
// be restricted by an upstream CSP).  Serve a tiny completion document at the
// proxy boundary instead, after PocketBase has already published the result.
function oauthPopupCompleteResponse() {
  return new Response(
    "<!doctype html><meta charset=\"utf-8\"><title>Login selesai</title><script>window.close()</script><p>Login selesai. Jendela ini dapat ditutup.</p>",
    {
      headers: {
        ...securityHeaders,
        "Cache-Control": "no-store",
        // This document contains only the close action. Allow it explicitly
        // because PocketBase's dashboard CSP may otherwise block inline code.
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  )
}

const sharedIntake = new Map<string, { expiresAt: number; title: string; text: string; url: string; file?: { name: string; type: string; data: string } }>()
const shareLimit = 8 * 1024 * 1024
const maxPendingShares = 32

function pruneSharedIntake(now = Date.now()) {
  for (const [key, value] of sharedIntake) if (value.expiresAt < now) sharedIntake.delete(key)
  while (sharedIntake.size >= maxPendingShares) {
    const oldest = sharedIntake.keys().next().value
    if (!oldest) break
    sharedIntake.delete(oldest)
  }
}

async function responseFor(filePath: string, request: Request) {
  const file = Bun.file(filePath)
  const extension = extname(filePath)
  const isServiceWorker = filePath.endsWith("/sw.js") || filePath.endsWith("/registerSW.js")
  const cacheControl = isServiceWorker
    ? "no-cache"
    : immutableAssetPattern.test(filePath)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate"

  const headers = new Headers({
      "Cache-Control": cacheControl,
      ...(contentTypes[extension] ? { "Content-Type": contentTypes[extension] } : {}),
      ...securityHeaders,
    })
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(file.size))
    return new Response(null, { headers })
  }
  const compressible = new Set([".js", ".css", ".html", ".json", ".webmanifest"])
  const acceptsGzip = request.headers.get("accept-encoding")?.toLowerCase().includes("gzip")
  if (acceptsGzip && compressible.has(extension) && file.size > 1024) {
    headers.set("Content-Encoding", "gzip")
    headers.set("Vary", "Accept-Encoding")
    headers.delete("Content-Length")
    return new Response(file.stream().pipeThrough(new CompressionStream("gzip")), { headers })
  }
  return new Response(file, {
    headers,
  })
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok" }, {
        headers: { ...securityHeaders, "Cache-Control": "no-store" },
      })
    }

    if (url.pathname === "/share-target") {
      if (request.method === "POST") {
        const declaredLength = Number(request.headers.get("content-length") ?? 0)
        if (declaredLength > shareLimit + 256 * 1024) {
          return Response.json({ error: "Data yang dibagikan terlalu besar." }, { status: 413, headers: { ...securityHeaders, "Cache-Control": "no-store" } })
        }
        pruneSharedIntake()
        const form = await request.formData().catch(() => null)
        if (!form) return Response.json({ error: "Data yang dibagikan tidak valid." }, { status: 400, headers: securityHeaders })
        const title = String(form.get("title") ?? "").slice(0, 500)
        const text = String(form.get("text") ?? "").slice(0, 10_000)
        const sharedUrl = String(form.get("url") ?? "").slice(0, 2_000)
        const candidate = form.get("files")
        let file: { name: string; type: string; data: string } | undefined
        if (candidate instanceof File && candidate.size > 0) {
          if (candidate.size > shareLimit) return Response.json({ error: "File terlalu besar." }, { status: 413, headers: securityHeaders })
          if (!(candidate.type.startsWith("image/") || candidate.type === "application/pdf")) {
            return Response.json({ error: "Jenis file tidak didukung." }, { status: 415, headers: securityHeaders })
          }
          const bytes = new Uint8Array(await candidate.arrayBuffer())
          let binary = ""
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
          file = { name: candidate.name || "struk", type: candidate.type || "application/octet-stream", data: btoa(binary) }
        }
        const token = crypto.randomUUID()
        sharedIntake.set(token, {
          expiresAt: Date.now() + 5 * 60 * 1000,
          title, text, url: sharedUrl, file,
        })
        return Response.redirect(`${url.origin}/add?shared=1&shareToken=${encodeURIComponent(token)}`, 303)
      }
      const token = url.searchParams.get("token")
      if (!token) return Response.json({ error: "Token tidak ditemukan." }, { status: 400, headers: securityHeaders })
      pruneSharedIntake()
      const item = sharedIntake.get(token)
      sharedIntake.delete(token)
      if (!item || item.expiresAt < Date.now()) return Response.json({ error: "Tautan berbagi sudah kedaluwarsa." }, { status: 410, headers: securityHeaders })
      return Response.json(item, { headers: { ...securityHeaders, "Cache-Control": "no-store" } })
    }

    // Reverse proxy /pb/* to the PocketBase instance managed by supervisord,
    // so the SPA can reach it same-origin (no separate ingress needed).
    if (url.pathname === "/pb" || url.pathname.startsWith("/pb/")) {
      const pocketBaseOrigin = process.env.POCKETBASE_INTERNAL_URL ?? "http://127.0.0.1:8090"
      const pathAndQuery = `${url.pathname.replace(/^\/pb/, "") || "/"}${url.search}`
      const contentLength = Number(request.headers.get("content-length") ?? 0)
      if (contentLength > 12 * 1024 * 1024) {
        return Response.json({ error: "Permintaan terlalu besar." }, {
          status: 413,
          headers: { ...securityHeaders, "Cache-Control": "no-store" },
        })
      }
      try {
        const upstream = await fetch(new URL(pathAndQuery, pocketBaseOrigin), {
          method: request.method,
          headers: request.headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
          signal: AbortSignal.timeout(30_000),
        })
        const proxyHeaders = new Headers(upstream.headers)
        // PocketBase sends COOP: same-origin on its callback HTML. That
        // severs window.opener in the OAuth popup before the SDK can receive
        // its postMessage. Keep the callback compatible with the app shell's
        // OAuth popup policy.
        if (url.pathname === "/pb/api/oauth2-redirect") {
          const location = proxyHeaders.get("location") ?? ""
          // The realtime notification has already been sent by PocketBase at
          // this point. Replace its dashboard success/failure redirect with a
          // minimal popup document that can always close itself.
          if (location.includes("/auth/oauth2-redirect-success") || location.includes("/auth/oauth2-redirect-failure")) {
            return oauthPopupCompleteResponse()
          }
          proxyHeaders.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
          proxyHeaders.set("Cache-Control", "no-store")
        }
        return new Response(upstream.body, {
          status: upstream.status,
          headers: proxyHeaders,
        })
      } catch {
        return Response.json({ error: "PocketBase tidak merespons." }, {
          status: 504,
          headers: { ...securityHeaders, "Cache-Control": "no-store" },
        })
      }
    }

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
    const requestedPath = resolve(distDirectory, relativePath)

    if (requestedPath.startsWith(`${distDirectory}/`)) {
      const requestedFile = Bun.file(requestedPath)
      if (await requestedFile.exists()) return responseFor(requestedPath, request)
    }

    // SPA fallback: any path without a file extension resolves to index.html
    if (request.headers.get("accept")?.includes("text/html") || !extname(relativePath)) {
      return new Response(indexFile, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders,
        },
      })
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`Jornal is listening on http://${server.hostname}:${server.port}`)

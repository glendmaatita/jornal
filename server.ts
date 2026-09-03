import { extname, resolve } from "node:path"

const port = Number(process.env.PORT ?? 3000)
const distDirectory = resolve(import.meta.dir, "dist")
const indexFile = Bun.file(resolve(distDirectory, "index.html"))

const immutableAssetPattern = /\.[a-zA-Z0-9_-]{8,}\.(?:js|css|png|svg|woff2?)$/
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
}

function responseFor(filePath: string) {
  const file = Bun.file(filePath)
  const extension = extname(filePath)
  const isServiceWorker = filePath.endsWith("/sw.js") || filePath.endsWith("/registerSW.js")
  const cacheControl = isServiceWorker
    ? "no-cache"
    : immutableAssetPattern.test(filePath)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate"

  return new Response(file, {
    headers: {
      "Cache-Control": cacheControl,
      ...(contentTypes[extension] ? { "Content-Type": contentTypes[extension] } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  })
}

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/healthz") {
      return Response.json({ status: "ok" })
    }

    // Reverse proxy /pb/* to the PocketBase instance managed by supervisord,
    // so the SPA can reach it same-origin (no separate ingress needed).
    if (url.pathname === "/pb" || url.pathname.startsWith("/pb/")) {
      const pocketBaseOrigin = process.env.POCKETBASE_INTERNAL_URL ?? "http://127.0.0.1:8090"
      const pathAndQuery = `${url.pathname.replace(/^\/pb/, "") || "/"}${url.search}`
      const upstream = await fetch(new URL(pathAndQuery, pocketBaseOrigin), {
        method: request.method,
        headers: request.headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      })
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      })
    }

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html"
    const requestedPath = resolve(distDirectory, relativePath)

    if (requestedPath.startsWith(`${distDirectory}/`)) {
      const requestedFile = Bun.file(requestedPath)
      if (await requestedFile.exists()) return responseFor(requestedPath)
    }

    // SPA fallback: any path without a file extension resolves to index.html
    if (request.headers.get("accept")?.includes("text/html") || !extname(relativePath)) {
      return new Response(indexFile, {
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      })
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`Jornal is listening on http://${server.hostname}:${server.port}`)

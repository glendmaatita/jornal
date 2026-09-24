/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core"
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision?: string }> }
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches(); clientsClaim()
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/pb(?:\/|$)/, /^\/api(?:\/|$)/, /^\/healthz(?:\/|$)/, /^\/share-target(?:\/|$)/] }))

const RUNTIME_ASSETS = "jornal-runtime-assets-v1"
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/assets/")) return
  event.respondWith((async () => {
    const cached = await caches.match(event.request)
    if (cached) return cached
    const response = await fetch(event.request)
    if (response.ok) {
      const cache = await caches.open(RUNTIME_ASSETS)
      await cache.put(event.request, response.clone())
    }
    return response
  })())
})

self.addEventListener("message", (event) => { if (event.data?.type === "SKIP_WAITING") void self.skipWaiting() })
self.addEventListener("push", (event) => { let data: { title?: string; body?: string; url?: string; tag?: string }; try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() } }; event.waitUntil(Promise.all([self.registration.showNotification(data.title || "Jornal", { body: data.body || "Ada tindakan keuangan yang perlu diperiksa.", icon: "/pwa-192x192.png", badge: "/favicon-32x32.png", tag: data.tag || "jornal-action", data: { url: data.url || "/" } }), (self.navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void> }).setAppBadge?.(1) || Promise.resolve()])) })
self.addEventListener("notificationclick", (event) => { event.notification.close(); const target = new URL(String(event.notification.data?.url || "/"), self.location.origin).href; event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => { const existing = clients.find((client) => "focus" in client) as WindowClient | undefined; if (existing) { void existing.navigate(target); return existing.focus() } return self.clients.openWindow(target) })) })

function openDb() { return new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("jornal-local-v1", 3); request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains("state")) db.createObjectStore("state", { keyPath: "key" }); if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "key" }); if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "key" }) }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
async function storeSharedFile(file: File) { const db = await openDb(); const id = crypto.randomUUID(); const now = new Date().toISOString(); const prefix = "jornal.document-drafts.v1.staging.unassigned"; const draft = { id, tenantId: null, companyId: null, source: "SHARE_TARGET", filename: file.name || "dokumen", mimeType: file.type || "application/octet-stream", byteSize: file.size, status: "UNPROCESSED", createdAt: now, updatedAt: now, localOnly: true, serverDocumentId: null }; await new Promise<void>((resolve, reject) => { const transaction = db.transaction(["state", "blobs"], "readwrite"); const state = transaction.objectStore("state"); const get = state.get(`${prefix}.index`); get.onsuccess = () => state.put({ key: `${prefix}.index`, value: [draft, ...((get.result?.value as unknown[]) || [])], updatedAt: Date.now() }); transaction.objectStore("blobs").put({ key: `${prefix}.blob.${id}`, blob: file, mimeType: draft.mimeType, filename: draft.filename, byteSize: file.size, updatedAt: Date.now() }); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) }); db.close() }
self.addEventListener("fetch", (event) => { const url = new URL(event.request.url); if (event.request.method !== "POST" || url.pathname !== "/share-target") return; event.respondWith((async () => { try { const form = await event.request.formData(); const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0); for (const file of files.slice(0, 5)) if (file.size <= 8 * 1024 * 1024 && (file.type.startsWith("image/") || file.type === "application/pdf")) await storeSharedFile(file); return Response.redirect(new URL("/inbox?shared=1", url.origin), 303) } catch { return Response.redirect(new URL("/inbox?shareError=1", url.origin), 303) } })()) })

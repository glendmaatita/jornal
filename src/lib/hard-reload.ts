import { activeCompany, persistCompanyDrafts } from "@/lib/companies"

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
}

function waitForWorkerInstall(worker: ServiceWorker, ms: number) {
  if (worker.state === "installed" || worker.state === "activated") return Promise.resolve()
  return waitFor(new Promise<void>((resolve) => {
    const onStateChange = () => {
      if (["installed", "activated", "redundant"].includes(worker.state)) {
        worker.removeEventListener("statechange", onStateChange)
        resolve()
      }
    }
    worker.addEventListener("statechange", onStateChange)
  }), ms)
}

async function deployedVersion() {
  const url = new URL("/api/app-version", window.location.origin)
  url.searchParams.set("_", String(Date.now()))
  const response = await waitFor(fetch(url, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  }), 5000)
  if (!response?.ok) return null
  const payload = await response.json() as { version?: unknown }
  return typeof payload.version === "string" && payload.version ? payload.version : null
}

function workerHasVersion(worker: ServiceWorker | null, version: string) {
  if (!worker) return false
  try { return new URL(worker.scriptURL).searchParams.get("v") === version } catch { return false }
}

async function installDeployedServiceWorker() {
  const version = await deployedVersion()
  if (!version) return false

  const scriptUrl = new URL("/sw.js", window.location.origin)
  scriptUrl.searchParams.set("v", version)
  const registration = await waitFor(navigator.serviceWorker.register(scriptUrl, {
    scope: "/",
    updateViaCache: "none",
  }), 8000)
  if (!registration) return false

  const installing = registration.installing
  if (installing) await waitForWorkerInstall(installing, 8000)

  const waiting = registration.waiting
  if (waiting) {
    const controlled = Boolean(navigator.serviceWorker.controller)
    const activated = controlled
      ? new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }))
      : Promise.resolve()
    waiting.postMessage({ type: "SKIP_WAITING" })
    await waitFor(activated, 5000)
  }

  return workerHasVersion(registration.active, version)
    || workerHasVersion(registration.waiting, version)
    || (workerHasVersion(installing, version) && installing?.state !== "redundant")
}

async function forceNetworkReload() {
  if ("serviceWorker" in navigator) {
    const registrations = await waitFor(navigator.serviceWorker.getRegistrations(), 3000)
    if (registrations) await Promise.allSettled(registrations.map((registration) => registration.unregister()))
  }
  if ("caches" in window) {
    const keys = await waitFor(window.caches.keys(), 3000)
    if (keys) await Promise.allSettled(keys.filter((key) => key.includes("workbox-precache")).map((key) => window.caches.delete(key)))
  }
  const url = new URL(window.location.href)
  url.searchParams.set("_jornal_reload", String(Date.now()))
  window.location.replace(url)
}

/**
 * Full application refresh that also works inside an installed PWA, where
 * the browser reload control is not available. Drafts are flushed first, then
 * the service worker is asked to fetch a newer build and activate it, and
 * finally the document is reloaded so every module, query cache, and in-memory
 * state starts from scratch.
 */
export async function hardReloadApp() {
  const company = activeCompany()
  if (company) await waitFor(persistCompanyDrafts(company).catch(() => undefined), 2500)

  if ("serviceWorker" in navigator) {
    try {
      if (await installDeployedServiceWorker()) {
        window.location.reload()
        return
      }
    } catch {
      // Fall through to an uncached navigation below.
    }
  }

  await forceNetworkReload()
}

import { activeCompany, persistCompanyDrafts } from "@/lib/companies"

function waitFor<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))])
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
  if (company) await persistCompanyDrafts(company).catch(() => undefined)

  if ("serviceWorker" in navigator) {
    try {
      const registration = await waitFor(navigator.serviceWorker.getRegistration(), 2000)
      if (registration) {
        await waitFor(registration.update(), 4000)
        const waiting = registration.waiting
        if (waiting) {
          const activated = new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })
          })
          waiting.postMessage({ type: "SKIP_WAITING" })
          await waitFor(activated, 3000)
        }
      }
    } catch {
      // The update check is best effort; the reload below still refreshes the app.
    }
  }

  window.location.reload()
}

import { useEffect, useState } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const subscribers = new Set<() => void>()
const notify = () => subscribers.forEach((subscriber) => subscriber())

// Capture the one-shot browser event as soon as the app module loads. A
// route component may mount later (for example after OAuth), but should still
// be able to offer installation.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null
    notify()
  })
}

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(deferredPrompt)
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)),
  )

  useEffect(() => {
    const sync = () => {
      setInstallPrompt(deferredPrompt)
      if (window.matchMedia("(display-mode: standalone)").matches) setIsInstalled(true)
    }
    subscribers.add(sync)
    const media = window.matchMedia("(display-mode: standalone)")
    const handleDisplayMode = () => setIsInstalled(media.matches)

    media.addEventListener?.("change", handleDisplayMode)
    return () => {
      subscribers.delete(sync)
      media.removeEventListener?.("change", handleDisplayMode)
    }
  }, [])

  const install = async () => {
    const prompt = deferredPrompt
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    // beforeinstallprompt is one-shot; clear it after either outcome so a
    // dismissed prompt does not leave a dead install button on screen.
    deferredPrompt = null
    setInstallPrompt(null)
    notify()
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return { canInstall: Boolean(installPrompt) && !isInstalled, isInstalled, isIos, install }
}

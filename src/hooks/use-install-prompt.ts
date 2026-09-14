import { useEffect, useState } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)),
  )

  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPrompt(null)
    }
    const media = window.matchMedia("(display-mode: standalone)")
    const handleDisplayMode = () => setIsInstalled(media.matches)

    window.addEventListener("beforeinstallprompt", handlePrompt)
    window.addEventListener("appinstalled", handleInstalled)
    media.addEventListener?.("change", handleDisplayMode)
    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt)
      window.removeEventListener("appinstalled", handleInstalled)
      media.removeEventListener?.("change", handleDisplayMode)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    // beforeinstallprompt is one-shot; clear it after either outcome so a
    // dismissed prompt does not leave a dead install button on screen.
    setInstallPrompt(null)
  }

  return { canInstall: Boolean(installPrompt) && !isInstalled, install }
}

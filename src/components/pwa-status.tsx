import { useEffect, useState } from "react"
import { CloudOff, Download, RefreshCw, X } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"

export function PwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine)
    window.addEventListener("online", updateOnlineStatus)
    window.addEventListener("offline", updateOnlineStatus)
    return () => {
      window.removeEventListener("online", updateOnlineStatus)
      window.removeEventListener("offline", updateOnlineStatus)
    }
  }, [])

  if (isOnline && !offlineReady && !needRefresh) return null

  const dismiss = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <aside
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-white/10 bg-primary px-4 py-3 text-primary-foreground shadow-2xl"
      aria-live="polite"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
        {needRefresh ? <RefreshCw /> : isOnline ? <Download /> : <CloudOff />}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug">
        {needRefresh
          ? "Versi baru Jornal siap dipakai."
          : isOnline
            ? "Jornal siap dipakai offline."
            : "Anda sedang offline — data tetap tersimpan di perangkat ini."}
      </p>
      {needRefresh && (
        <Button size="sm" variant="secondary" onClick={() => void updateServiceWorker(true)}>
          Update
        </Button>
      )}
      {(isOnline || needRefresh) && (
        <Button size="icon" variant="ghost" className="size-8 hover:bg-white/10" onClick={dismiss}>
          <X aria-hidden="true" />
          <span className="sr-only">Dismiss</span>
        </Button>
      )}
    </aside>
  )
}

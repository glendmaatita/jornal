import { useEffect, useState } from "react"
import { CloudOff, Download, RefreshCw, X } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"
import { getSyncStatus, loadSyncConflicts, resolveSyncConflict, subscribeSyncStatus, schedulePocketBaseSync } from "@/lib/pocketbase-sync"
import { STORAGE_WARNING_EVENT } from "@/lib/store"

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

  const [dismissed, setDismissed] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [syncStatus, setSyncStatus] = useState(getSyncStatus)
  const [conflicts, setConflicts] = useState(loadSyncConflicts)
  useEffect(() => subscribeSyncStatus(setSyncStatus), [])
  useEffect(() => subscribeSyncStatus(() => setConflicts(loadSyncConflicts())), [])
  useEffect(() => {
    const onStorageWarning = () => { setStorageWarning(true); setDismissed(false) }
    window.addEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
    return () => window.removeEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
  }, [])
  const syncFailed = syncStatus === "failed"
  const hasConflict = conflicts.length > 0
  if (dismissed || (isOnline && !offlineReady && !needRefresh && !syncFailed && !hasConflict && !storageWarning)) return null

  const dismiss = () => {
    setDismissed(true)
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <aside
      className="fixed inset-x-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-white/10 bg-primary px-4 py-3 text-primary-foreground shadow-2xl"
      aria-live="polite"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
        {needRefresh || syncFailed ? <RefreshCw /> : isOnline ? <Download /> : <CloudOff />}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug">
        {storageWarning
          ? "Penyimpanan perangkat bermasalah. Unduh backup agar data tetap aman."
          : hasConflict
          ? `Perubahan bentrok pada ${conflicts[0]?.entity ?? "data"}${conflicts[0]?.appId ? ` (${conflicts[0].appId})` : ""}. Data lokal tetap tersimpan.`
          : syncFailed
          ? "Sinkronisasi tertunda. Data tetap tersimpan di perangkat."
          : needRefresh
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
      {storageWarning && (
        <a href="/settings" className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-semibold">Buka data</a>
      )}
      {syncFailed && isOnline && !storageWarning && (
        <Button size="sm" variant="secondary" onClick={() => { setDismissed(false); schedulePocketBaseSync() }}>
          Coba lagi
        </Button>
      )}
      {hasConflict && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" className="text-xs font-semibold underline underline-offset-2" onClick={() => {
            if (resolveSyncConflict(conflicts[0].id, "local")) setConflicts(loadSyncConflicts())
          }}>Pakai perangkat</button>
          <button type="button" className="text-xs font-semibold underline underline-offset-2" onClick={() => {
            if (resolveSyncConflict(conflicts[0].id, "remote")) setConflicts(loadSyncConflicts())
          }}>Pakai server</button>
        </div>
      )}
      <Button size="icon" variant="ghost" className="size-10 hover:bg-white/10" onClick={dismiss} aria-label="Tutup pemberitahuan">
        <X aria-hidden="true" />
      </Button>
    </aside>
  )
}

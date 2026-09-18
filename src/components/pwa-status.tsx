import { useEffect, useRef, useState } from "react"
import { CloudOff, Download, RefreshCw, X } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"
import { AppLoadingScreen } from "@/components/loading-screen"
import { CLIENT_UPDATE_REQUIRED_EVENT, getSyncStatus, loadSyncConflicts, resolveSyncConflict, subscribeSyncStatus, schedulePocketBaseSync, syncConflictLabel } from "@/lib/pocketbase-sync"
import { STORAGE_WARNING_EVENT } from "@/lib/store"
import { activeCompany, persistCompanyDrafts } from "@/lib/companies"

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
  const [clientUpdateRequired, setClientUpdateRequired] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateFailed, setUpdateFailed] = useState(false)
  const [syncStatus, setSyncStatus] = useState(getSyncStatus)
  const [conflicts, setConflicts] = useState(loadSyncConflicts)
  const conflictKey = useRef(conflicts.map((item) => item.id).join(":"))
  const [resolvingConflict, setResolvingConflict] = useState<"local" | "remote" | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  useEffect(() => subscribeSyncStatus((status) => {
    const next = loadSyncConflicts()
    const nextKey = next.map((item) => item.id).join(":")
    setSyncStatus(status)
    setConflicts(next)
    if (nextKey !== conflictKey.current) {
      setDismissed(false)
      setConflictError(null)
    }
    conflictKey.current = nextKey
  }), [])
  useEffect(() => {
    const onStorageWarning = () => { setStorageWarning(true); setDismissed(false) }
    window.addEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
    return () => window.removeEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
  }, [])
  useEffect(() => {
    const onUpdateRequired = () => { setClientUpdateRequired(true); setDismissed(false) }
    window.addEventListener(CLIENT_UPDATE_REQUIRED_EVENT, onUpdateRequired)
    return () => window.removeEventListener(CLIENT_UPDATE_REQUIRED_EVENT, onUpdateRequired)
  }, [])
  const syncFailed = syncStatus === "failed"
  const hasConflict = conflicts.length > 0
  const persistentAction = syncFailed || hasConflict || storageWarning || clientUpdateRequired || needRefresh || updateFailed

  const installUpdate = async () => {
    setIsUpdating(true)
    setUpdateFailed(false)
    try {
      const company = activeCompany()
      if (company) await persistCompanyDrafts(company)
      await updateServiceWorker(true)
    } catch {
      setIsUpdating(false)
      setUpdateFailed(true)
      setDismissed(false)
    }
  }

  const reloadClient = async () => {
    setIsUpdating(true)
    const company = activeCompany()
    if (company) await persistCompanyDrafts(company).catch(() => undefined)
    window.location.reload()
  }

  if (isUpdating) {
    return (
      <AppLoadingScreen
        title="Memperbarui Jornal"
        message="Versi baru sedang dipasang. Data Anda tetap aman dan aplikasi akan terbuka kembali otomatis."
        overlay
      />
    )
  }

  if (dismissed || (isOnline && !offlineReady && !needRefresh && !persistentAction)) return null

  const dismiss = () => {
    setDismissed(true)
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  const chooseConflict = async (choice: "local" | "remote") => {
    const conflict = conflicts[0]
    if (!conflict || resolvingConflict) return
    setResolvingConflict(choice)
    setConflictError(null)
    try {
      if (!await resolveSyncConflict(conflict.id, choice)) {
        setConflictError("Konflik ini sudah berubah. Muat ulang lalu coba lagi.")
        return
      }
      const next = loadSyncConflicts()
      setConflicts(next)
      conflictKey.current = next.map((item) => item.id).join(":")
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : "Pilihan belum dapat disimpan. Coba lagi.")
    } finally {
      setResolvingConflict(null)
    }
  }

  const activeConflict = conflicts[0]

  return (
    <aside
      className="fixed inset-x-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-lg flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-primary px-4 py-3 text-primary-foreground shadow-2xl sm:inset-x-4"
      aria-live="polite"
      aria-busy={Boolean(resolvingConflict)}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
          {needRefresh || syncFailed ? <RefreshCw /> : isOnline ? <Download /> : <CloudOff />}
        </span>
        <p className="min-w-0 flex-1 break-words text-sm leading-snug">
          {clientUpdateRequired
            ? "Versi Jornal ini perlu diperbarui sebelum sinkronisasi dapat dilanjutkan. Draft lokal tetap aman."
            : storageWarning
            ? "Penyimpanan perangkat bermasalah. Unduh backup agar data tetap aman."
            : hasConflict && activeConflict
            ? `Perubahan pada ${syncConflictLabel(activeConflict)} juga dibuat di perangkat lain. Pilih data yang ingin dipakai.${conflicts.length > 1 ? ` Masih ada ${conflicts.length - 1} konflik lain.` : ""}`
            : syncFailed
            ? "Sinkronisasi tertunda. Data tetap tersimpan di perangkat."
            : updateFailed
            ? "Pembaruan belum berhasil. Periksa koneksi, lalu coba lagi."
            : needRefresh
            ? "Versi baru Jornal siap dipakai."
            : isOnline
              ? "Jornal siap dipakai offline."
              : "Anda sedang offline — data tetap tersimpan di perangkat ini."}
        </p>
        <Button size="icon" variant="ghost" className="-mr-2 -mt-1 size-10 shrink-0 hover:bg-white/10" onClick={dismiss} aria-label="Tutup pemberitahuan">
          <X aria-hidden="true" />
        </Button>
      </div>
      {conflictError && <p role="alert" className="rounded-lg bg-red-950/35 px-3 py-2 text-xs leading-relaxed">{conflictError}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {needRefresh && (
          <Button size="sm" variant="secondary" onClick={() => void installUpdate()}>
            {updateFailed ? "Coba lagi" : "Update"}
          </Button>
        )}
        {clientUpdateRequired && !needRefresh && (
          <Button size="sm" variant="secondary" onClick={() => void reloadClient()}>Muat ulang</Button>
        )}
        {storageWarning && (
          <a href="/settings" className="rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold">Buka data</a>
        )}
        {syncFailed && !hasConflict && isOnline && !storageWarning && (
          <Button size="sm" variant="secondary" onClick={() => { setDismissed(false); schedulePocketBaseSync() }}>
            Coba lagi
          </Button>
        )}
        {hasConflict && (
          <div className="grid w-full grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={Boolean(resolvingConflict)} className="min-h-11 whitespace-normal" onClick={() => void chooseConflict("local")}>
              {resolvingConflict === "local" ? "Menyimpan…" : "Pakai perangkat"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(resolvingConflict)} className="min-h-11 whitespace-normal border-white/50 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => void chooseConflict("remote")}>
              {resolvingConflict === "remote" ? "Menyimpan…" : "Pakai server"}
            </Button>
          </div>
        )}
        {!needRefresh && !clientUpdateRequired && !storageWarning && !syncFailed && !hasConflict && <span />}
      </div>
    </aside>
  )
}

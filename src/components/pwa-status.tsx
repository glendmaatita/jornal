import { useEffect, useState } from "react"
import { Download, RefreshCw, X } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"

import { Button } from "@/components/ui/button"
import { AppLoadingScreen } from "@/components/loading-screen"
import { CLIENT_UPDATE_REQUIRED_EVENT } from "@/lib/pocketbase-sync"
import { STORAGE_WARNING_EVENT } from "@/lib/store"
import { hardReloadApp } from "@/lib/hard-reload"

export function PwaStatus() {
  const { needRefresh: [needRefresh, setNeedRefresh] } = useRegisterSW()
  const [dismissed, setDismissed] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [clientUpdateRequired, setClientUpdateRequired] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateFailed, setUpdateFailed] = useState(false)

  useEffect(() => {
    const onStorageWarning = () => { setStorageWarning(true); setDismissed(false) }
    const onUpdateRequired = () => { setClientUpdateRequired(true); setDismissed(false) }
    window.addEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
    window.addEventListener(CLIENT_UPDATE_REQUIRED_EVENT, onUpdateRequired)
    return () => {
      window.removeEventListener(STORAGE_WARNING_EVENT, onStorageWarning)
      window.removeEventListener(CLIENT_UPDATE_REQUIRED_EVENT, onUpdateRequired)
    }
  }, [])

  const installUpdate = async () => {
    setIsUpdating(true)
    setUpdateFailed(false)
    try {
      await hardReloadApp()
    } catch {
      setIsUpdating(false)
      setUpdateFailed(true)
      setDismissed(false)
    }
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

  if (dismissed || (!needRefresh && !storageWarning && !clientUpdateRequired && !updateFailed)) return null

  return (
    <aside
      className="pointer-events-none fixed inset-x-3 bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-lg flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-primary px-4 py-3 text-primary-foreground shadow-2xl sm:inset-x-4"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10">
          {needRefresh || clientUpdateRequired ? <RefreshCw /> : <Download />}
        </span>
        <p className="min-w-0 flex-1 break-words text-sm leading-snug">
          {clientUpdateRequired
            ? "Versi Jornal ini perlu diperbarui agar data dapat dimuat kembali."
            : storageWarning
              ? "Penyimpanan perangkat bermasalah. Unduh backup agar data tetap aman."
              : updateFailed
                ? "Pembaruan belum berhasil. Periksa koneksi, lalu coba lagi."
                : "Versi baru Jornal siap dipakai."}
        </p>
        <Button
          size="icon"
          variant="ghost"
          className="pointer-events-auto -mr-2 -mt-1 size-10 shrink-0 hover:bg-white/10"
          onClick={() => { setDismissed(true); setNeedRefresh(false) }}
          aria-label="Tutup pemberitahuan"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="pointer-events-auto flex justify-end gap-2">
        {(needRefresh || clientUpdateRequired || updateFailed) && (
          <Button size="sm" variant="secondary" onClick={() => void installUpdate()}>
            {updateFailed ? "Coba lagi" : needRefresh ? "Update" : "Muat ulang"}
          </Button>
        )}
        {storageWarning && <a href="/settings" className="rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold">Buka data</a>}
      </div>
    </aside>
  )
}

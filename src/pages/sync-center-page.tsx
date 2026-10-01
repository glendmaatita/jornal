import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Clock, HardDrive, RefreshCw, Server, UploadCloud, Wifi, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { listOutbox } from "@/lib/local-db"
import { formatDateTime } from "@/lib/format"
import { getLastSyncAt, getSyncStatus, refreshPocketBaseFromServer, subscribeSyncStatus } from "@/lib/pocketbase-sync"
import { queryKeys } from "@/lib/queries"

export function SyncCenterPage() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(0)
  const [status, setStatus] = useState(getSyncStatus)
  const [lastSyncAt, setLastSyncAt] = useState(getLastSyncAt)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({})
  const refresh = () => void listOutbox().then((items) => setPending(items.length))
  const refreshFromServer = async () => {
    if (await refreshPocketBaseFromServer()) {
      await Promise.all(Object.values(queryKeys).map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    }
    refresh()
  }

  useEffect(() => {
    refresh()
    void navigator.storage?.estimate?.().then(setStorage)
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener("online", updateOnline)
    window.addEventListener("offline", updateOnline)
    const unsubscribe = subscribeSyncStatus((next) => {
      setStatus(next)
      setLastSyncAt(getLastSyncAt())
      refresh()
    })
    return () => {
      unsubscribe()
      window.removeEventListener("online", updateOnline)
      window.removeEventListener("offline", updateOnline)
    }
  }, [])

  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl"><RefreshCw className="size-5 text-primary" aria-hidden="true" />Status Sync</h1>
        <p className="text-sm text-muted-foreground">Sinkronisasi berjalan di latar belakang. Saat online, data server menjadi acuan utama.</p>
      </header>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <p className="flex items-center gap-2 font-semibold">
            {online
              ? <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Wifi className="size-4" aria-hidden="true" /></span>
              : <span className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-700"><WifiOff className="size-4" aria-hidden="true" /></span>}
            {online ? "Perangkat online" : "Perangkat offline"}
          </p>
          <dl className="grid gap-2 text-sm">
            <div className="flex items-center gap-2"><Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Status server</dt><dd className="ml-auto font-medium">{status}</dd></div>
            <div className="flex items-center gap-2"><Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Terakhir sukses</dt><dd className="ml-auto font-medium">{lastSyncAt ? formatDateTime(lastSyncAt) : "Belum ada"}</dd></div>
            <div className="flex items-center gap-2"><UploadCloud className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Menunggu dikirim</dt><dd className="ml-auto font-medium">{pending} perubahan</dd></div>
            <div className="flex items-center gap-2"><HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Penyimpanan</dt><dd className="ml-auto font-medium">{((storage.usage || 0) / 1024 / 1024).toFixed(1)} MB dari {((storage.quota || 0) / 1024 / 1024).toFixed(0)} MB</dd></div>
          </dl>
          <Button onClick={() => void refreshFromServer()}><RefreshCw aria-hidden="true" />Segarkan dari server</Button>
        </CardContent>
      </Card>
      <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />Saat tersambung, perbedaan data diselesaikan otomatis memakai versi server.</p>
    </div>
  )
}

import { useEffect, useState } from "react"
import { AlertTriangle, CircleCheck, Clock, Cloud, GitMerge, HardDrive, RefreshCw, Server, Smartphone, UploadCloud, Wifi, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { listOutbox } from "@/lib/local-db"
import {
  getLastSyncAt,
  getSyncStatus,
  loadSyncConflicts,
  resolveSyncConflict,
  schedulePocketBaseSync,
  syncConflictDisplayPayload,
  syncConflictLabel,
} from "@/lib/pocketbase-sync"

export function SyncCenterPage() {
  const [pending, setPending] = useState(0)
  const [conflicts, setConflicts] = useState(loadSyncConflicts())
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({})
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => void listOutbox().then((items) => setPending(items.length))

  useEffect(() => {
    refresh()
    void navigator.storage?.estimate?.().then(setStorage)
  }, [])

  const resolve = async (id: string, choice: "local" | "remote") => {
    setResolvingId(id)
    setError(null)
    try {
      if (!await resolveSyncConflict(id, choice)) {
        setError("Konflik ini sudah berubah. Muat ulang lalu coba lagi.")
        return
      }
      setConflicts(loadSyncConflicts())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pilihan belum dapat disimpan. Coba lagi.")
    } finally {
      setResolvingId(null)
      refresh()
    }
  }

  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl"><RefreshCw className="size-5 text-primary" aria-hidden="true" />Status Sync</h1>
        <p className="text-sm text-muted-foreground">Koneksi, antrean perangkat, konflik, dan penyimpanan.</p>
      </header>
      <Card>
        <CardContent className="grid gap-3 p-4">
          <p className="flex items-center gap-2 font-semibold">
            {navigator.onLine
              ? <span className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Wifi className="size-4" aria-hidden="true" /></span>
              : <span className="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-700"><WifiOff className="size-4" aria-hidden="true" /></span>}
            {navigator.onLine ? "Perangkat online" : "Perangkat offline"}
          </p>
          <dl className="grid gap-2 text-sm">
            <div className="flex items-center gap-2"><Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Status server</dt><dd className="ml-auto font-medium">{getSyncStatus()}</dd></div>
            <div className="flex items-center gap-2"><Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Terakhir sukses</dt><dd className="ml-auto font-medium">{getLastSyncAt() ? new Date(getLastSyncAt()!).toLocaleString("id-ID") : "Belum ada"}</dd></div>
            <div className="flex items-center gap-2"><UploadCloud className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Menunggu dikirim</dt><dd className="ml-auto font-medium">{pending} perubahan</dd></div>
            <div className="flex items-center gap-2"><HardDrive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><dt className="text-muted-foreground">Penyimpanan</dt><dd className="ml-auto font-medium">{((storage.usage || 0) / 1024 / 1024).toFixed(1)} MB dari {((storage.quota || 0) / 1024 / 1024).toFixed(0)} MB</dd></div>
          </dl>
          <Button onClick={() => { schedulePocketBaseSync(); setTimeout(refresh, 1000) }}><RefreshCw aria-hidden="true" />Coba sinkronkan</Button>
        </CardContent>
      </Card>

      <h2 className="flex items-center gap-2 font-semibold"><GitMerge className="size-4 text-primary" aria-hidden="true" />Konflik perlu diperiksa</h2>
      {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      {conflicts.map((conflict) => (
        <Card key={conflict.id}>
          <CardContent className="p-4">
            <p className="font-semibold capitalize">{syncConflictLabel(conflict)}</p>
            <p className="mt-1 text-sm text-muted-foreground">Pilih versi data yang ingin dipakai untuk menyelesaikan konflik ini.</p>
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer font-medium">Lihat perbandingan data</summary>
              <div className="mt-2 grid gap-2 overflow-auto sm:grid-cols-2">
                <pre className="rounded bg-slate-50 p-2">Perangkat{"\n"}{JSON.stringify(syncConflictDisplayPayload(conflict, "local"), null, 2)}</pre>
                <pre className="rounded bg-slate-50 p-2">Server{"\n"}{JSON.stringify(syncConflictDisplayPayload(conflict, "remote"), null, 2)}</pre>
              </div>
            </details>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" disabled={Boolean(resolvingId)} onClick={() => void resolve(conflict.id, "local")}>
                <Smartphone aria-hidden="true" />{resolvingId === conflict.id ? "Menyimpan…" : "Pakai perangkat"}
              </Button>
              <Button size="sm" variant="outline" disabled={Boolean(resolvingId)} onClick={() => void resolve(conflict.id, "remote")}>
                <Cloud aria-hidden="true" />{resolvingId === conflict.id ? "Menyimpan…" : "Pakai server"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
      {!conflicts.length && <p className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" aria-hidden="true" />Tidak ada konflik.</p>}
    </div>
  )
}

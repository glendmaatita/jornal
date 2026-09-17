import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { listOutbox } from "@/lib/local-db"
import { getLastSyncAt, getSyncStatus, loadSyncConflicts, resolveSyncConflict, schedulePocketBaseSync } from "@/lib/pocketbase-sync"

export function SyncCenterPage() {
  const [pending, setPending] = useState(0); const [conflicts, setConflicts] = useState(loadSyncConflicts()); const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({}); const refresh = () => void listOutbox().then((items) => setPending(items.length))
  useEffect(() => { refresh(); void navigator.storage?.estimate?.().then(setStorage) }, [])
  const resolve = async (id: string, choice: "local" | "remote") => {
    if (await resolveSyncConflict(id, choice)) setConflicts(loadSyncConflicts())
    refresh()
  }
  return <div className="space-y-4 pb-8"><header><h1 className="text-2xl">Status Sync</h1><p className="text-sm text-muted-foreground">Koneksi, antrean perangkat, konflik, dan penyimpanan.</p></header><Card><CardContent className="grid gap-2 p-4"><p><strong>{navigator.onLine ? "Perangkat online" : "Perangkat offline"}</strong></p><p>Status server: {getSyncStatus()}</p><p>Terakhir sukses: {getLastSyncAt() ? new Date(getLastSyncAt()!).toLocaleString("id-ID") : "Belum ada"}</p><p>{pending} perubahan menunggu dikirim</p><p>Penyimpanan: {((storage.usage || 0) / 1024 / 1024).toFixed(1)} MB dari {((storage.quota || 0) / 1024 / 1024).toFixed(0)} MB</p><Button onClick={() => { schedulePocketBaseSync(); setTimeout(refresh, 1000) }}>Coba sinkronkan</Button></CardContent></Card><h2 className="font-semibold">Konflik perlu diperiksa</h2>{conflicts.map((conflict) => <Card key={conflict.id}><CardContent className="p-4"><p className="font-semibold">{conflict.entity} · {conflict.appId}</p><div className="mt-2 grid grid-cols-2 gap-2 overflow-auto text-xs"><pre className="rounded bg-slate-50 p-2">Perangkat{"\n"}{JSON.stringify(conflict.localPayload, null, 2)}</pre><pre className="rounded bg-slate-50 p-2">Server{"\n"}{JSON.stringify(conflict.remotePayload, null, 2)}</pre></div><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void resolve(conflict.id, "local")}>Pakai perangkat</Button><Button size="sm" variant="outline" onClick={() => void resolve(conflict.id, "remote")}>Pakai server</Button></div></CardContent></Card>)}{!conflicts.length && <p className="text-sm text-muted-foreground">Tidak ada konflik.</p>}</div>
}

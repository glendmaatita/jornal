import { useCallback, useEffect, useState } from "react"
import { LogIn, MailOpen, RefreshCw, UserRoundX } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { loadCompanies, selectCompany } from "@/lib/companies"
import { loginWithGoogle, logout, pb } from "@/lib/pb"
import { bootstrapSession } from "@/lib/team-client"

export function InvitationPage({ publicId }: { publicId: string }) {
  const [pending, setPending] = useState(pb.authStore.isValid)
  const [message, setMessage] = useState("Masuk dengan akun Google yang menerima undangan.")
  const finish = useCallback(async () => {
    const result = await bootstrapSession(publicId)
    const companies = await loadCompanies()
    if (result.targetCompanyId && companies.some((company) => company.id === result.targetCompanyId)) { selectCompany(result.targetCompanyId); window.location.assign(`/?company=${encodeURIComponent(result.targetCompanyId)}`); return }
    if (result.invitationStatus === "UNAVAILABLE") { setMessage("Undangan tidak tersedia untuk akun Google ini. Gunakan akun lain atau minta undangan baru."); return }
    if (result.invitationStatus === "EXPIRED" || result.invitationStatus === "REVOKED") { setMessage("Undangan ini sudah kedaluwarsa atau dibatalkan. Minta anggota company mengirim undangan baru."); return }
    if (companies.length) { window.location.assign("/companies"); return }
    setMessage("Belum ada company yang dapat diakses. Minta pengirim memeriksa kembali undangan.")
  }, [publicId])
  useEffect(() => {
    if (!pb.authStore.isValid) return
    let cancelled = false
    const run = async () => {
      try {
        await finish()
      } catch {
        if (!cancelled) setMessage("Undangan belum dapat diperiksa. Periksa koneksi dan coba lagi.")
      } finally {
        if (!cancelled) setPending(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [finish])
  return <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-5"><div className="w-full max-w-sm space-y-4 text-center"><BrandMark className="mx-auto size-16" /><h1 className="flex items-center justify-center gap-2 text-xl tracking-tight"><MailOpen className="size-5 text-primary" aria-hidden="true" />Undangan company Jornal</h1><p className="text-sm text-muted-foreground" role="status">{message}</p>{!pb.authStore.isValid ? <Button className="w-full" disabled={pending} onClick={() => { setPending(true); void loginWithGoogle().then(finish).catch(() => setMessage("Login Google gagal. Coba lagi.")).finally(() => setPending(false)) }}><LogIn aria-hidden="true" />{pending ? "Memeriksa…" : "Masuk dengan Google"}</Button> : <div className="space-y-2"><Button className="w-full" disabled={pending} onClick={() => { setPending(true); void finish().finally(() => setPending(false)) }}><RefreshCw aria-hidden="true" />{pending ? "Memeriksa…" : "Periksa lagi"}</Button><Button variant="outline" className="w-full" onClick={() => { logout(); window.location.reload() }}><UserRoundX aria-hidden="true" />Gunakan akun lain</Button></div>}</div></main>
}

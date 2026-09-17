import { Link } from "@tanstack/react-router"
import { Building2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

export function NoCompanyPage() {
  return <div className="mx-auto max-w-lg space-y-4 py-8"><Card><CardContent className="space-y-4 p-6 text-center"><Building2 className="mx-auto size-10 text-primary" aria-hidden="true" /><h1 className="text-xl tracking-tight">Belum ada company</h1><p className="text-sm text-muted-foreground">Jika Anda sedang menunggu undangan, masuk ulang setelah email diterima. Company baru hanya dibuat saat Anda memilih tombol di bawah.</p><Link to="/onboarding" onClick={() => { try { window.sessionStorage.setItem("jornal.create-company-intent", "1") } catch { /* server still performs final race guard */ } }} className="inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Buat company baru</Link></CardContent></Card></div>
}

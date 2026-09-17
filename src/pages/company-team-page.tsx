import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { MailPlus, RefreshCw, Trash2, UserMinus, Users } from "lucide-react"

import { PageLoading } from "@/components/loading-screen"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { activeCompany, refreshCompanyMemberships } from "@/lib/companies"
import { currentUser } from "@/lib/pb"
import { inviteTeamMember, leaveCompany, removeTeamMember, resendInvitation, revokeInvitation } from "@/lib/team-client"
import { teamQueryKey, useTeam } from "@/lib/team-queries"
import type { TeamInvitation, TeamMember } from "@/lib/team-types"

function message(error: unknown) {
  if (error && typeof error === "object") {
    const data = (error as { data?: { code?: string; message?: string }; message?: string }).data
    if (data?.message) return data.message
    if ((error as { message?: string }).message) return (error as { message: string }).message
  }
  return "Permintaan tim gagal. Coba lagi."
}

export function CompanyTeamPage() {
  const company = activeCompany()
  const user = currentUser()
  const queryClient = useQueryClient()
  const team = useTeam(company?.id)
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState("")
  const [status, setStatus] = useState("")
  const refresh = () => company && queryClient.invalidateQueries({ queryKey: teamQueryKey(company.id) })
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setPending(key); setStatus("")
    try { await action(); setStatus(success); await refresh(); return true } catch (error) { setStatus(message(error)); return false } finally { setPending("") }
  }
  if (!company || team.isLoading) return <PageLoading label="Memuat anggota tim…" />
  if (team.isError || !team.data) return <div className="space-y-4"><p role="alert">Tim belum dapat dimuat.</p><Button onClick={() => void team.refetch()}>Coba lagi</Button></div>
  const activeMembers = team.data.members.filter((member) => member.status === "ACTIVE")
  const pendingInvitations = team.data.invitations.filter((invitation) => invitation.status === "PENDING")
  const history = team.data.invitations.filter((invitation) => invitation.status !== "PENDING")

  return (
    <div className="space-y-4 pb-24">
      <div>
        <h1 className="flex items-center gap-2 text-xl tracking-tight"><Users className="size-5 text-primary" aria-hidden="true" />Tim {company.name}</h1>
        <p className="text-sm text-muted-foreground">Semua anggota memiliki akses penuh yang sama, termasuk transaksi, pengaturan, dan mengundang anggota lain.</p>
      </div>
      <Card><CardContent className="space-y-3 p-5">
        <h2 className="text-lg tracking-tight">Undang anggota</h2>
        <TextField label="Email akun Google" value={email} onChange={setEmail} placeholder="nama@perusahaan.com" disabled={Boolean(pending)} />
        <Button disabled={!email.trim() || Boolean(pending)} onClick={() => void run("invite", () => inviteTeamMember(company.id, email).then(() => setEmail("")), "Undangan dibuat dan email masuk antrean.")}><MailPlus className="size-4" aria-hidden="true" />{pending === "invite" ? "Mengirim…" : "Kirim undangan"}</Button>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-5">
        <h2 className="text-lg tracking-tight">Anggota ({activeMembers.length})</h2>
        <div className="divide-y divide-border/60">
          {activeMembers.map((member: TeamMember) => <div key={member.userId} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{member.name}</p><p className="truncate text-xs text-muted-foreground">{member.email}{member.userId === user?.id ? " · Anda" : ""}</p></div>
            {member.userId === user?.id ? <Button variant="outline" disabled={activeMembers.length <= 1 || Boolean(pending)} onClick={() => { if (window.confirm(`Keluar dari ${company.name}? Akses pada perangkat ini akan dihentikan.`)) void run(`leave:${member.userId}`, () => leaveCompany(company.id, member.revision), "Anda telah keluar dari company.").then(async (left) => { if (!left) return; await refreshCompanyMemberships().catch(() => undefined); window.location.assign("/companies") }) }}>Keluar</Button> : <button type="button" disabled={activeMembers.length <= 1 || Boolean(pending)} aria-label={`Hapus ${member.name}`} className="grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" onClick={() => { if (window.confirm(`Hapus akses ${member.name} dari ${company.name}?`)) void run(`remove:${member.userId}`, () => removeTeamMember(company.id, member.userId, member.revision), "Akses anggota telah dihapus.") }}><UserMinus className="size-4" /></button>}
          </div>)}
        </div>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-5">
        <h2 className="text-lg tracking-tight">Undangan aktif ({pendingInvitations.length})</h2>
        {pendingInvitations.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada undangan aktif.</p>}
        {pendingInvitations.map((invitation: TeamInvitation) => <div key={invitation.id} className="rounded-xl border border-border p-3">
          <p className="break-all text-sm font-semibold">{invitation.email}</p>
          <p className="mt-1 text-xs text-muted-foreground">Berlaku sampai {new Date(invitation.expiresAt).toLocaleString("id-ID")} · Email: {invitation.delivery?.status ?? "belum diantrikan"}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(pending)} onClick={() => void run(`resend:${invitation.id}`, () => resendInvitation(company.id, invitation), "Undangan dikirim ulang.")}><RefreshCw className="size-4" />Kirim ulang</Button><Button variant="outline" disabled={Boolean(pending)} onClick={() => { if (window.confirm(`Batalkan undangan untuk ${invitation.email}?`)) void run(`revoke:${invitation.id}`, () => revokeInvitation(company.id, invitation), "Undangan dibatalkan.") }}><Trash2 className="size-4" />Batalkan</Button></div>
        </div>)}
        {history.length > 0 && <details><summary className="cursor-pointer text-sm font-semibold">Riwayat undangan ({history.length})</summary><div className="mt-2 space-y-2">{history.map((item) => <p key={item.id} className="text-xs text-muted-foreground">{item.email} · {item.status}</p>)}</div></details>}
      </CardContent></Card>
      {status && <p className="rounded-xl bg-secondary p-3 text-sm" role="status">{status}</p>}
      <Link to="/settings" className="text-sm font-semibold text-[var(--link)]">Kembali ke pengaturan</Link>
    </div>
  )
}

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Archive, Check, Plus, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { activeCompany, loadCompanies, multiCompanyCreationEnabled, pendingChangesForCompany, persistCompanyDrafts, rememberCompanyCreationReturn, selectCompany, updateCompany } from "@/lib/companies"
import type { Company } from "@/lib/types"
import { CompanyLogo, CompanyLogoEditor } from "@/components/company-logo"

export function CompaniesPage() {
  const queryClient = useQueryClient()
  const { data: companies = [], isLoading, error } = useQuery({ queryKey: ["jornal", "companies"], queryFn: loadCompanies })
  const current = activeCompany()
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [message, setMessage] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({})
  const accessEnded = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("access") === "ended"

  useEffect(() => {
    let cancelled = false
    void Promise.all(companies.map(async (company) => [company.id, await pendingChangesForCompany(company)] as const)).then((entries) => {
      if (!cancelled) setPendingCounts(Object.fromEntries(entries))
    })
    return () => { cancelled = true }
  }, [companies])

  const visibleCompanies = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("id")
    return needle ? companies.filter((company) => company.name.toLocaleLowerCase("id").includes(needle)) : companies
  }, [companies, search])

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["jornal", "companies"] })
  }

  const saveName = async (company: Company) => {
    if (!name.trim()) return
    setPending(company.id)
    setMessage("")
    try {
      await updateCompany(company, { name })
      setEditing(null)
      await refresh()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Nama company gagal disimpan")
    } finally { setPending(null) }
  }

  const changeStatus = async (company: Company) => {
    setPending(company.id)
    setMessage("")
    try {
      if (company.status === "ACTIVE") {
        const count = await pendingChangesForCompany(company)
        if (count > 0) throw new Error(`Selesaikan ${count} perubahan tertunda sebelum mengarsipkan company.`)
        const confirmation = window.prompt(`Ketik nama company untuk mengarsipkan: ${company.name}`)
        if (confirmation !== company.name) throw new Error("Nama konfirmasi tidak cocok. Company tidak diarsipkan.")
      }
      await updateCompany(company, { status: company.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" })
      await refresh()
      if (company.id === current?.id && company.status === "ACTIVE") {
        const replacement = companies.find((item) => item.id !== company.id && item.status === "ACTIVE")
        if (replacement) switchCompany(replacement)
        else window.location.assign(`/companies?company=${encodeURIComponent(company.id)}`)
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Status company gagal diubah")
    } finally { setPending(null) }
  }

  if (isLoading) return <p className="py-10 text-center text-sm text-muted-foreground">Memuat company…</p>

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-2xl tracking-tight">Company</h1><p className="mt-1 text-sm text-muted-foreground">Setiap company memiliki pembukuan terpisah.</p></div>
        {multiCompanyCreationEnabled && <Link to="/companies/new" onClick={() => rememberCompanyCreationReturn()} className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--main-dark)] px-4 text-sm font-semibold text-white"><Plus className="size-4" />Tambah</Link>}
      </div>
      {accessEnded && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="status">Akses ke company sebelumnya sudah berakhir. Pilih company lain atau buat company baru.</p>}
      {(message || error) && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{message || String(error)}</p>}
      {companies.length > 5 && <TextField value={search} onChange={setSearch} label="Cari company" />}
      <div className="space-y-3">
        {visibleCompanies.map((company) => (
          <Card key={company.id} className={company.id === current?.id ? "border-[#df1769]/50" : ""}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3"><CompanyLogo company={company} /><div className="min-w-0"><p className="truncate font-semibold">{company.name}</p><p className="text-xs text-muted-foreground">{company.status === "ARCHIVED" ? "Diarsipkan" : company.id === current?.id ? "Company aktif" : "Aktif"}{pendingCounts[company.id] ? ` · ${pendingCounts[company.id]} perubahan tertunda` : ""}</p></div></div>
                {company.id === current?.id && <Check className="size-5 text-[#df1769]" aria-label="Company aktif" />}
              </div>
              {editing === company.id ? <div className="mt-4 flex gap-2"><div className="flex-1"><TextField value={name} onChange={setName} label="Nama company" /></div><Button className="mt-6" size="sm" onClick={() => void saveName(company)} disabled={pending === company.id}>Simpan</Button></div> : null}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                {company.status === "ACTIVE" && company.id !== current?.id && <Button size="sm" variant="outline" onClick={() => switchCompany(company)}>Buka company</Button>}
                <Button size="sm" variant="ghost" onClick={() => { setEditing(company.id); setName(company.name) }}>Ubah nama</Button>
                <Button size="sm" variant="ghost" onClick={() => void changeStatus(company)} disabled={pending === company.id}>{company.status === "ACTIVE" ? <><Archive />Arsipkan</> : <><RotateCcw />Pulihkan</>}</Button>
              </div>
              {company.id === current?.id && <div className="mt-3"><CompanyLogoEditor company={company} /></div>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

function switchCompany(company: Company) {
  const source = activeCompany()
  void (source ? persistCompanyDrafts(source) : Promise.resolve()).then(() => {
    selectCompany(company.id)
    const detailPath = /^\/transactions\/[^/]+(?:\/edit)?$/.test(window.location.pathname)
    const path = detailPath ? "/transactions" : window.location.pathname === "/companies" ? "/" : window.location.pathname
    const search = new URLSearchParams(window.location.search)
    search.set("company", company.id)
    window.location.assign(`${path}?${search.toString()}`)
  }).catch(() => window.alert("Draft belum tersimpan dengan aman. Coba lagi."))
}

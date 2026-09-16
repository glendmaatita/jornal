import { ChevronDown } from "lucide-react"

import { activeCompany, loadCachedCompanies, multiCompanyCreationEnabled, persistCompanyDrafts, rememberCompanyCreationReturn, selectCompany } from "@/lib/companies"

export function CompanySwitcher() {
  const current = activeCompany()
  if (!current) return null
  const companies = loadCachedCompanies().filter((company) => company.status === "ACTIVE" || company.id === current.id)
  return (
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">Company aktif</span>
      <select
        value={current.id}
        onChange={(event) => {
          if (event.target.value === "__new") { rememberCompanyCreationReturn(); window.location.assign("/companies/new"); return }
          if (event.target.value === "__manage") { window.location.assign("/companies"); return }
          const nextCompanyId = event.target.value
          void persistCompanyDrafts(current).then(() => {
            selectCompany(nextCompanyId)
            const path = /^\/transactions\/[^/]+(?:\/edit)?$/.test(window.location.pathname) ? "/transactions" : window.location.pathname
            const search = new URLSearchParams(window.location.search)
            search.set("company", nextCompanyId)
            window.location.assign(`${path}?${search.toString()}`)
          }).catch(() => {
            event.target.value = current.id
            window.alert("Draft belum tersimpan dengan aman. Coba pindah company lagi.")
          })
        }}
        className="max-w-40 appearance-none truncate rounded-full border border-border bg-white py-1.5 pr-7 pl-3 text-xs font-semibold"
      >
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        {multiCompanyCreationEnabled && <option value="__new">+ Tambah company</option>}
        <option value="__manage">Kelola company</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" aria-hidden="true" />
    </label>
  )
}

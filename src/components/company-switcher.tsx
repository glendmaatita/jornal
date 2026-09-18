import { CompanyLogo } from "@/components/company-logo"
import { SelectField } from "@/components/ui/select-field"

import { activeCompany, loadCachedCompanies, multiCompanyCreationEnabled, persistCompanyDrafts, rememberCompanyCreationReturn, selectCompany } from "@/lib/companies"

export function CompanySwitcher() {
  const current = activeCompany()
  if (!current) return null
  const companies = loadCachedCompanies().filter((company) => company.status === "ACTIVE" || company.id === current.id)
  const options = [
    ...companies.map((company) => ({ value: company.id, label: company.name })),
    ...(multiCompanyCreationEnabled ? [{ value: "__new", label: "+ Tambah company" }] : []),
    { value: "__manage", label: "Kelola company" },
  ]

  const switchCompany = (next: string) => {
    if (next === "__new") { rememberCompanyCreationReturn(); window.location.assign("/companies/new"); return }
    if (next === "__manage") { window.location.assign("/companies"); return }
    if (next === current.id) return
    void persistCompanyDrafts(current).then(() => {
      selectCompany(next)
      const path = /^\/transactions\/[^/]+(?:\/edit)?$/.test(window.location.pathname) ? "/transactions" : window.location.pathname
      const search = new URLSearchParams(window.location.search)
      search.set("company", next)
      window.location.assign(`${path}?${search.toString()}`)
    }).catch(() => {
      window.alert("Draft belum tersimpan dengan aman. Coba pindah company lagi.")
    })
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <CompanyLogo company={current} className="size-7 shrink-0" />
      <SelectField
        aria-label="Company aktif"
        size="compact"
        value={current.id}
        onChange={switchCompany}
        options={options}
        className="w-40 max-w-full"
        shellClassName="!min-h-8 !rounded-full !px-3 !py-0 text-xs font-semibold"
      />
    </div>
  )
}

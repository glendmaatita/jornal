import { useEffect, useState } from "react"

import { CompanyLogo } from "@/components/company-logo"
import { SelectField } from "@/components/ui/select-field"
import { useAppDialog } from "@/components/ui/app-dialog-context"

import { activeCompany, loadCachedCompanies, multiCompanyCreationEnabled, persistCompanyDrafts, rememberCompanyCreationReturn, selectCompany, subscribeCompanies } from "@/lib/companies"

export function CompanySwitcher() {
  const dialog = useAppDialog()
  const [, setCatalogRevision] = useState(0)
  useEffect(() => subscribeCompanies(() => setCatalogRevision((revision) => revision + 1)), [])
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
    }).catch(() => void dialog.alert({
      title: "Company belum dapat dipindah",
      description: "Draft belum tersimpan dengan aman. Coba pindah company lagi.",
      tone: "destructive",
    }))
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <CompanyLogo company={current} className="size-7 shrink-0" />
      <SelectField
        aria-label="Company aktif"
        size="compact"
        value={current.id}
        onChange={switchCompany}
        searchable
        searchPlaceholder="Cari company…"
        options={options}
        className="w-40 max-w-full"
        shellClassName="!min-h-8 !rounded-full !px-3 !py-0 text-xs font-semibold"
      />
    </div>
  )
}

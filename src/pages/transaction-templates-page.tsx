import { useEffect, useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Banknote, LayoutTemplate, PenLine, Save, Trash2 } from "lucide-react"

import { activeCompany } from "@/lib/companies"
import { mirrorState, restoreState } from "@/lib/local-db"
import { Button } from "@/components/ui/button"
import { SelectField } from "@/components/ui/select-field"
import { TextField } from "@/components/ui/text-field"
import { parseAmountInput } from "@/lib/format"

interface Template { id: string; name: string; description: string; direction: "MONEY_IN" | "MONEY_OUT"; amount: number | null }
type Direction = Template["direction"]

const emptyForm = { name: "", description: "", direction: "MONEY_OUT" as Direction, amount: "" }

function key() {
  const company = activeCompany()
  return `jornal.transaction-templates.${company?.tenantId}.${company?.id}.v1`
}

export function TransactionTemplatesPage() {
  const [items, setItems] = useState<Template[]>([])
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    void restoreState(key()).then((value) => setItems(Array.isArray(value) ? value as Template[] : []))
  }, [])

  const save = (next: Template[]) => {
    setItems(next)
    void mirrorState(key(), next)
  }

  return (
    <div className="space-y-4 pb-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl"><LayoutTemplate className="size-5 text-primary" aria-hidden="true" />Template Transaksi</h1>
        <p className="text-sm text-muted-foreground">Template hanya mengisi form; tidak pernah mencatat uang otomatis.</p>
      </header>
      <div className="grid gap-3 rounded-xl border bg-white p-4">
        <TextField label="Nama template" icon={LayoutTemplate} value={form.name} onChange={(name) => setForm({ ...form, name })} />
        <TextField label="Deskripsi" icon={PenLine} value={form.description} onChange={(description) => setForm({ ...form, description })} />
        <TextField label="Nominal opsional" icon={Banknote} type="amount" value={form.amount} onChange={(amount) => setForm({ ...form, amount })} />
        <SelectField
          label="Arah"
          icon={form.direction === "MONEY_IN" ? ArrowDownLeft : ArrowUpRight}
          value={form.direction}
          onChange={(direction) => setForm({ ...form, direction: direction as Direction })}
          options={[{ value: "MONEY_OUT", label: "Uang keluar" }, { value: "MONEY_IN", label: "Uang masuk" }]}
        />
        <Button
          disabled={!form.name.trim() || !form.description.trim()}
          onClick={() => {
            save([...items, { id: crypto.randomUUID(), name: form.name.trim(), description: form.description.trim(), direction: form.direction, amount: form.amount ? parseAmountInput(form.amount) : null }])
            setForm(emptyForm)
          }}
        >
          <Save aria-hidden="true" />
          Simpan template
        </Button>
      </div>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
          <span className={item.direction === "MONEY_IN" ? "grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700" : "grid size-9 shrink-0 place-items-center rounded-xl bg-[#f1f5fd] text-[var(--main-dark)]"}>
            {item.direction === "MONEY_IN" ? <ArrowDownLeft className="size-4" aria-hidden="true" /> : <ArrowUpRight className="size-4" aria-hidden="true" />}
          </span>
          <a href={`/add?direction=${item.direction}&amount=${item.amount || ""}&description=${encodeURIComponent(item.description)}`} className="min-w-0 flex-1">
            <strong className="block truncate">{item.name}</strong>
            <p className="truncate text-xs text-muted-foreground">{item.description}</p>
          </a>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-red-700" onClick={() => save(items.filter((candidate) => candidate.id !== item.id))}>
            <Trash2 className="size-3.5" aria-hidden="true" />Hapus
          </button>
        </div>
      ))}
    </div>
  )
}

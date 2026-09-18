import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { AlertTriangle, Contact, Hash, Map, MapPin, Mail, Phone, Save, User, UserPen, UserPlus, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { createCustomer, getCustomer, updateCustomer } from "@/lib/invoice-client"

const empty = { name: "", email: "", phone: "", addressLine1: "", addressLine2: "", district: "", city: "", province: "", postalCode: "" }

export function CustomerFormPage({ customerId, returnTo }: { customerId?: string; returnTo?: string }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(empty)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!customerId) return
    void getCustomer(customerId)
      .then(({ customer }) => {
        setForm({ name: customer.name, email: customer.email || "", phone: customer.phone || "", addressLine1: customer.addressLine1 || "", addressLine2: customer.addressLine2 || "", district: customer.district || "", city: customer.city || "", province: customer.province || "", postalCode: customer.postalCode || "" })
        setRevision(customer.revision)
      })
      .catch((cause) => setError(String(cause)))
  }, [customerId])

  const field = (key: keyof typeof form, label: string, icon: LucideIcon, required = false) => (
    <TextField label={label} icon={icon} value={form[key]} onChange={(value) => setForm((current) => ({ ...current, [key]: value }))} required={required} />
  )

  const save = async () => {
    setBusy(true)
    setError("")
    try {
      const result = customerId ? await updateCustomer(customerId, { ...form, expectedRevision: revision }) : await createCustomer(form)
      if (returnTo === "/invoices/new") await navigate({ to: "/invoices/new", search: { customer: result.customer.id } })
      else await navigate({ to: "/customers/$customerId", params: { customerId: result.customer.id } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pelanggan gagal disimpan")
    } finally {
      setBusy(false)
    }
  }

  const HeadingIcon = customerId ? UserPen : UserPlus

  return (
    <div className="space-y-4 pb-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl"><HeadingIcon className="size-5 text-primary" aria-hidden="true" />{customerId ? "Edit pelanggan" : "Tambah pelanggan"}</h1>
        <p className="text-sm text-muted-foreground">Informasi kontak dan alamat.</p>
      </div>
      {error && <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}</p>}
      <Card>
        <CardContent className="grid gap-4 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Contact className="size-4 text-primary" aria-hidden="true" />Informasi Kontak</h2>
          {field("name", "Nama", User, true)}
          {field("email", "Email", Mail)}
          {field("phone", "Telepon / WhatsApp", Phone)}
          <h2 className="mt-2 flex items-center gap-2 font-semibold"><MapPin className="size-4 text-primary" aria-hidden="true" />Alamat</h2>
          {field("addressLine1", "Alamat baris 1", MapPin)}
          {field("addressLine2", "Alamat baris 2", MapPin)}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("district", "Kecamatan", Map)}
            {field("city", "Kota / Kabupaten", Map)}
            {field("province", "Provinsi", Map)}
            {field("postalCode", "Kode pos", Hash)}
          </div>
        </CardContent>
      </Card>
      <Button className="w-full" disabled={busy || !form.name.trim()} onClick={() => void save()}>
        <Save aria-hidden="true" />
        {busy ? "Menyimpan…" : "Simpan pelanggan"}
      </Button>
    </div>
  )
}

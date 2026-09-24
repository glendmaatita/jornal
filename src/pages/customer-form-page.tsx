import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { AlertTriangle, Contact, Hash, Map, MapPin, Mail, Phone, Save, User, UserPen, UserPlus, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TextField } from "@/components/ui/text-field"
import { createCustomer, getCustomer, OFFLINE_INVOICE_SYNCED_EVENT, queueCustomerCreate, updateCustomer } from "@/lib/invoice-client"
import { clearMirroredState, mirrorState, restoreState } from "@/lib/local-db"
import { getDataScope } from "@/lib/store"

const empty = { name: "", email: "", phone: "", addressLine1: "", addressLine2: "", district: "", city: "", province: "", postalCode: "" }

function initialCustomerDraft(storageKey: string, customerId?: string) {
  if (customerId) return { form: empty, restored: false }
  try {
    const saved = localStorage.getItem(storageKey)
    return saved ? { form: { ...empty, ...JSON.parse(saved) as typeof empty }, restored: true } : { form: empty, restored: false }
  } catch { return { form: empty, restored: false } }
}

export function CustomerFormPage({ customerId, returnTo }: { customerId?: string; returnTo?: string }) {
  const navigate = useNavigate()
  const formStorageKey = `jornal.customer-compose.${getDataScope()}.v2`
  const [initial] = useState(() => initialCustomerDraft(formStorageKey, customerId))
  const [form, setForm] = useState(initial.form)
  const [draftReady, setDraftReady] = useState(Boolean(customerId || initial.restored))
  const userEditedDraft = useRef(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    if (customerId || initial.restored) return
    let cancelled = false
    void restoreState(formStorageKey)
      .then((value) => {
        if (cancelled || userEditedDraft.current || !value || typeof value !== "object") return
        setForm({ ...empty, ...value as typeof empty })
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setDraftReady(true) })
    return () => { cancelled = true }
  }, [customerId, formStorageKey, initial.restored])

  useEffect(() => {
    if (!customerId) return
    void getCustomer(customerId)
      .then(({ customer }) => {
        setForm({ name: customer.name, email: customer.email || "", phone: customer.phone || "", addressLine1: customer.addressLine1 || "", addressLine2: customer.addressLine2 || "", district: customer.district || "", city: customer.city || "", province: customer.province || "", postalCode: customer.postalCode || "" })
        setRevision(customer.revision)
      })
      .catch((cause) => setError(String(cause)))
  }, [customerId])

  useEffect(() => {
    if (customerId || !draftReady) return
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(formStorageKey, JSON.stringify(form)) } catch { /* IndexedDB remains available */ }
      void mirrorState(formStorageKey, form).catch(() => undefined)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [customerId, draftReady, form, formStorageKey])

  useEffect(() => {
    if (customerId) return
    const onSynced = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; storageKey?: string; serverId?: string }>).detail
      if (detail?.kind !== "customer" || detail.storageKey !== formStorageKey || !detail.serverId) return
      if (returnTo === "/invoices/new") void navigate({ to: "/invoices/new", search: { customer: detail.serverId } })
      else void navigate({ to: "/customers/$customerId", params: { customerId: detail.serverId } })
    }
    window.addEventListener(OFFLINE_INVOICE_SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(OFFLINE_INVOICE_SYNCED_EVENT, onSynced)
  }, [customerId, formStorageKey, navigate, returnTo])

  const field = (key: keyof typeof form, label: string, icon: LucideIcon, required = false) => (
    <TextField label={label} icon={icon} value={form[key]} onChange={(value) => { userEditedDraft.current = true; setForm((current) => ({ ...current, [key]: value })) }} required={required} />
  )

  const save = async () => {
    setBusy(true)
    setError("")
    setNotice("")
    try {
      if (!customerId && navigator.onLine === false) {
        await queueCustomerCreate(form, formStorageKey)
        setNotice("Pelanggan disimpan di perangkat dan akan ditambahkan otomatis saat kembali online.")
        return
      }
      const result = customerId ? await updateCustomer(customerId, { ...form, expectedRevision: revision }) : await createCustomer(form)
      if (!customerId) {
        try { localStorage.removeItem(formStorageKey) } catch { /* durable cleanup follows */ }
        await clearMirroredState(formStorageKey).catch(() => undefined)
      }
      if (returnTo === "/invoices/new") await navigate({ to: "/invoices/new", search: { customer: result.customer.id } })
      else await navigate({ to: "/customers/$customerId", params: { customerId: result.customer.id } })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Pelanggan gagal disimpan"
      const connectivityFailure = cause instanceof TypeError || /failed to fetch|network|offline|load failed/i.test(message)
      if (!customerId && connectivityFailure) {
        await queueCustomerCreate(form, formStorageKey)
        setNotice("Koneksi terputus. Pelanggan diamankan di perangkat dan akan ditambahkan saat online.")
        return
      }
      setError(message)
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
      {notice && <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800" role="status">{notice}</p>}
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

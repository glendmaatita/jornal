import { useEffect, useId, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "@tanstack/react-router"
import { Eye, EyeOff, FileText, Inbox, LogOut, Menu, Settings, Users, Wallet, X } from "lucide-react"

import { cn } from "@/lib/utils"

const links = [
  { to: "/customers", label: "Pelanggan", icon: Users },
  { to: "/invoices", label: "Invoice", icon: FileText },
  { to: "/inbox", label: "Inbox dokumen", icon: Inbox },
  { to: "/accounts", label: "Rekening", icon: Wallet },
  { to: "/settings", label: "Pengaturan", icon: Settings },
] as const

export function MoreMenu({
  pathname,
  privacy,
  onTogglePrivacy,
  userEmail,
  onLogout,
}: {
  pathname: string
  privacy: boolean
  onTogglePrivacy: () => void
  userEmail: string | null
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const anyActive = links.some((link) => pathname.startsWith(link.to))

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  const itemClass = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] font-semibold transition-colors hover:bg-[var(--background)] sm:py-2.5 sm:text-sm"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className={cn("grid size-9 place-items-center rounded-full transition-colors hover:bg-white", anyActive && "text-[var(--link)]")}
      >
        <Menu className="size-[20px]" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-50" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/40 sm:bg-transparent" aria-label="Tutup menu" onClick={() => setOpen(false)} />
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute inset-x-0 bottom-0 mx-auto max-w-[600px] rounded-t-2xl bg-white p-3 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-2xl sm:inset-x-auto sm:top-[54px] sm:right-[max(20px,calc((100vw-600px)/2+20px))] sm:bottom-auto sm:w-64 sm:rounded-2xl sm:border sm:border-[#e4e8ed] sm:p-2 sm:shadow-[0_12px_40px_rgb(27_29_77/0.16)]"
          >
            <div className="mb-1 flex items-center justify-between px-3 pt-1 sm:hidden">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--body-text)]">Menu</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Tutup" className="grid size-8 place-items-center rounded-full hover:bg-[var(--background)]">
                <X className="size-[18px]" aria-hidden="true" />
              </button>
            </div>
            <nav className="grid gap-0.5">
              {links.map((link) => {
                const active = pathname.startsWith(link.to)
                return (
                  <Link key={link.to} to={link.to} onClick={() => setOpen(false)} className={cn(itemClass, active && "bg-[var(--background)] text-[var(--link)]")} aria-current={active ? "page" : undefined}>
                    <link.icon className="size-[20px] shrink-0" aria-hidden="true" />
                    {link.label}
                  </Link>
                )
              })}
            </nav>
            <div className="my-1.5 border-t border-[#e4e8ed]" />
            <button type="button" onClick={() => { onTogglePrivacy(); setOpen(false) }} className={itemClass} aria-pressed={privacy}>
              {privacy ? <EyeOff className="size-[20px] shrink-0" aria-hidden="true" /> : <Eye className="size-[20px] shrink-0" aria-hidden="true" />}
              {privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}
            </button>
            {userEmail && (
              <button type="button" onClick={() => { setOpen(false); onLogout() }} className={cn(itemClass, "text-red-600 hover:bg-red-50")} title={`Keluar (${userEmail})`}>
                <LogOut className="size-[20px] shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>Keluar</span>
                  <span className="truncate text-xs font-normal text-[var(--body-text)]">{userEmail}</span>
                </span>
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

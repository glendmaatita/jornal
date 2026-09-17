import { Suspense, lazy, useEffect, useRef, useState } from "react"
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { BarChart3, Eye, EyeOff, FileText, Home as HomeIcon, Inbox, LogOut, Plus, ReceiptText, Search, Settings, Users, Wallet } from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { CompanySwitcher } from "@/components/company-switcher"
import { PwaStatus } from "@/components/pwa-status"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { currentUser, logout, pb } from "@/lib/pb"
import { activeCompany } from "@/lib/companies"
import { resetPocketBaseSyncState } from "@/lib/pocketbase-sync"
import { disablePushNotifications } from "@/lib/push-client"
import { setDataScope, setTenantScope } from "@/lib/store"
import { cn } from "@/lib/utils"

// Deferred below the first paint: PocketBase sync + recurring rules pull in
// the store/query/tax graph, which is not needed to render the shell.
const DeferredEffects = lazy(() =>
  import("@/components/deferred-effects").then((m) => ({ default: m.DeferredEffects })),
)

const tabs = [
  { to: "/", label: "Home", icon: HomeIcon, exact: true },
  { to: "/transactions", label: "Transaksi", icon: ReceiptText, exact: false },
  { to: "/tax", label: "Pajak", icon: Wallet, exact: false },
  { to: "/insights", label: "Insights", icon: BarChart3, exact: false },
] as const

export function AppShell() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { canInstall, install, isIos, isInstalled } = useInstallPrompt()
  const user = currentUser()
  const company = activeCompany()
  const authUserIdRef = useRef(pb.authStore.record?.id ?? null)
  const [privacy, setPrivacy] = useState(() => window.localStorage.getItem("jornal.privacy-mode") === "1")
  const [showIosInstall, setShowIosInstall] = useState(false)

  useEffect(() => {
    const onAuthChange = () => {
      // Switch the storage partition before queries can render after a login,
      // logout, or token refresh. This prevents a stale tenant's data from
      // briefly appearing while React invalidates the previous cache.
      const nextUserId = pb.authStore.record?.id ?? null
      setTenantScope(nextUserId)
      if (nextUserId !== authUserIdRef.current) {
        authUserIdRef.current = nextUserId
        resetPocketBaseSyncState()
        queryClient.cancelQueries()
        queryClient.clear()
      }
    }
    const unsubscribe = pb.authStore.onChange(onAuthChange)
    const onStorage = (event: StorageEvent) => {
      // PocketBase LocalAuthStore persists under pocketbase_auth. React to another
      // tab clearing or replacing that value before rendering its data.
      if (event.key === "pocketbase_auth" || event.key === null) onAuthChange()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      unsubscribe()
      window.removeEventListener("storage", onStorage)
    }
  }, [queryClient])

  useEffect(() => {
    // Ask once per browser profile after login. Persistence is feature
    // detected; denial must not block the local-first app.
    if (!navigator.storage?.persist) return
    try {
      if (sessionStorage.getItem("jornal.storage-requested") === "1") return
      sessionStorage.setItem("jornal.storage-requested", "1")
    } catch {
      // Session storage can be disabled in private browsing; persistence is
      // still safe to request once for this render.
    }
    void navigator.storage.persist().catch(() => false)
  }, [])

  useEffect(() => { document.documentElement.classList.toggle("privacy-mode", privacy); window.localStorage.setItem("jornal.privacy-mode", privacy ? "1" : "0") }, [privacy])

  useEffect(() => {
    if (!company?.id || pathname.startsWith("/companies") || pathname === "/onboarding") return
    const url = new URL(window.location.href)
    if (url.searchParams.get("company") === company.id) return
    url.searchParams.set("company", company.id)
    window.history.replaceState(window.history.state, "", url)
  }, [company?.id, pathname])

  async function handleLogout() {
    await disablePushNotifications().catch(() => undefined)
    queryClient.cancelQueries()
    queryClient.clear()
    setDataScope("local")
    logout()
    resetPocketBaseSyncState()
    void navigate({ to: "/login", replace: true })
  }

  return (
    <div className="min-h-dvh pb-[calc(76px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-40 border-b border-[#e4e8ed] bg-[var(--background)]">
        <div className="mx-auto flex h-[50px] max-w-[600px] items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-2">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Jornal">
            <BrandMark className="size-8" />
            <span className="hidden text-[15px] font-bold tracking-tight sm:inline">Jornal</span>
          </Link>
          <CompanySwitcher />
          </div>
          <div className="flex items-center gap-1">
            {canInstall && (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--link)]"
              >
                Pasang aplikasi
              </button>
            )}
            {isIos && !isInstalled && !canInstall && <button type="button" onClick={() => setShowIosInstall(true)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--link)]">Pasang aplikasi</button>}
            {user && (
              <button
                type="button"
                onClick={() => void handleLogout()}
                title={`Keluar (${user.email})`}
                aria-label="Keluar"
                className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white"
              >
                <LogOut className="size-[18px]" aria-hidden="true" />
              </button>
            )}
            <Link to="/customers" className={cn("hidden size-9 place-items-center rounded-full transition-colors hover:bg-white sm:grid", pathname.startsWith("/customers") && "text-[var(--link)]")} aria-label="Pelanggan"><Users className="size-[18px]" /></Link>
            <Link to="/invoices" className={cn("hidden size-9 place-items-center rounded-full transition-colors hover:bg-white sm:grid", pathname.startsWith("/invoices") && "text-[var(--link)]")} aria-label="Invoice"><FileText className="size-[18px]" /></Link>
            <Link to="/inbox" className={cn("hidden size-9 place-items-center rounded-full transition-colors hover:bg-white sm:grid", pathname.startsWith("/inbox") && "text-[var(--link)]")} aria-label="Inbox dokumen"><Inbox className="size-[18px]" /></Link>
            <Link to="/search" className={cn("grid size-9 place-items-center rounded-full transition-colors hover:bg-white", pathname === "/search" && "text-[var(--link)]")} aria-label="Cari"><Search className="size-[18px]" /></Link>
            <button type="button" onClick={() => setPrivacy((value) => !value)} className="hidden size-9 place-items-center rounded-full hover:bg-white sm:grid" aria-label={privacy ? "Tampilkan nominal" : "Sembunyikan nominal"}>{privacy ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}</button>
            <Link
              to="/accounts"
              className={cn(
                "grid size-9 place-items-center rounded-full transition-colors hover:bg-white",
                pathname === "/accounts" && "text-[var(--link)]",
              )}
              aria-label="Rekening"
            >
              <Wallet className="size-[18px]" aria-hidden="true" />
            </Link>
            <Link
              to="/settings"
              className={cn(
                "grid size-9 place-items-center rounded-full transition-colors hover:bg-white",
                pathname === "/settings" && "text-[var(--link)]",
              )}
              aria-label="Pengaturan"
            >
              <Settings className="size-[18px]" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[600px] px-5 pt-5">
        {company?.status === "ARCHIVED" && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <strong>{company.name}</strong> diarsipkan. Data hanya dapat dilihat atau diekspor sampai company dipulihkan.
          </div>
        )}
        <Suspense fallback={<div className="t12 py-10 text-center">Memuat…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <BottomNav pathname={pathname} readOnly={company?.status === "ARCHIVED"} />
      <PwaStatus />
      {showIosInstall && <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-4 sm:place-items-center" role="dialog" aria-modal="true" aria-label="Panduan memasang aplikasi"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><h2 className="text-lg font-bold">Pasang Jornal di iPhone/iPad</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm"><li>Ketuk tombol <strong>Bagikan</strong> di Safari.</li><li>Pilih <strong>Tambahkan ke Layar Utama</strong>.</li><li>Buka Jornal dari ikon baru sebelum mengaktifkan notifikasi.</li></ol><Button className="mt-4 w-full" onClick={() => setShowIosInstall(false)}>Mengerti</Button></div></div>}
      <Suspense fallback={null}>
        <DeferredEffects />
      </Suspense>
    </div>
  )
}

function BottomNav({ pathname, readOnly }: { pathname: string; readOnly: boolean }) {
  const isActive = (to: string, exact: boolean) => (exact ? pathname === to : pathname.startsWith(to))

  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[600px] rounded-t-[10px] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_rgb(27_29_77/0.08)]">
      <nav className="grid h-[68px] grid-cols-5 items-start pt-[10px] px-1">
        {tabs.slice(0, 2).map((tab) => (
          <TabLink key={tab.to} tab={tab} active={isActive(tab.to, tab.exact)} />
        ))}

        <div className="relative flex justify-center">
          {readOnly ? (
            <span className="absolute -top-7 grid size-[52px] place-items-center rounded-full bg-slate-300 text-white" aria-label="Company diarsipkan">
              <Plus className="size-6" aria-hidden="true" />
            </span>
          ) : (
            <Link
              to="/add"
              className="absolute -top-7 grid size-[52px] place-items-center rounded-full bg-[#16579d] text-white shadow-lg shadow-[#16579d]/25 transition-transform active:scale-95"
              aria-label="Tambah transaksi"
            >
              <Plus className="size-6" aria-hidden="true" />
            </Link>
          )}
        </div>

        {tabs.slice(2).map((tab) => (
          <TabLink key={tab.to} tab={tab} active={isActive(tab.to, tab.exact)} />
        ))}
      </nav>
    </footer>
  )
}

function TabLink({
  tab,
  active,
}: {
  tab: { to: string; label: string; icon: typeof HomeIcon }
  active: boolean
}) {
  return (
    <Link
      to={tab.to}
      className="flex flex-col items-center gap-[6px] py-1"
      aria-current={active ? "page" : undefined}
    >
      <tab.icon
        className={cn("size-[20px]", active ? "text-[var(--link)]" : "text-[var(--body-text)]")}
        aria-hidden="true"
      />
      <span className={cn("text-xs font-semibold leading-none", active ? "text-[var(--link)]" : "text-[var(--body-text)]")}>
        {tab.label}
      </span>
    </Link>
  )
}

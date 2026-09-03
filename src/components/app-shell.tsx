import { Suspense, lazy } from "react"
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { BarChart3, Home as HomeIcon, LogOut, Plus, ReceiptText, Settings, Wallet } from "lucide-react"

import { PwaStatus } from "@/components/pwa-status"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { currentUser, logout } from "@/lib/pb"
import { resetPocketBaseSyncState } from "@/lib/pocketbase-sync"
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
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { canInstall, install } = useInstallPrompt()
  const user = currentUser()

  function handleLogout() {
    logout()
    resetPocketBaseSyncState()
    void navigate({ to: "/login", replace: true })
  }

  return (
    <div className="min-h-dvh pb-[calc(76px+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-40 border-b border-[#e4e8ed] bg-[var(--background)]">
        <div className="mx-auto flex h-[50px] max-w-[600px] items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Jornal">
            <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--main-dark)] text-white shadow-sm">
              <Wallet className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Jornal</span>
          </Link>
          <div className="flex items-center gap-1">
            {canInstall && (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-[var(--link)]"
              >
                Install
              </button>
            )}
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                title={`Keluar (${user.email})`}
                aria-label="Keluar"
                className="grid size-9 place-items-center rounded-full transition-colors hover:bg-white"
              >
                <LogOut className="size-[18px]" aria-hidden="true" />
              </button>
            )}
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
        <Suspense fallback={<div className="t12 py-10 text-center">Memuat…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <BottomNav pathname={pathname} />
      <PwaStatus />
      <Suspense fallback={null}>
        <DeferredEffects />
      </Suspense>
    </div>
  )
}

function BottomNav({ pathname }: { pathname: string }) {
  const isActive = (to: string, exact: boolean) => (exact ? pathname === to : pathname.startsWith(to))

  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[600px] rounded-t-[10px] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_24px_rgb(27_29_77/0.08)]">
      <nav className="grid h-[68px] grid-cols-5 items-start pt-[10px] px-1">
        {tabs.slice(0, 2).map((tab) => (
          <TabLink key={tab.to} tab={tab} active={isActive(tab.to, tab.exact)} />
        ))}

        <div className="relative flex justify-center">
          <Link
            to="/add"
            className="absolute -top-7 grid size-[52px] place-items-center rounded-full bg-[linear-gradient(135deg,#97daff_0%,#16579d_100%)] text-white shadow-lg shadow-[#16579d]/25 transition-transform active:scale-95"
            aria-label="Tambah transaksi"
          >
            <Plus className="size-6" aria-hidden="true" />
          </Link>
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
      <span className={cn("text-[10px] font-semibold leading-none", active ? "text-[var(--link)]" : "text-[var(--body-text)]")}>
        {tab.label}
      </span>
    </Link>
  )
}

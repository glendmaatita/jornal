import { useEffect } from "react"
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { BarChart3, Home as HomeIcon, Plus, ReceiptText, Settings, Wallet } from "lucide-react"

import { PwaStatus } from "@/components/pwa-status"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { useFinancialEvents } from "@/lib/queries"
import { isOnboarded, processRecurringRules } from "@/lib/store"
import { initializePocketBaseSync } from "@/lib/pocketbase-sync"
import { CHANGED_EVENT } from "@/lib/types"
import { cn } from "@/lib/utils"

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
  useFinancialEvents()

  // Onboarding gate: first run goes to profile setup (§66 item 1–3)
  useEffect(() => {
    if (!isOnboarded() && pathname !== "/onboarding") {
      void navigate({ to: "/onboarding", replace: true })
    }
  }, [pathname, navigate])

  useEffect(() => {
    void (async () => {
      await initializePocketBaseSync()
      processRecurringRules()
      window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    })()
  }, [])

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
        <Outlet />
      </main>

      <BottomNav pathname={pathname} />
      <PwaStatus />
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

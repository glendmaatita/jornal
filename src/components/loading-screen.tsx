import { BrandMark } from "@/components/brand-mark"
import { cn } from "@/lib/utils"

type AppLoadingScreenProps = {
  title?: string
  message?: string
  overlay?: boolean
}

export function AppLoadingScreen({
  title = "Jornal",
  message = "Menyiapkan data Anda…",
  overlay = false,
}: AppLoadingScreenProps) {
  return (
    <main
      className={cn(
        "grid min-h-dvh place-items-center bg-[var(--background)] px-6 text-center",
        overlay && "fixed inset-0 z-[100]",
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-sm flex-col items-center">
        <div className="relative">
          <span className="absolute -inset-3 animate-pulse rounded-[26px] bg-[#97daff]/35" aria-hidden="true" />
          <BrandMark className="relative size-16 shadow-lg shadow-[#1b1d4d]/15" />
        </div>
        <h1 className="mt-6 text-xl tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[var(--body-text)]">{message}</p>
        <span className="mt-5 block h-1.5 w-28 overflow-hidden rounded-full bg-[#ced6e1]" aria-hidden="true">
          <span className="block h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-[#16579d]" />
        </span>
      </div>
    </main>
  )
}

export function PageLoading({ label = "Memuat halaman…" }: { label?: string }) {
  return (
    <div className="space-y-4 pb-8" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="h-7 w-40 animate-pulse rounded-lg bg-white/80" aria-hidden="true" />
      <div className="space-y-3 rounded-[10px] bg-white p-5 shadow-[0_1px_2px_rgb(27_29_77/0.04)]" aria-hidden="true">
        <div className="h-4 w-28 animate-pulse rounded bg-[#e4e8ed]" />
        <div className="h-9 w-52 max-w-full animate-pulse rounded-lg bg-[#dbe3eb]" />
        <div className="h-3 w-full animate-pulse rounded bg-[#edf0f2]" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-[#edf0f2]" />
      </div>
      <div className="grid grid-cols-2 gap-3" aria-hidden="true">
        <div className="h-24 animate-pulse rounded-[10px] bg-white/80" />
        <div className="h-24 animate-pulse rounded-[10px] bg-white/80" />
      </div>
    </div>
  )
}

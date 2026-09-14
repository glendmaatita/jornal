import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"

import { BrandMark } from "@/components/brand-mark"
import { PwaStatus } from "@/components/pwa-status"
import { useInstallPrompt } from "@/hooks/use-install-prompt"
import { loginWithGoogle, pb, pocketBaseConfigured } from "@/lib/pb"
import { resetPocketBaseSyncState } from "@/lib/pocketbase-sync"
import { setDataScope } from "@/lib/store"

export function LoginPage() {
  const navigate = useNavigate()
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const { canInstall, install } = useInstallPrompt()

  async function handleGoogleLogin() {
    setError("")
    setPending(true)
    try {
      await loginWithGoogle()
      setDataScope(pb.authStore.record?.id)
      // Fresh hydration/sync cycle for this tenant.
      resetPocketBaseSyncState()
      await navigate({ to: "/" })
    } catch {
      setError(
        pocketBaseConfigured
          ? "Gagal masuk dengan Google. Pastikan Google OAuth aktif di PocketBase, lalu coba lagi."
          : "Login Google belum terhubung. Jalankan PocketBase dan isi VITE_POCKETBASE_URL di .env.local.",
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--background)] px-5">
      <div className="w-full max-w-[360px] text-center">
        <BrandMark className="mx-auto size-16" />
        <h1 className="mt-4 text-xl font-bold tracking-tight">Jornal</h1>
        <p className="mt-2 t13 text-[var(--body-text)]">
          Catat uang masuk &amp; keluar bisnis. Masuk untuk sinkron antar perangkat.
        </p>

        <button
          type="button"
          onClick={() => void handleGoogleLogin()}
          disabled={pending}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-[#e4e8ed] bg-white px-4 py-3 text-[15px] font-semibold text-[var(--body-text)] shadow-sm transition-colors hover:bg-[#f7f8fa] disabled:opacity-60"
        >
          <GoogleIcon />
          {pending ? "Membuka Google…" : "Masuk dengan Google"}
        </button>
        {error && <p className="mt-3 t13 text-red-600">{error}</p>}
        {canInstall && (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-4 w-full rounded-xl border border-[#ced6e1] bg-[#f1f5fd] px-4 py-3 text-sm font-semibold text-[#1b1d4d] transition-colors hover:bg-[#e8eefc]"
          >
            Install Jornal di perangkat
          </button>
        )}
      </div>
      <PwaStatus />
    </div>
  )
}


function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z" />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  )
}

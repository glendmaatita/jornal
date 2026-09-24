import { Component, StrictMode, Suspense, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"

import { AppLoadingScreen } from "@/components/loading-screen"
import { DialogProvider } from "@/components/ui/app-dialog"
import { router } from "@/router"
import "@/index.css"
import "@fontsource/poppins/latin-400.css"
import "@fontsource/poppins/latin-700.css"
import "@fontsource/poppins/latin-900.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    console.error("Jornal render failed")
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-5 text-center">
        <div className="max-w-sm">
          <h1 className="text-2xl tracking-tight">Jornal perlu dimuat ulang</h1>
          <p className="mt-2 text-sm text-[var(--body-text)]">Data di perangkat tetap tersimpan. Muat ulang untuk melanjutkan.</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground" onClick={() => window.location.reload()}>
              Muat ulang
            </button>
            <a href="/" className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground">Ke beranda</a>
          </div>
        </div>
      </main>
    )
  }
}

const rootElement = document.getElementById("root")

if (!rootElement) throw new Error("Root element was not found")

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <DialogProvider>
          <Suspense fallback={<AppLoadingScreen />}>
            <RouterProvider router={router} />
          </Suspense>
        </DialogProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
)

import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { VitePWA } from "vite-plugin-pwa"

// Inline the (small, single) CSS bundle into index.html to avoid a
// render-blocking stylesheet request on first paint.
function inlineBuildCss(): Plugin {
  return {
    name: "inline-build-css",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = (ctx as { bundle?: Record<string, { type: string; source: string | Uint8Array }> }).bundle
        if (!bundle) return html
        for (const [name, item] of Object.entries(bundle)) {
          if (item.type === "asset" && name.endsWith(".css")) {
            const css = typeof item.source === "string" ? item.source : Buffer.from(item.source).toString("utf8")
            delete bundle[name]
            return html.replace(
              /<link rel="stylesheet"[^>]*href="[^"]*\.css"[^>]*>/,
              () => `<style>${css}</style>`,
            )
          }
        }
        return html
      },
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    inlineBuildCss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "favicon-32x32.png", "apple-touch-icon.png"],
      manifest: {
        id: "/",
        name: "Jornal — Cashflow & Pajak Bisnis",
        short_name: "Jornal",
        description:
          "Catat uang masuk & keluar bisnis. Sistem mengurus klasifikasi, omzet, estimasi pajak, dan Safe To Spend.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#edf0f2",
        theme_color: "#1b1d4d",
        categories: ["business", "finance", "productivity"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Catat transaksi",
            short_name: "Tambah",
            url: "/add",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Uang masuk",
            short_name: "Masuk",
            url: "/add?direction=MONEY_IN",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Uang keluar",
            short_name: "Keluar",
            url: "/add?direction=MONEY_OUT",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Foto struk",
            short_name: "Struk",
            url: "/add?capture=receipt",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }],
          },
        ],
        // Supported browsers deliver shared receipt files to this route. The
        // page creates a review draft; it never uploads without user review.
        share_target: {
          action: "/add?shared=1",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "receipt", accept: ["image/*", "application/pdf"] }] },
        },
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/pb(?:\/|$)/, /^\/healthz(?:\/|$)/],
        globPatterns: ["**/*.{js,css,html,webmanifest}"],
      },
      devOptions: {
        enabled: true,
        suppressWarnings: true,
        navigateFallback: "/index.html",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})

import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, type Browser } from "playwright"
import { renderToStaticMarkup } from "react-dom/server"
import { InvoiceDocument } from "../../src/components/invoice/invoice-document"
import type { Invoice } from "../../src/lib/invoice-types"

const port = Number(process.env.PORT || 3100); const secret = process.env.INVOICE_RENDERER_SECRET || ""; let browserPromise: Promise<Browser> | null = null; let active = 0
const browser = () => browserPromise ||= chromium.launch({ headless: true })
async function font(weight: number) { const bytes = await readFile(resolve(import.meta.dir, `../../node_modules/@fontsource/poppins/files/poppins-latin-${weight}-normal.woff2`)); return `@font-face{font-family:Poppins;font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2')}` }
const fonts = Promise.all([400, 700, 900].map(font)).then((items) => items.join(""))

const server = Bun.serve({ port, hostname: "0.0.0.0", async fetch(request) {
  const url = new URL(request.url); if (url.pathname === "/healthz") return Response.json({ status: "ok", active })
  if (url.pathname !== "/render" || request.method !== "POST") return new Response("Not found", { status: 404 })
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 })
  if (active >= 2) return Response.json({ error: "Renderer sibuk" }, { status: 429 }); active += 1
  let context
  try {
    const body = await request.json() as { invoice: Invoice; logoDataUrl?: string | null; format: "pdf" | "png" }; const markup = renderToStaticMarkup(<InvoiceDocument invoice={body.invoice} logoDataUrl={body.logoDataUrl} />); const html = `<!doctype html><meta charset="utf-8"><style>${await fonts}html,body{margin:0;background:white}</style>${markup}`
    context = await (await browser()).newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1240 / 794 }); const page = await context.newPage(); await page.route("**/*", (route) => route.request().url().startsWith("data:") ? route.continue() : route.abort()); await page.setContent(html, { waitUntil: "load", timeout: 20_000 }); await page.evaluate(() => document.fonts.ready)
    const filename = `invoice-${String(body.invoice.invoiceNumber || body.invoice.id).replace(/[^a-zA-Z0-9_-]/g, "-")}.${body.format}`; const data = body.format === "pdf" ? await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }) : await page.locator("[data-invoice-document]").screenshot({ type: "png" }); if (data.byteLength > 20 * 1024 * 1024) return Response.json({ error: "Hasil render terlalu besar" }, { status: 413 }); return new Response(data, { headers: { "Content-Type": body.format === "pdf" ? "application/pdf" : "image/png", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } })
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Render gagal" }, { status: 500, headers: { "Cache-Control": "no-store" } }) } finally { await context?.close(); active -= 1 }
} })

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  server.stop(true)
  if (browserPromise) await browserPromise.then((instance) => instance.close()).catch(() => undefined)
  process.exit(0)
}
process.once("SIGTERM", () => void shutdown())
process.once("SIGINT", () => void shutdown())

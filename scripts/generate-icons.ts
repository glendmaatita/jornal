import { readFile, writeFile } from "node:fs/promises"
import { Resvg } from "@resvg/resvg-js"

const logo = await readFile(new URL("../src/assets/jornal-logo.svg", import.meta.url), "utf8")
// iOS and maskable launchers apply their own shape. Keep the background opaque;
// the letter and ledger strokes already fit inside the central 80% safe circle.
const squareLogo = logo.replace(/(<rect\b[^>]*?)\s+rx="[^"]*"/, "$1")
const publicDirectory = new URL("../public/", import.meta.url)

await writeFile(new URL("favicon.svg", publicDirectory), logo)
await writeFile(new URL("maskable.svg", publicDirectory), squareLogo)

for (const [name, size, source] of [
  ["favicon-32x32.png", 32, logo],
  ["apple-touch-icon.png", 180, squareLogo],
  ["pwa-192x192.png", 192, logo],
  ["pwa-512x512.png", 512, logo],
  ["maskable-512x512.png", 512, squareLogo],
] as const) {
  const image = new Resvg(source, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: false },
  }).render()
  await writeFile(new URL(name, publicDirectory), image.asPng())
  console.log(`Generated ${name} (${size}×${size})`)
}

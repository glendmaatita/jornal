export function printInvoice() { window.print() }

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export async function downloadInvoiceFile(invoiceId: string, invoiceNumber: string | null, format: "pdf" | "png") {
  const [{ activeCompany }, { pb }] = await Promise.all([import("./companies"), import("./pb")]); const company = activeCompany(); if (!company) throw new Error("Pilih company terlebih dahulu")
  const response = await fetch(`/api/invoice-files/${encodeURIComponent(invoiceId)}?company=${encodeURIComponent(company.id)}&epoch=${company.dataEpoch}&format=${format}`, { headers: { Authorization: pb.authStore.token } }); if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Ekspor invoice gagal") }; await shareOrDownload(await response.blob(), safeFilename(`invoice-${invoiceNumber || invoiceId}.${format}`))
}

export async function invoicePng(element: HTMLElement, filename: string) {
  const clone = element.cloneNode(true) as HTMLElement
  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 794 1123"><foreignObject width="794" height="1123"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`
  const image = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
  try { await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Dokumen gagal diraster")); image.src = url }); const canvas = document.createElement("canvas"); canvas.width = 1240; canvas.height = 1754; const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas tidak tersedia"); context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG gagal dibuat")), "image/png")); await shareOrDownload(blob, safeFilename(filename)) } finally { URL.revokeObjectURL(url) }
}

export async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type }); const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: filename }); return } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return } }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

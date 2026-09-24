export function printInvoice() { window.print() }

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "-")
}

export async function downloadInvoiceFile(invoiceId: string, invoiceNumber: string | null, format: "pdf" | "png") {
  const [{ activeCompany }, { pb }] = await Promise.all([import("./companies"), import("./pb")]); const company = activeCompany(); if (!company) throw new Error("Pilih company terlebih dahulu")
  const response = await fetch(`/api/invoice-files/${encodeURIComponent(invoiceId)}?company=${encodeURIComponent(company.id)}&epoch=${company.dataEpoch}&format=${format}`, { headers: { Authorization: pb.authStore.token } }); if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || "Ekspor invoice gagal") }; await shareOrDownload(await response.blob(), safeFilename(`invoice-${invoiceNumber || invoiceId}.${format}`))
}

async function renderInvoiceCanvas(element: HTMLElement) {
  const { default: html2canvas } = await import("html2canvas")
  const host = document.createElement("div")
  const clone = element.cloneNode(true) as HTMLElement
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;pointer-events:none;z-index:-2147483647"
  clone.style.transform = "none"
  host.append(clone)
  document.body.append(host)
  try {
    await document.fonts?.ready
    await Promise.all([...clone.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)))
    const width = clone.scrollWidth || 794
    const height = clone.scrollHeight || 1123
    return await html2canvas(clone, {
      allowTaint: false,
      backgroundColor: "#ffffff",
      height,
      logging: false,
      scale: 1240 / width,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: width,
    })
  } finally {
    host.remove()
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("File invoice gagal dibuat.")),
    type,
    quality,
  ))
}

export async function invoicePng(element: HTMLElement, filename: string) {
  const canvas = await renderInvoiceCanvas(element)
  await shareOrDownload(await canvasBlob(canvas, "image/png"), safeFilename(filename))
}

export async function invoicePdf(element: HTMLElement, filename: string) {
  const canvas = await renderInvoiceCanvas(element)
  const { jsPDF } = await import("jspdf")
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true })
  pdf.addImage(canvas, "JPEG", 0, 0, 210, 297, undefined, "FAST")
  await shareOrDownload(pdf.output("blob"), safeFilename(filename))
}

export async function shareOrDownload(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: blob.type }); const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: filename }); return } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return } }
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

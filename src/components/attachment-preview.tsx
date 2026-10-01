import { useEffect, useState } from "react"

type AttachmentPreviewProps = {
  name: string
  url: string
  mimeType?: string | null
}

function attachmentType(name: string, url: string, mimeType?: string | null) {
  const type = mimeType || (url.startsWith("data:") ? url.slice(5).split(/[;,]/, 1)[0] : "")
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf"
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(name)) return "image"
  return null
}

export function AttachmentPreview({ name, url, mimeType }: AttachmentPreviewProps) {
  const type = attachmentType(name, url, mimeType)
  const [resolvedPdf, setResolvedPdf] = useState<{ source: string; url: string | null }>(() => ({ source: url, url: url.startsWith("data:") ? null : url }))
  const pdfUrl = resolvedPdf.source === url ? resolvedPdf.url : null

  /* eslint-disable react-hooks/set-state-in-effect -- browser PDF viewers need a blob URL for base64 files */
  useEffect(() => {
    if (type !== "pdf" || !url.startsWith("data:")) {
      setResolvedPdf({ source: url, url })
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    setResolvedPdf({ source: url, url: null })
    void fetch(url).then((response) => response.blob()).then((blob) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setResolvedPdf({ source: url, url: objectUrl })
    }).catch(() => { if (!cancelled) setResolvedPdf({ source: url, url }) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [type, url])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!type) return null

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-white">
      {type === "image" ? (
        <img src={url} alt={`Pratinjau ${name}`} className="max-h-[60vh] w-full object-contain" />
      ) : (
        pdfUrl ? <iframe src={pdfUrl} title={`Pratinjau ${name}`} className="h-[60vh] min-h-80 w-full" /> : <p className="p-4 text-sm text-muted-foreground">Memuat PDF…</p>
      )}
    </div>
  )
}

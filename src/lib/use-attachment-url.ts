import { useEffect, useState } from "react"
import { getCompanyFileAccess } from "@/lib/pocketbase-sync"

export function useAttachmentUrl(dataUrl: string | null | undefined, remoteUrl: string | null | undefined) {
  const source = dataUrl ?? remoteUrl ?? null
  const [resolved, setResolved] = useState<{ source: string | null; url: string | null }>(() => ({ source, url: dataUrl ?? null }))

  /* eslint-disable react-hooks/set-state-in-effect -- refresh the URL when the selected attachment changes */
  useEffect(() => {
    let cancelled = false
    if (dataUrl || !remoteUrl) {
      setResolved({ source, url: dataUrl ?? null })
      return () => { cancelled = true }
    }
    setResolved({ source, url: null })
    void getCompanyFileAccess().then(({ token, grant }) => {
      if (cancelled) return
      const accessible = new URL(remoteUrl, window.location.origin)
      if (token && grant) {
        accessible.searchParams.set("token", token)
        accessible.searchParams.set("grant", grant)
      }
      setResolved({ source, url: accessible.toString() })
    }).catch(() => { if (!cancelled) setResolved({ source, url: remoteUrl }) })
    return () => { cancelled = true }
  }, [dataUrl, remoteUrl, source])
  /* eslint-enable react-hooks/set-state-in-effect */

  return resolved.source === source ? resolved.url : dataUrl ?? null
}

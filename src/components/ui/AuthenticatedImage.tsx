import { useEffect, useState, useRef } from "react"
import { useAuthStore } from "@/stores"
import { cn } from "@/lib/utils"
import { ImageOff } from "lucide-react"

interface Props {
  src: string
  alt?: string
  className?: string
  onClick?: () => void
  onError?: () => void
}

/**
 * Loads an image via fetch with the Authorization header, then renders
 * it as a blob URL. This is needed for /api/media endpoints that require
 * auth but can't receive it via the <img> src attribute.
 */
export function AuthenticatedImage({ src, alt = "image", className, onClick, onError }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!src) return
    setBlobUrl(null)
    setFailed(false)

    const token = useAuthStore.getState().token
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

    // Strip ?token=... from the src since we're using the header instead
    let cleanSrc = src
    try {
      const u = new URL(src, window.location.origin)
      u.searchParams.delete("token")
      cleanSrc = u.pathname + (u.search || "") + (u.hash || "")
    } catch {
      cleanSrc = src.replace(/[?&]token=[^&]*&?/, "").replace(/\?$/, "")
    }

    let cancelled = false
    fetch(cleanSrc, { headers })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.blob()
      })
      .then((blob) => {
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        urlRef.current = url
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          onError?.()
        }
      })

    return () => {
      cancelled = true
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-muted-foreground/40", className)}>
        <ImageOff className="w-5 h-5" />
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div className={cn("animate-pulse rounded-xl bg-muted/40", className)} />
    )
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      onClick={onClick}
      onError={() => { setFailed(true); onError?.() }}
    />
  )
}

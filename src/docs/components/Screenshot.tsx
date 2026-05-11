import * as Dialog from "@radix-ui/react-dialog"
import { useState } from "react"
import { X, ZoomIn } from "lucide-react"
import { cn } from "@/lib/utils"

interface ScreenshotProps {
  src: string
  alt?: string
  caption?: string
  zoom?: boolean
  width?: string | number
}

export function Screenshot({ src, alt, caption, zoom = false, width }: ScreenshotProps) {
  const [open, setOpen] = useState(false)

  const img = (
    <img
      src={src}
      alt={alt ?? caption ?? ""}
      loading="lazy"
      className={cn(
        "rounded-lg border border-border shadow-sm",
        zoom && "cursor-zoom-in hover:opacity-90 transition-opacity"
      )}
      style={{ width, maxWidth: "100%", height: "auto" }}
    />
  )

  return (
    <figure className="my-5">
      {zoom ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button type="button" className="block w-full text-left relative group">
              {img}
              <span className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="w-4 h-4" />
              </span>
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/80 z-[100]" />
            <Dialog.Content className="fixed inset-4 z-[101] flex items-center justify-center">
              <img src={src} alt={alt ?? caption ?? ""} className="max-w-full max-h-full rounded-lg" />
              <Dialog.Close className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        img
      )}
      {caption && (
        <figcaption className="mt-2 text-xs text-muted-foreground text-center">{caption}</figcaption>
      )}
    </figure>
  )
}

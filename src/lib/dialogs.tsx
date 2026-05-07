/**
 * Imperative confirm/alert dialogs — one styled UI for the whole app, no
 * browser-native `window.confirm` / `alert` / `prompt`.
 *
 * Usage:
 *   if (!await confirmDialog({ title: "Delete?", description: "Cannot be undone.", destructive: true })) return
 *   await alertDialog({ title: "Failed", description: err.message, tone: "error" })
 *
 * The functions resolve a Promise so they read like the native APIs they
 * replace — no extra useState bookkeeping at every callsite. <DialogHost>
 * (mounted once at the App root) renders the queued dialog.
 */
import { useEffect, useState } from "react"
import { AlertTriangle, Trash2, CheckCircle2, Info, XCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Tone = "info" | "success" | "warn" | "error"

interface ConfirmOpts {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface AlertOpts {
  title: string
  description?: string
  okLabel?: string
  tone?: Tone
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "alert"; opts: AlertOpts; resolve: () => void }

let listener: ((p: Pending) => void) | null = null

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    if (!listener) {
      // No host mounted (e.g. very early boot) — fall back to native so we
      // never silently swallow a user prompt.
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${opts.title}${opts.description ? `\n\n${opts.description}` : ""}`))
      return
    }
    listener({ kind: "confirm", opts, resolve })
  })
}

export function alertDialog(opts: AlertOpts): Promise<void> {
  return new Promise<void>(resolve => {
    if (!listener) {
      // eslint-disable-next-line no-alert
      window.alert(`${opts.title}${opts.description ? `\n\n${opts.description}` : ""}`)
      resolve()
      return
    }
    listener({ kind: "alert", opts, resolve })
  })
}

export function DialogHost() {
  const [queue, setQueue] = useState<Pending[]>([])
  const current = queue[0] ?? null

  useEffect(() => {
    listener = (p) => setQueue(q => [...q, p])
    return () => { listener = null }
  }, [])

  if (!current) return null

  const close = (action: () => void) => {
    action()
    setQueue(q => q.slice(1))
  }

  if (current.kind === "confirm") {
    const { title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive } = current.opts
    return (
      <DialogShell
        title={title}
        description={description}
        icon={destructive ? "destructive" : "warn"}
        onDismiss={() => close(() => current.resolve(false))}
        actions={
          <>
            <button
              onClick={() => close(() => current.resolve(false))}
              className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={() => close(() => current.resolve(true))}
              className={cn(
                "flex-1 py-2 rounded-xl text-sm font-semibold transition-colors",
                destructive
                  ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
                  : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
              )}
            >
              {confirmLabel}
            </button>
          </>
        }
      />
    )
  }

  const { title, description, okLabel = "OK", tone = "info" } = current.opts
  return (
    <DialogShell
      title={title}
      description={description}
      icon={tone}
      onDismiss={() => close(() => current.resolve())}
      actions={
        <button
          onClick={() => close(() => current.resolve())}
          className={cn(
            "flex-1 py-2 rounded-xl text-sm font-semibold transition-colors",
            tone === "error"
              ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
              : tone === "success"
              ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25"
              : tone === "warn"
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25"
              : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
          )}
        >
          {okLabel}
        </button>
      }
    />
  )
}

function DialogShell({
  title, description, icon, actions, onDismiss,
}: {
  title: string
  description?: string
  icon: "destructive" | "warn" | "info" | "success" | "error"
  actions: React.ReactNode
  onDismiss: () => void
}) {
  // Dismiss on Escape so dialogs feel native.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onDismiss])

  const tone =
    icon === "destructive" ? { wrap: "bg-red-500/10",     glyph: <Trash2 className="w-4 h-4 text-red-400" /> }
    : icon === "warn"      ? { wrap: "bg-amber-500/10",   glyph: <AlertTriangle className="w-4 h-4 text-amber-400" /> }
    : icon === "success"   ? { wrap: "bg-emerald-500/10", glyph: <CheckCircle2 className="w-4 h-4 text-emerald-400" /> }
    : icon === "error"     ? { wrap: "bg-red-500/10",     glyph: <XCircle className="w-4 h-4 text-red-400" /> }
                           : { wrap: "bg-primary/10",     glyph: <Info className="w-4 h-4 text-primary" /> }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />
      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={cn("shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5", tone.wrap)}>
            {tone.glyph}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground leading-snug">{title}</h2>
            {description && (
              <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed whitespace-pre-line break-words">{description}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">{actions}</div>
      </div>
    </div>
  )
}

// Re-export for callsites that want the spinner glyph alongside the dialog.
export { Loader2 as DialogLoader }

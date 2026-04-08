import { AlertTriangle, Trash2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!loading ? onCancel : undefined} />
      <div className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className={cn(
            "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5",
            destructive ? "bg-red-500/10" : "bg-amber-500/10"
          )}>
            {destructive
              ? <Trash2 className="w-4 h-4 text-red-400" />
              : <AlertTriangle className="w-4 h-4 text-amber-400" />
            }
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground leading-snug">{title}</h2>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high disabled:opacity-40 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40",
              destructive
                ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25"
                : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
            )}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

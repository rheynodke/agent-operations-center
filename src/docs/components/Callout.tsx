import { Info, AlertTriangle, Lightbulb, AlertOctagon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export type CalloutType = "info" | "warning" | "tip" | "danger"

interface CalloutProps {
  type?: CalloutType
  title?: string
  children: ReactNode
}

const STYLES: Record<CalloutType, { bg: string; border: string; text: string; Icon: typeof Info }> = {
  info: {
    bg: "bg-blue-500/10 dark:bg-blue-500/15",
    border: "border-blue-500/40",
    text: "text-blue-900 dark:text-blue-100",
    Icon: Info,
  },
  warning: {
    bg: "bg-amber-500/10 dark:bg-amber-500/15",
    border: "border-amber-500/40",
    text: "text-amber-900 dark:text-amber-100",
    Icon: AlertTriangle,
  },
  tip: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/15",
    border: "border-emerald-500/40",
    text: "text-emerald-900 dark:text-emerald-100",
    Icon: Lightbulb,
  },
  danger: {
    bg: "bg-red-500/10 dark:bg-red-500/15",
    border: "border-red-500/40",
    text: "text-red-900 dark:text-red-100",
    Icon: AlertOctagon,
  },
}

export function Callout({ type = "info", title, children }: CalloutProps) {
  const style = STYLES[type]
  const { Icon } = style
  return (
    <aside
      className={cn(
        "my-5 rounded-lg border-l-4 px-4 py-3 flex gap-3",
        style.bg,
        style.border,
        style.text
      )}
      role="note"
    >
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">
        {title && <p className="font-semibold mb-1">{title}</p>}
        <div className="text-sm leading-relaxed [&>p]:my-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
          {children}
        </div>
      </div>
    </aside>
  )
}

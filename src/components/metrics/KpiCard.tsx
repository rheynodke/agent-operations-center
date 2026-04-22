import React from "react"
import { ArrowUp, ArrowDown, Minus, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: string | number
  /** Delta percentage vs previous window. null means no baseline available. */
  deltaPct?: number | null
  /** When true, an up-arrow renders red instead of green (e.g. for blocked count). */
  invertGood?: boolean
  icon?: LucideIcon
  /** Accent color for the icon (emerald, amber, blue, etc.). */
  tone?: "emerald" | "amber" | "blue" | "red" | "violet"
  loading?: boolean
  compareLabel?: string
}

const TONE_CLASSES: Record<string, { bg: string; text: string }> = {
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400" },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-400" },
  blue:    { bg: "bg-blue-500/10",    text: "text-blue-400" },
  red:     { bg: "bg-red-500/10",     text: "text-red-400" },
  violet:  { bg: "bg-violet-500/10",  text: "text-violet-400" },
}

export function KpiCard({
  label, value, deltaPct, invertGood = false, icon: Icon, tone = "blue", loading, compareLabel,
}: KpiCardProps) {
  const toneCls = TONE_CLASSES[tone]
  let deltaColor = "text-muted-foreground/60"
  let DeltaIcon: LucideIcon = Minus
  if (deltaPct != null && deltaPct !== 0) {
    const positive = deltaPct > 0
    const good = invertGood ? !positive : positive
    deltaColor = good ? "text-emerald-400" : "text-red-400"
    DeltaIcon = positive ? ArrowUp : ArrowDown
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-2">
      <div className="flex items-center gap-2">
        {Icon && (
          <div className={cn("h-7 w-7 rounded-md flex items-center justify-center shrink-0", toneCls.bg)}>
            <Icon className={cn("h-3.5 w-3.5", toneCls.text)} />
          </div>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {loading ? <span className="inline-block h-6 w-16 rounded bg-muted/40 animate-pulse" /> : value}
        </span>
        {!loading && deltaPct != null && (
          <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums", deltaColor)}>
            <DeltaIcon className="h-3 w-3" />
            {deltaPct === 0 ? "0%" : `${Math.abs(deltaPct)}%`}
          </span>
        )}
      </div>
      {compareLabel && !loading && (
        <p className="text-[10px] text-muted-foreground/50">{compareLabel}</p>
      )}
    </div>
  )
}

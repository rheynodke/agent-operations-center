import React from "react"
import { cn } from "@/lib/utils"

interface PriorityConfig {
  bars: number
  color: string
  label: string
  textColor: string
}

const PRIORITY_CONFIG: Record<string, PriorityConfig> = {
  low:    { bars: 1, color: "bg-zinc-400",   label: "Low",    textColor: "text-zinc-400" },
  medium: { bars: 2, color: "bg-blue-400",   label: "Medium", textColor: "text-blue-400" },
  high:   { bars: 3, color: "bg-orange-400", label: "High",   textColor: "text-orange-400" },
  urgent: { bars: 4, color: "bg-red-500",    label: "Urgent", textColor: "text-red-500" },
}

// Heights for each bar slot (1→4 increasing)
const BAR_HEIGHTS = ["h-1.5", "h-2.5", "h-3.5", "h-5"]

interface PriorityIndicatorProps {
  priority?: string
  showLabel?: boolean
  className?: string
}

export function PriorityIndicator({ priority, showLabel = false, className }: PriorityIndicatorProps) {
  const cfg = (priority ? PRIORITY_CONFIG[priority] : null) ?? PRIORITY_CONFIG.medium

  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)}>
      {BAR_HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-sm transition-colors",
            h,
            i < cfg.bars ? cfg.color : "bg-muted-foreground/20"
          )}
        />
      ))}
      {showLabel && (
        <span className={cn("ml-1.5 text-xs font-medium leading-none", cfg.textColor)}>
          {cfg.label}
        </span>
      )}
    </span>
  )
}

export { PRIORITY_CONFIG }

import React from "react"
import { AlertCircle, ArrowUp, Minus, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface PriorityConfig {
  bars: number
  color: string         // bar/icon background tone (kept for legacy bars mode)
  label: string
  textColor: string     // label color
  iconColor: string     // standalone icon color
  Icon: React.ComponentType<{ className?: string }>
}

// Icon convention (Linear-style):
//   urgent  → AlertCircle (red, attention)
//   high    → ArrowUp (orange)
//   medium  → Minus (blue, single dash — neutral)
//   low     → ArrowDown (zinc)
const PRIORITY_CONFIG: Record<string, PriorityConfig> = {
  urgent: { bars: 4, color: "bg-red-500",    label: "Urgent", textColor: "text-red-500",    iconColor: "text-red-500",    Icon: AlertCircle },
  high:   { bars: 3, color: "bg-orange-400", label: "High",   textColor: "text-orange-400", iconColor: "text-orange-400", Icon: ArrowUp },
  medium: { bars: 2, color: "bg-blue-400",   label: "Medium", textColor: "text-blue-400",   iconColor: "text-blue-400",   Icon: Minus },
  low:    { bars: 1, color: "bg-zinc-400",   label: "Low",    textColor: "text-zinc-400",   iconColor: "text-zinc-400",   Icon: ArrowDown },
}

const BAR_HEIGHTS = ["h-1.5", "h-2.5", "h-3.5", "h-5"]

interface PriorityIndicatorProps {
  priority?: string
  /** Render the label beside the visual indicator. */
  showLabel?: boolean
  /**
   * Visual style.
   *   'icon'  (default) — colored lucide icon, plays nice in tight selects.
   *   'bars'  — original 4-bar level meter (taller, needs vertical space).
   */
  variant?: "icon" | "bars"
  className?: string
}

export function PriorityIndicator({
  priority, showLabel = false, variant = "icon", className,
}: PriorityIndicatorProps) {
  const cfg = (priority ? PRIORITY_CONFIG[priority] : null) ?? PRIORITY_CONFIG.medium
  const { Icon } = cfg

  if (variant === "bars") {
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

  // Icon variant (default)
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.iconColor)} />
      {showLabel && (
        <span className={cn("text-xs font-medium leading-none", cfg.textColor)}>
          {cfg.label}
        </span>
      )}
    </span>
  )
}

export { PRIORITY_CONFIG }

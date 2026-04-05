import * as React from "react"
import { cn } from "@/lib/utils"
import type { AgentStatus } from "@/types"

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "status" | "outline" | "secondary"
  status?: AgentStatus
}

const statusStyles: Record<AgentStatus, string> = {
  active: "status-active",
  idle: "status-idle",
  paused: "status-paused",
  error: "status-error",
  terminated: "status-idle",
}

const statusLabels: Record<AgentStatus, string> = {
  active: "Active",
  idle: "Idle",
  paused: "Paused",
  error: "Error",
  terminated: "Terminated",
}

function Badge({ className, variant = "default", status, children, ...props }: BadgeProps) {
  if (variant === "status" && status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
          statusStyles[status],
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "active" && "pulse-dot bg-[var(--status-active-text)]",
            status === "idle" && "bg-[var(--status-idle-text)] opacity-50",
            status === "paused" && "bg-[var(--status-paused-text)]",
            status === "error" && "bg-[var(--status-error-text)]",
            status === "terminated" && "bg-[var(--status-idle-text)] opacity-30",
          )}
        />
        {children ?? statusLabels[status]}
      </span>
    )
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "bg-accent/20 text-accent-foreground",
        variant === "secondary" && "bg-secondary text-muted-foreground",
        variant === "outline" && "border border-border text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export { Badge }

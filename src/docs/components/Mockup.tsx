import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Search, ChevronDown } from "lucide-react"

/**
 * <Mockup> — visual UI mockup wrapper (styled like a browser/app window).
 *
 * Composition example (works in MDX):
 *
 *   <Mockup label="/agents">
 *     <MockupToolbar>
 *       <MockupInput placeholder="Search agents..." />
 *       <MockupDropdown>Owner: Me</MockupDropdown>
 *       <MockupButton variant="primary">+ New Agent</MockupButton>
 *     </MockupToolbar>
 *     <MockupGrid>
 *       <MockupAgentCard emoji="🧭" name="Aira" role="master" status="active" />
 *       ...
 *     </MockupGrid>
 *   </Mockup>
 */

interface MockupProps {
  label?: string
  children: ReactNode
  className?: string
}

export function Mockup({ label, children, className }: MockupProps) {
  return (
    <div
      className={cn(
        "not-prose my-6 rounded-xl border border-border bg-card shadow-md overflow-hidden",
        className
      )}
    >
      {/* Faux titlebar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
        </div>
        {label && (
          <div className="flex-1 text-center">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-background border border-border text-[11px] font-mono text-muted-foreground">
              {label}
            </span>
          </div>
        )}
      </div>
      {/* Content */}
      <div className="p-4 sm:p-5 bg-background/60">{children}</div>
    </div>
  )
}

interface MockupToolbarProps {
  children: ReactNode
  className?: string
}

export function MockupToolbar({ children, className }: MockupToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 mb-4 pb-3 border-b border-border/50 flex-wrap",
        className
      )}
    >
      {children}
    </div>
  )
}

interface MockupInputProps {
  placeholder?: string
  value?: string
  className?: string
  showIcon?: boolean
}

export function MockupInput({
  placeholder,
  value,
  className,
  showIcon = true,
}: MockupInputProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 h-8 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground min-w-[180px]",
        className
      )}
    >
      {showIcon && <Search className="w-3.5 h-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{value ?? placeholder ?? ""}</span>
    </div>
  )
}

interface MockupDropdownProps {
  children: ReactNode
  className?: string
}

export function MockupDropdown({ children, className }: MockupDropdownProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-8 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground",
        className
      )}
    >
      <span>{children}</span>
      <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-60" aria-hidden />
    </div>
  )
}

type ButtonVariant = "primary" | "secondary" | "ghost"

interface MockupButtonProps {
  children: ReactNode
  variant?: ButtonVariant
  className?: string
}

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-muted text-foreground border border-border hover:bg-muted/80",
  ghost: "bg-transparent text-muted-foreground hover:bg-muted/50",
}

export function MockupButton({ children, variant = "secondary", className }: MockupButtonProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-8 rounded-md text-sm font-medium transition-colors",
        BUTTON_VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

interface MockupGridProps {
  children: ReactNode
  cols?: 1 | 2 | 3 | 4
  className?: string
}

export function MockupGrid({ children, cols = 3, className }: MockupGridProps) {
  const colsCls = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  }[cols]
  return <div className={cn("grid gap-3", colsCls, className)}>{children}</div>
}

type AgentStatus = "active" | "idle" | "processing" | "paused" | "error"

interface MockupStatusPillProps {
  status: AgentStatus
  className?: string
}

const STATUS_PILL: Record<
  AgentStatus,
  { bg: string; border: string; dot: string; text: string; label: string; pulse?: boolean }
> = {
  active: {
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/30",
    dot: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
    text: "text-emerald-300",
    label: "Active",
  },
  idle: {
    bg: "bg-foreground/8",
    border: "border-border/60",
    dot: "bg-foreground/25",
    text: "text-muted-foreground/50",
    label: "Idle",
  },
  processing: {
    bg: "bg-amber-500/15",
    border: "border-amber-500/30",
    dot: "bg-amber-400",
    text: "text-amber-300",
    label: "Working",
    pulse: true,
  },
  paused: {
    bg: "bg-sky-500/15",
    border: "border-sky-500/30",
    dot: "bg-sky-400",
    text: "text-sky-300",
    label: "Paused",
  },
  error: {
    bg: "bg-red-500/15",
    border: "border-red-500/30",
    dot: "bg-red-400",
    text: "text-red-300",
    label: "Error",
  },
}

export function MockupStatusPill({ status, className }: MockupStatusPillProps) {
  const s = STATUS_PILL[status]
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border backdrop-blur-sm",
        s.bg,
        s.border,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", s.dot, s.pulse && "animate-pulse")} />
      <span className={cn("text-[9px] font-bold uppercase tracking-wider", s.text)}>
        {s.label}
      </span>
    </div>
  )
}

interface MockupAgentCardProps {
  /** Avatar preset ID dari AVATAR_PRESETS, mis. "emerald", "violet", "cyan". Render <img src="/avatars/bot-{id}.png">. */
  avatarPresetId?: string
  /** Fallback emoji kalau avatarPresetId tidak di-set */
  emoji?: string
  name: string
  /** Agent ID — first 4 chars akan ditampilkan as hash di top-left */
  id?: string
  /** ADLC role label (mis. "MASTER ORCHESTRATOR", "SOFTWARE ENGINEER") */
  role?: string
  /** Hex color buat role accent (mis. "#a78bfa") */
  roleColor?: string
  /** ADLC agent number (1-9) — ditampilkan di pill kecil */
  roleNumber?: number
  /** Emoji untuk role (selain agent emoji utama) */
  roleEmoji?: string
  status?: AgentStatus
  /** Vibe / description kecil di tengah card */
  vibe?: string
  /** Stats: jumlah sessions */
  sessions?: number
  /** Total cost (USD) */
  cost?: number
  /** Total tokens */
  tokens?: number
  /** Channel icons */
  channels?: ("telegram" | "whatsapp" | "discord")[]
  /** Model name di footer */
  model?: string
  className?: string
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
  return String(n)
}

function formatCost(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`
}

const CHANNEL_ASSET: Record<"telegram" | "whatsapp" | "discord", { src: string; label: string }> = {
  telegram: { src: "/telegram.webp", label: "Telegram" },
  whatsapp: { src: "/wa.png", label: "WhatsApp" },
  discord: { src: "/discord.png", label: "Discord" },
}

export function MockupAgentCard({
  avatarPresetId,
  emoji = "🤖",
  name,
  id = "abcd",
  role,
  roleColor,
  roleNumber,
  roleEmoji,
  status = "idle",
  vibe,
  sessions,
  cost,
  tokens,
  channels,
  model = "default model",
  className,
}: MockupAgentCardProps) {
  const heroBg = roleColor
    ? `radial-gradient(ellipse at 50% 0%, ${roleColor}22 0%, transparent 70%)`
    : status === "processing"
      ? "radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 70%)"
      : "radial-gradient(ellipse at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 70%)"

  return (
    <div
      className={cn(
        "relative bg-card border border-border rounded-2xl overflow-hidden flex flex-col",
        status === "processing" && "shadow-[0_0_24px_rgba(245,158,11,0.08)]",
        className
      )}
      style={roleColor ? { borderColor: `${roleColor}40` } : undefined}
    >
      {/* Role accent strip at top */}
      {roleColor && (
        <div
          className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
          style={{
            background: `linear-gradient(90deg, transparent, ${roleColor}90, transparent)`,
          }}
        />
      )}

      {/* Hero header */}
      <div className="relative px-4 pt-5 pb-3 flex flex-col items-center" style={{ background: heroBg }}>
        <div className="absolute top-3 right-3">
          <MockupStatusPill status={status} />
        </div>
        <div className="absolute top-3.5 left-3.5">
          <span className="text-[8px] font-mono font-bold text-muted-foreground/30 uppercase tracking-widest">
            #{id.slice(0, 4).toUpperCase()}
          </span>
        </div>

        <div className="mt-1 mb-3 w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-transparent">
          {avatarPresetId ? (
            <img
              src={`/avatars/bot-${avatarPresetId}.png`}
              alt={name}
              className="w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="w-full h-full rounded-xl flex items-center justify-center bg-white/5 ring-1 ring-white/8 text-3xl leading-none">
              {emoji}
            </div>
          )}
        </div>

        <h3 className="font-bold text-foreground text-sm tracking-tight leading-tight text-center mb-1">
          {name}
        </h3>

        {role && roleColor ? (
          <div className="flex items-center gap-1 max-w-full px-0.5">
            {roleNumber != null && (
              <span
                className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black leading-none"
                style={{ backgroundColor: roleColor, color: "#000" }}
              >
                {roleNumber}
              </span>
            )}
            {roleEmoji && <span className="text-[10px] leading-none shrink-0">{roleEmoji}</span>}
            <span
              className="text-[9px] font-bold uppercase tracking-wider truncate"
              style={{ color: roleColor }}
            >
              {role}
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/40 font-medium">Autonomous Agent</span>
        )}
      </div>

      <div className="h-px bg-border/60 mx-4" />

      <div className="flex flex-col flex-1 px-4 py-3 gap-2.5">
        {vibe ? (
          <p className="text-[10.5px] text-muted-foreground/60 leading-snug line-clamp-2 text-center min-h-[2.5em] italic">
            {vibe}
          </p>
        ) : (
          <div className="min-h-[2.5em]" />
        )}

        <div className="grid grid-cols-3 gap-1.5 mt-auto">
          <div className="flex flex-col items-center gap-0.5 bg-foreground/[0.03] rounded-lg py-1.5 px-1">
            <span className="text-[11px] font-bold text-foreground/70 tabular-nums leading-none">
              {sessions ?? 0}
            </span>
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wide font-semibold">
              Sessions
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-foreground/[0.03] rounded-lg py-1.5 px-1">
            <span className="text-[11px] font-bold text-foreground/70 tabular-nums leading-none">
              {cost != null && cost > 0 ? formatCost(cost) : "—"}
            </span>
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wide font-semibold">
              Cost
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5 bg-foreground/[0.03] rounded-lg py-1.5 px-1">
            <span className="text-[11px] font-bold text-foreground/70 tabular-nums leading-none">
              {tokens != null && tokens > 0 ? formatTokens(tokens) : "—"}
            </span>
            <span className="text-[8px] text-muted-foreground/40 uppercase tracking-wide font-semibold">
              Tokens
            </span>
          </div>
        </div>

        {channels && channels.length > 0 && (
          <div className="flex items-center justify-center gap-2 mt-2.5 pt-2.5 border-t border-border/40">
            <span className="text-[8px] text-muted-foreground/30 uppercase tracking-wider font-semibold mr-0.5">
              Channels
            </span>
            {channels.map((c) => (
              <img
                key={c}
                src={CHANNEL_ASSET[c].src}
                alt={CHANNEL_ASSET[c].label}
                title={CHANNEL_ASSET[c].label}
                className="w-4 h-4 rounded object-contain opacity-70"
                draggable={false}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-border/40 bg-foreground/[0.015]">
        <span className="w-1 h-1 rounded-full bg-muted-foreground/25" />
        <span className="text-[9.5px] font-mono text-muted-foreground/40 truncate max-w-full">
          {model}
        </span>
      </div>
    </div>
  )
}

interface MockupStatusFilterProps {
  active?: AgentStatus | "all"
  className?: string
}

const FILTER_OPTIONS: ("all" | AgentStatus)[] = ["all", "active", "idle", "paused", "error"]

/** Pill-style status filter row matching real /agents page */
export function MockupStatusFilter({ active = "all", className }: MockupStatusFilterProps) {
  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      {FILTER_OPTIONS.map((s) => {
        const isActive = s === active
        return (
          <span
            key={s}
            className={cn(
              "px-3 py-1.5 rounded-full text-[11px] font-medium capitalize whitespace-nowrap",
              isActive
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-transparent text-muted-foreground border border-transparent"
            )}
          >
            {s}
          </span>
        )
      })}
    </div>
  )
}

interface MockupBoxProps {
  title?: string
  subtitle?: string
  emoji?: string
  /** Image URL untuk icon (light theme variant — atau base). */
  iconSrc?: string
  /** Optional dark-theme variant. Kalau set: light-theme = iconSrc, dark-theme = iconSrcDark. */
  iconSrcDark?: string
  /** Alt text untuk image (default: title) */
  iconAlt?: string
  /** Apply CSS `invert + brightness` di dark theme — useful untuk monochrome icon yang dark di dark bg. */
  iconInvertOnDark?: boolean
  variant?: "default" | "primary" | "muted"
  children?: ReactNode
  className?: string
}

const BOX_VARIANT = {
  default: "bg-card border-border",
  primary: "bg-primary/5 border-primary/40",
  muted: "bg-muted/40 border-border/60",
}

export function MockupBox({
  title,
  subtitle,
  emoji,
  iconSrc,
  iconSrcDark,
  iconAlt,
  iconInvertOnDark,
  variant = "default",
  children,
  className,
}: MockupBoxProps) {
  const altText = iconAlt ?? title ?? ""
  const baseImgCls = "w-5 h-5 rounded object-contain shrink-0"

  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex flex-col gap-1.5",
        BOX_VARIANT[variant],
        className
      )}
    >
      {(title || emoji || iconSrc) && (
        <div className="flex items-center gap-2">
          {iconSrc ? (
            iconSrcDark ? (
              // Two images, swap by theme via Tailwind dark: utilities
              <>
                <img
                  src={iconSrc}
                  alt={altText}
                  className={cn(baseImgCls, "block dark:hidden")}
                  draggable={false}
                />
                <img
                  src={iconSrcDark}
                  alt={altText}
                  className={cn(baseImgCls, "hidden dark:block")}
                  draggable={false}
                />
              </>
            ) : (
              <img
                src={iconSrc}
                alt={altText}
                className={cn(baseImgCls, iconInvertOnDark && "dark:invert dark:brightness-110")}
                draggable={false}
              />
            )
          ) : (
            emoji && <span className="text-base">{emoji}</span>
          )}
          {title && (
            <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
          )}
        </div>
      )}
      {subtitle && <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>}
      {children && <div className="text-xs text-muted-foreground/90 mt-1">{children}</div>}
    </div>
  )
}

interface MockupArrowProps {
  direction?: "right" | "down" | "left" | "up"
  label?: string
  className?: string
}

export function MockupArrow({ direction = "right", label, className }: MockupArrowProps) {
  const arrow = { right: "→", left: "←", down: "↓", up: "↑" }[direction]
  return (
    <div
      className={cn(
        "flex items-center justify-center text-muted-foreground/70",
        direction === "down" || direction === "up"
          ? "flex-col py-1"
          : "flex-row px-2",
        className
      )}
      aria-hidden
    >
      {label && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-1">
          {label}
        </span>
      )}
      <span className="text-lg leading-none">{arrow}</span>
    </div>
  )
}

interface MockupFlowProps {
  children: ReactNode
  direction?: "horizontal" | "vertical"
  className?: string
}

export function MockupFlow({ children, direction = "horizontal", className }: MockupFlowProps) {
  return (
    <div
      className={cn(
        "flex gap-2 items-stretch",
        direction === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className
      )}
    >
      {children}
    </div>
  )
}

interface MockupKanbanProps {
  children: ReactNode
  className?: string
}

export function MockupKanban({ children, className }: MockupKanbanProps) {
  return (
    <div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3", className)}>
      {children}
    </div>
  )
}

interface MockupKanbanColumnProps {
  title: string
  count?: number
  accent?: "neutral" | "primary" | "warning" | "success"
  children: ReactNode
  className?: string
}

const COLUMN_ACCENT = {
  neutral: "border-t-border",
  primary: "border-t-primary",
  warning: "border-t-amber-500",
  success: "border-t-emerald-500",
}

export function MockupKanbanColumn({
  title,
  count,
  accent = "neutral",
  children,
  className,
}: MockupKanbanColumnProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-muted/30 border border-border border-t-2 p-2.5 flex flex-col gap-2",
        COLUMN_ACCENT[accent],
        className
      )}
    >
      <div className="flex items-center justify-between px-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {count !== undefined && (
          <span className="text-[11px] font-mono text-muted-foreground/70">{count}</span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

type Priority = "urgent" | "high" | "medium" | "low"

interface MockupTaskCardProps {
  title: string
  priority?: Priority
  agent?: string
  className?: string
}

const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40",
  high: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40",
  medium: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/40",
  low: "bg-muted text-muted-foreground border-border",
}

export function MockupTaskCard({ title, priority, agent, className }: MockupTaskCardProps) {
  return (
    <div className={cn("rounded-md bg-card border border-border p-2.5 flex flex-col gap-1.5", className)}>
      <p className="text-xs font-medium text-foreground leading-snug">{title}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {priority && (
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border",
              PRIORITY_STYLE[priority]
            )}
          >
            {priority}
          </span>
        )}
        {agent && (
          <span className="text-[10px] text-muted-foreground font-mono">@{agent}</span>
        )}
      </div>
    </div>
  )
}

interface MockupTabItem {
  label: string
  icon?: string
  /** Optional small indicator (mis. count "12" atau dot) */
  badge?: string
  /** Online status dot indikator (mis. di tab Channels) */
  statusDot?: "online" | "offline"
}

interface MockupTabBarProps {
  tabs: MockupTabItem[]
  /** Index dari active tab (0-based) */
  active?: number
  className?: string
}

/** Match real Agent Detail tab bar — `border-b-2`, primary color active. */
export function MockupTabBar({ tabs, active = 0, className }: MockupTabBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-0 px-3 border-b border-border bg-foreground/2 overflow-x-auto",
        className
      )}
    >
      {tabs.map((tab, i) => {
        const isActive = i === active
        return (
          <span
            key={i}
            className={cn(
              "flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            )}
          >
            {tab.icon && <span className="text-sm leading-none">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge && (
              <span
                className={cn(
                  "ml-1 text-[9px] px-1 py-px rounded font-mono",
                  isActive ? "bg-primary/20 text-primary" : "bg-foreground/5 text-muted-foreground"
                )}
              >
                {tab.badge}
              </span>
            )}
            {tab.statusDot && (
              <span
                className={cn(
                  "ml-1 w-1.5 h-1.5 rounded-full",
                  tab.statusDot === "online" ? "bg-emerald-500" : "bg-foreground/20"
                )}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}

interface MockupActionMenuItem {
  icon?: string
  label: string
  shortcut?: string
  /** Hint role/permission yang dibutuhin (mis. "admin only") */
  hint?: string
  /** Variant warna (default neutral, danger merah, primary brand) */
  variant?: "default" | "danger" | "primary"
  /** Tampil sebagai disabled */
  disabled?: boolean
}

interface MockupActionMenuProps {
  /** Title menu di atas (mis. "Agent Aira") */
  title?: string
  items: (MockupActionMenuItem | "separator")[]
  className?: string
}

/** Context-menu / dropdown menu mockup — useful untuk "Quick action" docs sections. */
export function MockupActionMenu({ title, items, className }: MockupActionMenuProps) {
  return (
    <div
      className={cn(
        "inline-flex flex-col rounded-lg bg-popover border border-border shadow-xl shadow-black/30 backdrop-blur-sm py-1 min-w-[260px]",
        className
      )}
    >
      {title && (
        <>
          <div className="px-3 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
              {title}
            </p>
          </div>
          <div className="h-px bg-border/60 mx-1" />
        </>
      )}
      {items.map((item, i) => {
        if (item === "separator") {
          return <div key={i} className="h-px bg-border/60 my-1 mx-1" />
        }
        const variantCls =
          item.variant === "danger"
            ? "text-red-400"
            : item.variant === "primary"
              ? "text-primary"
              : "text-foreground/85"
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors",
              item.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-foreground/5",
              variantCls
            )}
          >
            {item.icon && (
              <span className="text-[15px] leading-none w-4 text-center shrink-0">{item.icon}</span>
            )}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 font-bold">
                {item.hint}
              </span>
            )}
            {item.shortcut && (
              <span className="text-[10px] font-mono text-muted-foreground/40 px-1.5 py-px rounded border border-border/60">
                {item.shortcut}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

type StatusDotKind = "success" | "warning" | "error" | "idle" | "info"

const STATUS_DOT: Record<StatusDotKind, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  idle: "bg-foreground/40",
  info: "bg-blue-500",
}

export function StatusDot({
  kind = "idle",
  pulse,
  className,
}: {
  kind?: StatusDotKind
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-block w-2 h-2 rounded-full align-middle",
        STATUS_DOT[kind],
        pulse && "animate-pulse",
        className
      )}
      aria-hidden
    />
  )
}

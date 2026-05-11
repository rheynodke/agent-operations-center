import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

type Mode = "daily" | "weekdays" | "weekends" | "custom-days" | "monthly" | "hourly" | "advanced"

interface Config {
  mode: Mode
  hour: number       // 0-23
  minute: number     // 0-59
  days: number[]     // 0=Sun … 6=Sat, used in custom-days
  dayOfMonth: number // 1-31, used in monthly
  everyHours: number // 1-12, used in hourly
  raw: string        // user-typed cron, used in advanced
}

const DEFAULT: Config = {
  mode: "weekdays",
  hour: 9,
  minute: 0,
  days: [1, 2, 3, 4, 5],
  dayOfMonth: 1,
  everyHours: 1,
  raw: "0 9 * * 1-5",
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

// ─── Parse + serialise ─────────────────────────────────────────────────────────

function parseCron(s: string | undefined): Config {
  if (!s) return { ...DEFAULT }
  const parts = s.trim().split(/\s+/)
  if (parts.length !== 5) return { ...DEFAULT, mode: "advanced", raw: s }
  const [mStr, hStr, dom, mon, dow] = parts

  // Hourly: */N pattern in hour position
  const hourlyMatch = /^\*\/(\d+)$/.exec(hStr)
  if (hourlyMatch && dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(mStr)) {
    return {
      ...DEFAULT,
      mode: "hourly",
      minute: clamp(parseInt(mStr, 10), 0, 59),
      everyHours: clamp(parseInt(hourlyMatch[1], 10), 1, 12),
    }
  }

  const minute = parseInt(mStr, 10)
  const hour = parseInt(hStr, 10)
  if (isNaN(minute) || isNaN(hour) || mon !== "*") {
    return { ...DEFAULT, mode: "advanced", raw: s }
  }

  // Daily: * * * (everyday)
  if (dom === "*" && dow === "*") {
    return { ...DEFAULT, mode: "daily", hour, minute }
  }

  // Weekdays: 1-5
  if (dom === "*" && (dow === "1-5" || dow === "MON-FRI")) {
    return { ...DEFAULT, mode: "weekdays", hour, minute, days: [1, 2, 3, 4, 5] }
  }

  // Weekends: 0,6 or 6,0
  if (dom === "*" && (dow === "0,6" || dow === "6,0" || dow === "SAT,SUN" || dow === "SUN,SAT")) {
    return { ...DEFAULT, mode: "weekends", hour, minute, days: [0, 6] }
  }

  // Custom weekdays: comma list of 0-6
  if (dom === "*" && /^[\d,]+$/.test(dow)) {
    const days = dow.split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 6)
    if (days.length > 0) {
      return { ...DEFAULT, mode: "custom-days", hour, minute, days: [...new Set(days)].sort() }
    }
  }

  // Monthly: dom is a number, dow is *
  if (dow === "*" && /^\d+$/.test(dom)) {
    return { ...DEFAULT, mode: "monthly", hour, minute, dayOfMonth: clamp(parseInt(dom, 10), 1, 31) }
  }

  return { ...DEFAULT, mode: "advanced", raw: s }
}

function toCron(c: Config): string {
  const m = c.minute
  const h = c.hour
  switch (c.mode) {
    case "daily":       return `${m} ${h} * * *`
    case "weekdays":    return `${m} ${h} * * 1-5`
    case "weekends":    return `${m} ${h} * * 0,6`
    case "custom-days": {
      const sorted = [...new Set(c.days)].sort((a, b) => a - b)
      return `${m} ${h} * * ${sorted.length === 0 ? "*" : sorted.join(",")}`
    }
    case "monthly":     return `${m} ${h} ${c.dayOfMonth} * *`
    case "hourly":      return `${m} */${c.everyHours} * * *`
    case "advanced":    return c.raw
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

// ─── Human preview ─────────────────────────────────────────────────────────────

function humanPreview(c: Config, tzLabel?: string): string {
  const time = `${pad2(c.hour)}:${pad2(c.minute)}`
  const tz = tzLabel ? ` ${tzLabel}` : ""
  switch (c.mode) {
    case "daily":    return `Every day at ${time}${tz}`
    case "weekdays": return `Every weekday (Mon-Fri) at ${time}${tz}`
    case "weekends": return `Every weekend (Sat-Sun) at ${time}${tz}`
    case "custom-days": {
      if (c.days.length === 0) return "Select at least one day"
      const names = [...c.days].sort((a, b) => a - b).map((d) => DOW_LABELS[d])
      return `Every ${formatList(names)} at ${time}${tz}`
    }
    case "monthly": {
      const ord = ordinal(c.dayOfMonth)
      return `Every month on the ${ord} at ${time}${tz}`
    }
    case "hourly": {
      const everyText = c.everyHours === 1 ? "hour" : `${c.everyHours} hours`
      return `Every ${everyText} at minute ${pad2(c.minute)}${tz}`
    }
    case "advanced":
      return `Custom cron expression — ${c.raw || "(empty)"}`
  }
}

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

function formatList(items: string[]): string {
  if (items.length === 0) return ""
  if (items.length === 1) return items[0]
  if (items.length === 2) return items.join(" & ")
  return items.slice(0, -1).join(", ") + " & " + items[items.length - 1]
}

// ─── UI ────────────────────────────────────────────────────────────────────────

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "daily",       label: "Daily",        hint: "Once per day" },
  { value: "weekdays",    label: "Weekdays",     hint: "Mon-Fri" },
  { value: "weekends",    label: "Weekends",     hint: "Sat & Sun" },
  { value: "custom-days", label: "Custom days",  hint: "Pick days" },
  { value: "monthly",     label: "Monthly",      hint: "Day of month" },
  { value: "hourly",      label: "Hourly",       hint: "Every N hours" },
  { value: "advanced",    label: "Advanced",     hint: "Raw cron" },
]

interface Props {
  value: string
  onChange: (cron: string) => void
  tzLabel?: string
}

export function CronScheduleBuilder({ value, onChange, tzLabel }: Props) {
  const [config, setConfig] = useState<Config>(() => parseCron(value))

  // Re-parse if external value changes (e.g. on dialog open with existing job)
  useEffect(() => {
    const parsed = parseCron(value)
    if (toCron(parsed) !== toCron(config)) {
      setConfig(parsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function update(patch: Partial<Config>) {
    const next = { ...config, ...patch }
    setConfig(next)
    onChange(toCron(next))
  }

  const preview = useMemo(() => humanPreview(config, tzLabel), [config, tzLabel])

  const showTime = config.mode !== "advanced" && config.mode !== "hourly"

  return (
    <div className="space-y-2">
      {/* Mode chips */}
      <div className="flex flex-wrap gap-1">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => update({ mode: m.value })}
            title={m.hint}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
              config.mode === m.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-surface-high border-border"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Body: per-mode controls (compact, single row where possible) */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {showTime && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">at</span>
            <Input
              type="time"
              value={`${pad2(config.hour)}:${pad2(config.minute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map((x) => parseInt(x, 10))
                if (!isNaN(h) && !isNaN(m)) update({ hour: clamp(h, 0, 23), minute: clamp(m, 0, 59) })
              }}
              className="w-28 h-8 font-mono text-xs"
            />
          </div>
        )}

        {config.mode === "custom-days" && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">on</span>
            <div className="flex gap-0.5">
              {DOW_LABELS.map((label, idx) => {
                const active = config.days.includes(idx)
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? config.days.filter((d) => d !== idx)
                        : [...config.days, idx]
                      update({ days: next })
                    }}
                    className={cn(
                      "w-9 h-8 rounded text-[11px] font-medium border transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground hover:text-foreground border-border"
                    )}
                  >
                    {label.slice(0, 2)}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {config.mode === "monthly" && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">on day</span>
            <Input
              type="number"
              min={1}
              max={31}
              value={config.dayOfMonth}
              onChange={(e) => update({ dayOfMonth: clamp(parseInt(e.target.value, 10) || 1, 1, 31) })}
              className="w-16 h-8 text-xs"
            />
            {config.dayOfMonth > 28 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠ skipped in short months
              </span>
            )}
          </div>
        )}

        {config.mode === "hourly" && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground">every</span>
            <Input
              type="number"
              min={1}
              max={12}
              value={config.everyHours}
              onChange={(e) => update({ everyHours: clamp(parseInt(e.target.value, 10) || 1, 1, 12) })}
              className="w-14 h-8 text-xs"
            />
            <span className="text-muted-foreground">
              {config.everyHours === 1 ? "hour, at minute" : "hours, at minute"}
            </span>
            <Input
              type="number"
              min={0}
              max={59}
              value={config.minute}
              onChange={(e) => update({ minute: clamp(parseInt(e.target.value, 10) || 0, 0, 59) })}
              className="w-14 h-8 text-xs"
            />
          </div>
        )}

        {config.mode === "advanced" && (
          <div className="flex-1 min-w-[200px]">
            <Input
              value={config.raw}
              onChange={(e) => update({ raw: e.target.value })}
              placeholder="0 9 * * 1-5"
              className="h-8 font-mono text-xs"
            />
          </div>
        )}
      </div>

      {/* Human preview line */}
      <div className="flex items-center gap-2 text-[11px] pl-0.5">
        <span className="text-primary">↻</span>
        <span className="text-foreground">{preview}</span>
        <span className="font-mono text-muted-foreground/50">· {toCron(config) || "(empty)"}</span>
      </div>
    </div>
  )
}

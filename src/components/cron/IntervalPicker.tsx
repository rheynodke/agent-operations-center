import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Unit = "m" | "h" | "d"

interface State { value: number; unit: Unit }

function parse(s: string | undefined): State {
  if (!s) return { value: 30, unit: "m" }
  const m = /^(\d+)\s*([mhd])$/i.exec(s.trim())
  if (!m) return { value: 30, unit: "m" }
  return { value: Math.max(1, parseInt(m[1], 10)), unit: m[2].toLowerCase() as Unit }
}

function serialise(s: State): string {
  return `${Math.max(1, s.value)}${s.unit}`
}

const UNITS: { value: Unit; label: string }[] = [
  { value: "m", label: "Minutes" },
  { value: "h", label: "Hours" },
  { value: "d", label: "Days" },
]

export function IntervalPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const state = parse(value)

  function update(patch: Partial<State>) {
    const next = { ...state, ...patch }
    onChange(serialise(next))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">every</span>
        <Input
          type="number"
          min={1}
          value={state.value}
          onChange={(e) => update({ value: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-16 h-8 text-xs"
        />
        <div className="flex gap-0.5">
          {UNITS.map((u) => (
            <button
              key={u.value}
              type="button"
              onClick={() => update({ unit: u.value })}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
                state.unit === u.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary text-muted-foreground hover:text-foreground border-border"
              )}
            >
              {u.label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground pl-0.5">
        <span className="text-primary">↻</span> Runs every <span className="text-foreground font-medium">{state.value} {UNITS.find(u => u.value === state.unit)?.label.toLowerCase()}</span>
      </div>
    </div>
  )
}

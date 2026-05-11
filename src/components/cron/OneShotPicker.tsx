import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Mode = "absolute" | "relative"

function detectMode(s: string | undefined): Mode {
  if (!s) return "relative"
  return /^\d+\s*[mhdw]$/i.test(s.trim()) ? "relative" : "absolute"
}

function pad2(n: number): string { return n.toString().padStart(2, "0") }

/** Convert an ISO datetime string to `<input type=datetime-local>` value (local TZ). */
function isoToLocalInput(s: string | undefined): string {
  if (!s) {
    // Default to "in 5 minutes" rounded to next 5
    const d = new Date(Date.now() + 5 * 60 * 1000)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }
  const d = new Date(s)
  if (isNaN(d.getTime())) return ""
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function localInputToIso(s: string): string {
  if (!s) return ""
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toISOString()
}

export function OneShotPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [mode, setMode] = useState<Mode>(() => detectMode(value))

  // Local state for absolute mode so input doesn't re-format on every keystroke
  const [localInput, setLocalInput] = useState(() => mode === "absolute" ? isoToLocalInput(value) : "")
  const [relValue, setRelValue] = useState<number>(() => {
    if (mode !== "relative") return 20
    const m = /^(\d+)\s*[mhdw]?$/i.exec(value || "")
    return m ? parseInt(m[1], 10) : 20
  })
  const [relUnit, setRelUnit] = useState<"m" | "h" | "d" | "w">(() => {
    if (mode !== "relative") return "m"
    const m = /^\d+\s*([mhdw])$/i.exec(value || "")
    return (m ? m[1].toLowerCase() : "m") as "m" | "h" | "d" | "w"
  })

  useEffect(() => {
    if (mode === "absolute") {
      onChange(localInputToIso(localInput))
    } else {
      onChange(`${Math.max(1, relValue)}${relUnit}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, localInput, relValue, relUnit])

  return (
    <div className="space-y-2">
      <div className="flex gap-0.5">
        <button
          type="button"
          onClick={() => setMode("relative")}
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
            mode === "relative"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary text-muted-foreground hover:text-foreground border-border"
          )}
        >
          In … from now
        </button>
        <button
          type="button"
          onClick={() => setMode("absolute")}
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
            mode === "absolute"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-secondary text-muted-foreground hover:text-foreground border-border"
          )}
        >
          At specific time
        </button>
      </div>

      {mode === "relative" ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">in</span>
          <Input
            type="number"
            min={1}
            value={relValue}
            onChange={(e) => setRelValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 h-8 text-xs"
          />
          <select
            value={relUnit}
            onChange={(e) => setRelUnit(e.target.value as "m" | "h" | "d" | "w")}
            className="rounded-md bg-secondary border border-border px-2 py-1 text-xs h-8"
          >
            <option value="m">minutes</option>
            <option value="h">hours</option>
            <option value="d">days</option>
            <option value="w">weeks</option>
          </select>
          <span className="text-muted-foreground">from now</span>
        </div>
      ) : (
        <Input
          type="datetime-local"
          value={localInput}
          onChange={(e) => setLocalInput(e.target.value)}
          className="font-mono w-56 h-8 text-xs"
        />
      )}
    </div>
  )
}

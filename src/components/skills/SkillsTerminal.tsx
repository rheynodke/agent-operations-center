import { useEffect, useMemo, useRef, useState } from "react"
import { useXTerm } from "react-xtermjs"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal as TerminalIcon, ChevronRight, ChevronLeft, RotateCw } from "lucide-react"
import { useAuthStore } from "@/stores"
import { cn } from "@/lib/utils"

const THEME = {
  background: "#0b0b0f",
  foreground: "#e5e5e5",
  cursor: "#22d3ee",
  selectionBackground: "#ffffff22",
  black: "#000000",
  red: "#ef4444",
  green: "#22c55e",
  yellow: "#eab308",
  blue: "#3b82f6",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#e5e5e5",
  brightBlack: "#4b5563",
  brightRed: "#f87171",
  brightGreen: "#4ade80",
  brightYellow: "#facc15",
  brightBlue: "#60a5fa",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#ffffff",
}

function TerminalBody({ epoch, onRestart, onClose, connected, setConnected }: {
  epoch: number
  onRestart: () => void
  onClose: () => void
  connected: boolean
  setConnected: (v: boolean) => void
}) {
  const token = useAuthStore((s) => s.token)
  const fitAddon = useMemo(() => new FitAddon(), [])
  const addons = useMemo(() => [fitAddon], [fitAddon])
  const options = useMemo(() => ({
    theme: THEME,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: 12,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
  }), [])
  const { instance, ref } = useXTerm({ options, addons })
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!instance || !token) return

    // Fit to container
    try { fitAddon.fit() } catch {}
    instance.focus()

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    const host = window.location.port === "5173" ? "localhost:18800" : window.location.host
    const ws = new WebSocket(`${protocol}//${host}/ws/terminal?token=${token}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      try { fitAddon.fit() } catch {}
      ws.send(JSON.stringify({ type: "resize", cols: instance.cols, rows: instance.rows }))
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        if (msg.type === "output") instance.write(msg.data)
        else if (msg.type === "error") instance.write(`\r\n\x1b[31m${msg.message}\x1b[0m\r\n`)
        else if (msg.type === "exit") instance.write(`\r\n\x1b[33m[process exited: ${msg.exitCode}]\x1b[0m\r\n`)
      } catch {}
    }
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    const dataSub = instance.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: d }))
    })

    const onWinResize = () => {
      try { fitAddon.fit() } catch {}
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: instance.cols, rows: instance.rows }))
      }
    }
    window.addEventListener("resize", onWinResize)

    // Also observe container size changes (panel open/collapse)
    const ro = new ResizeObserver(() => onWinResize())
    if (ref.current) ro.observe(ref.current)

    return () => {
      window.removeEventListener("resize", onWinResize)
      ro.disconnect()
      dataSub.dispose()
      try { ws.close() } catch {}
    }
  }, [instance, token, epoch, fitAddon, ref, setConnected])

  return (
    <div className="shrink-0 w-[480px] max-w-[60vw] h-full flex flex-col border-l border-foreground/8 bg-background overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-foreground/8 bg-foreground/2">
        <div className="flex items-center gap-2 text-[12px] min-w-0">
          <TerminalIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground">Claude Code</span>
          <span className="text-muted-foreground/60 truncate">~/.openclaw/skills</span>
          <span className={cn(
            "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]",
            connected ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"
          )}>
            <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-emerald-400" : "bg-amber-400 animate-pulse")} />
            {connected ? "live" : "…"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRestart}
            className="p-1 rounded hover:bg-foreground/6 text-muted-foreground hover:text-foreground"
            title="Restart session"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-foreground/6 text-muted-foreground hover:text-foreground"
            title="Collapse"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 bg-[#0b0b0f]">
        <div ref={ref} className="absolute inset-0 px-2 py-2 overflow-hidden" />
      </div>
    </div>
  )
}

export function SkillsTerminal() {
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  const [epoch, setEpoch] = useState(0)

  if (!open) {
    return (
      <div className="shrink-0 w-9 flex flex-col items-center border-l border-foreground/8 bg-foreground/1">
        <button
          onClick={() => setOpen(true)}
          className="w-full h-full flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground hover:bg-foreground/3 transition-colors"
          title="Open Skills Terminal"
        >
          <ChevronLeft className="w-4 h-4" />
          <TerminalIcon className="w-4 h-4" />
          <span className="text-[10px] font-medium tracking-wider [writing-mode:vertical-rl] rotate-180">
            TERMINAL
          </span>
        </button>
      </div>
    )
  }

  return (
    <TerminalBody
      key={epoch}
      epoch={epoch}
      onRestart={() => setEpoch(n => n + 1)}
      onClose={() => setOpen(false)}
      connected={connected}
      setConnected={setConnected}
    />
  )
}

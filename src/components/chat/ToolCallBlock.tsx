import { useState } from "react"
import { Wrench, ChevronDown, ChevronRight, CheckCircle2, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChatToolCall } from "@/stores/useChatStore"

interface Props {
  toolCalls: ChatToolCall[]
}

function ToolCallCard({ call }: { call: ChatToolCall }) {
  const [expanded, setExpanded] = useState(false)

  const inputStr = call.input
    ? typeof call.input === "string"
      ? call.input
      : JSON.stringify(call.input, null, 2)
    : null

  const resultStr = call.result
    ? typeof call.result === "string"
      ? call.result
      : JSON.stringify(call.result, null, 2)
    : null

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden transition-all duration-200",
      call.status === "running"
        ? "border-amber-500/25 bg-amber-500/3"
        : "border-border bg-card"
    )}>
      {/* Tool header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-foreground/4 transition-colors"
      >
        <div className={cn(
          "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
          call.status === "running" ? "bg-amber-500/20" : "bg-emerald-500/15"
        )}>
          {call.status === "running"
            ? <Loader2 className="w-3 h-3 text-amber-400 animate-spin" />
            : <CheckCircle2 className="w-3 h-3 text-emerald-400/70" />
          }
        </div>
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Wrench className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          <span className={cn(
            "text-xs font-mono font-medium truncate",
            call.status === "running" ? "text-amber-300/80" : "text-muted-foreground/70"
          )}>
            {call.toolName}
          </span>
          <span className={cn(
            "text-[10px] ml-auto px-1.5 py-0.5 rounded-full shrink-0",
            call.status === "running"
              ? "bg-amber-500/15 text-amber-400/70"
              : "bg-emerald-500/10 text-emerald-400/60"
          )}>
            {call.status === "running" ? "running" : "done"}
          </span>
        </div>
        {/* Shimmer while running */}
        {call.status === "running" && (
          <span className="flex gap-0.5 shrink-0">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-amber-400/50 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </span>
        )}
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        }
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-3 pb-3 space-y-2.5 mt-0.5">
          {/* Input */}
          {inputStr && (
            <div className="mt-2.5">
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1.5 font-semibold">Input</p>
              <div className={cn(
                "relative rounded-lg p-2.5 text-xs font-mono leading-relaxed overflow-x-auto",
                call.status === "running" ? "bg-amber-500/5" : "bg-foreground/4"
              )}>
                {call.status === "running"
                  ? (
                    <div className="relative">
                      <span className="opacity-40 whitespace-pre-wrap">{inputStr}</span>
                      <div className="absolute inset-0 shimmer-horizontal pointer-events-none rounded" />
                    </div>
                  )
                  : <span className="text-muted-foreground/60 whitespace-pre-wrap">{inputStr}</span>
                }
              </div>
            </div>
          )}
          {/* Result */}
          {resultStr && (
            <div>
              <p className="text-[10px] text-muted-foreground/40 uppercase tracking-wider mb-1.5 font-semibold">Result</p>
              <div className="rounded-lg bg-foreground/4 p-2.5 text-xs font-mono text-muted-foreground/60 leading-relaxed overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
                {resultStr}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallBlock({ toolCalls }: Props) {
  if (!toolCalls.length) return null
  return (
    <div className="flex flex-col gap-2">
      {toolCalls.map((tc) => (
        <ToolCallCard key={tc.id} call={tc} />
      ))}
    </div>
  )
}

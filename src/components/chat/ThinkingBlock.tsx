import { useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  text: string
  done?: boolean
  defaultExpanded?: boolean
}

export function ThinkingBlock({ text, done = false, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn(
      "rounded-xl border transition-all duration-300 overflow-hidden",
      done
        ? "border-border bg-card"
        : "border-violet-500/20 bg-violet-500/4 animate-thoughtpulse"
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-foreground/4 transition-colors"
      >
        <div className={cn(
          "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
          done ? "bg-violet-500/20" : "bg-violet-400/25"
        )}>
          <Brain className={cn("w-3 h-3", done ? "text-violet-400/70" : "text-violet-300")} />
        </div>
        <span className={cn(
          "text-xs font-medium flex-1",
          done ? "text-muted-foreground/60" : "text-violet-300/80"
        )}>
          {done ? "Thought process" : "Thinking…"}
        </span>
        {/* Live shimmer indicator when thinking */}
        {!done && (
          <span className="flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-violet-400/60 animate-bounce"
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

      {/* Content */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border">
          <div className={cn(
            "mt-2.5 text-xs leading-relaxed font-mono whitespace-pre-wrap",
            done ? "text-muted-foreground/50" : "text-violet-200/40"
          )}>
            {/* Shimmer overlay when still thinking */}
            {!done ? (
              <div className="relative">
                <span className="opacity-40">{text}</span>
                <div className="absolute inset-0 shimmer-horizontal pointer-events-none rounded" />
              </div>
            ) : (
              text
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import React from "react"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallBlock } from "./ToolCallBlock"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage"
import { cn } from "@/lib/utils"
import { Brain, Loader2, User } from "lucide-react"
import type { ChatMessageGroup } from "@/stores/useChatStore"

interface Props {
  group: ChatMessageGroup
  agentName?: string
  agentAvatarPresetId?: string | null
  agentEmoji?: string
  isLast?: boolean
}

function UserMessage({ text, images }: { text: string; images?: string[] }) {
  return (
    <div className="flex items-end justify-end gap-3">
      <div className="max-w-[85%] md:max-w-[68%] flex flex-col gap-1.5 items-end min-w-0">
        {/* Image previews above the text bubble */}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-end">
            {images.map((src, i) => (
              <UserImagePreview key={i} src={src} />
            ))}
          </div>
        )}
        {text && (
          <div className="bg-primary/12 border border-primary/20 rounded-2xl rounded-br-sm px-4 py-3 text-sm text-foreground/90 leading-relaxed break-words overflow-hidden">
            {text}
          </div>
        )}
      </div>
      {/* User avatar */}
      <div className="shrink-0 w-7 h-7 rounded-full bg-foreground/8 border border-foreground/10 flex items-center justify-center mb-0.5">
        <User className="w-3.5 h-3.5 text-muted-foreground/60" />
      </div>
    </div>
  )
}

function ZoomableImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [zoomed, setZoomed] = React.useState(false)
  const isApiMedia = src.includes("/api/media")
  return (
    <>
      {isApiMedia ? (
        <AuthenticatedImage src={src} alt={alt} className={cn(className, "cursor-zoom-in")} onClick={() => setZoomed(true)} />
      ) : (
        <img src={src} alt={alt} className={cn(className, "cursor-zoom-in")} onClick={() => setZoomed(true)} onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
      )}
      {zoomed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out p-4" onClick={() => setZoomed(false)}>
          {isApiMedia ? (
            <AuthenticatedImage src={src} alt={alt} className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" />
          ) : (
            <img src={src} alt={alt} className="max-w-full max-h-full rounded-2xl object-contain shadow-2xl" />
          )}
        </div>
      )}
    </>
  )
}

function AgentImageBlock({ src }: { src: string }) {
  return <ZoomableImage src={src} alt="agent image" className="max-h-48 max-w-[260px] rounded-xl border border-border object-cover" />
}

function UserImagePreview({ src }: { src: string }) {
  return <ZoomableImage src={src} alt="attachment" className="max-h-40 max-w-[220px] rounded-xl border border-primary/20 object-cover" />
}

function AgentMessage({
  group,
  agentName,
  agentAvatarPresetId,
  agentEmoji,
}: Props) {
  const phase = group.phase
  const hasThinking = !!group.thinkingText
  const hasTools = (group.toolCalls?.length ?? 0) > 0
  const hasResponse = !!group.responseText
  const isStreaming = group.isStreaming

  // Phase-driven indicators
  const showThinkingLive = phase === "thinking" && !hasThinking
  const showAnalyzing    = (phase === "analyzing" || phase === "tool_running") && !hasResponse
  const showWorkingOnIt  = !hasResponse && isStreaming && !phase // fallback for legacy messages
  const showCursor       = isStreaming && !group.responseDone && hasResponse

  return (
    <div className="flex items-start gap-3">
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        <AgentAvatar
          avatarPresetId={agentAvatarPresetId}
          emoji={agentEmoji ?? "🤖"}
          size="w-8 h-8"
        />
      </div>

      <div className="flex flex-col gap-2.5 flex-1 min-w-0">
        {/* Name */}
        <span className="text-xs font-semibold text-muted-foreground/50 -mb-1">{agentName ?? "Agent"}</span>

        {/* Phase: THINKING — live indicator before text arrives */}
        {showThinkingLive && (
          <PhasePill color="violet" icon={<Brain className="w-3 h-3 text-violet-300 animate-pulse" />} label="Thinking…" />
        )}

        {/* Thinking block — reasoning text */}
        {hasThinking && (
          <ThinkingBlock
            text={group.thinkingText!}
            done={group.thinkingDone}
            defaultExpanded={!group.thinkingDone}
          />
        )}

        {/* Tool calls */}
        {hasTools && (
          <ToolCallBlock toolCalls={group.toolCalls!} />
        )}

        {/* Phase: ANALYZING — all tools done, waiting for response */}
        {showAnalyzing && !hasResponse && (
          <PhasePill color="violet" icon={<Brain className="w-3 h-3 text-violet-300 animate-pulse" />} label="Analyzing results…" />
        )}

        {/* Phase: WORKING — fallback generic indicator */}
        {showWorkingOnIt && !hasTools && !hasThinking && (
          <PhasePill color="muted" icon={<Loader2 className="w-3 h-3 text-muted-foreground/50 animate-spin" />} label="Working on it…" />
        )}

        {/* Agent image blocks (from content blocks, e.g. media tool) */}
        {group.agentImages && group.agentImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {group.agentImages.map((src, i) => (
              <AgentImageBlock key={i} src={src} />
            ))}
          </div>
        )}

        {/* Response text */}
        {hasResponse ? (
          <div className={cn("bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3")}>
            <MarkdownRenderer content={group.responseText!} />
            {showCursor && (
              <span className="inline-block w-0.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        ) : isStreaming && !showAnalyzing && (hasThinking || hasTools) ? (
          <PhasePill color="muted" icon={<Loader2 className="w-3.5 h-3.5 text-muted-foreground/40 animate-spin" />} label="Preparing response…" />
        ) : null}
      </div>
    </div>
  )
}

function PhasePill({ color, icon, label }: { color: "violet" | "muted"; icon: React.ReactNode; label: string }) {
  const isViolet = color === "violet"
  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-2.5 rounded-2xl rounded-tl-sm border",
      isViolet ? "bg-violet-500/5 border-violet-500/15" : "bg-foreground/4 border-foreground/8"
    )}>
      <div className={cn(
        "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
        isViolet ? "bg-violet-400/20" : "bg-foreground/8"
      )}>
        {icon}
      </div>
      <span className={cn("text-xs flex-1", isViolet ? "text-violet-300/70" : "text-muted-foreground/40")}>
        {label}
      </span>
      <span className="flex gap-0.5 shrink-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("w-1 h-1 rounded-full animate-bounce", isViolet ? "bg-violet-400/60" : "bg-foreground/25")}
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

export function ChatMessage({ group, agentName, agentAvatarPresetId, agentEmoji, isLast }: Props) {
  if (group.role === "user") {
    return <UserMessage text={group.userText ?? ""} images={group.userImages} />
  }
  return (
    <AgentMessage
      group={group}
      agentName={agentName}
      agentAvatarPresetId={agentAvatarPresetId}
      agentEmoji={agentEmoji}
      isLast={isLast}
    />
  )
}

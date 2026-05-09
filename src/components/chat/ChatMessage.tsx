import React from "react"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { ThinkingBlock } from "./ThinkingBlock"
import { ToolCallBlock } from "./ToolCallBlock"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage"
import { FeedbackThumbs } from "@/components/feedback/FeedbackThumbs"
import { cn } from "@/lib/utils"
import { Brain, Loader2, User, PenLine } from "lucide-react"
import type { ChatMessageGroup } from "@/stores/useChatStore"
import { stripGatewayEnvelopes, stripUserMetadataEnvelope } from "@/stores/useChatStore"

interface Props {
  group: ChatMessageGroup
  agentName?: string
  agentAvatarPresetId?: string | null
  agentEmoji?: string
  isLast?: boolean
  /** Session key for the conversation; required to render feedback thumbs. */
  sessionId?: string
  /** Agent id this message belongs to; required to render feedback thumbs. */
  agentId?: string
}

function formatTime(ts?: number): string {
  if (!ts) return ""
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  } catch { return "" }
}

function UserMessage({ text, images, timestamp }: { text: string; images?: string[]; timestamp?: number }) {
  const cleaned = stripUserMetadataEnvelope(text)
  const time = formatTime(timestamp)
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
        {cleaned && (
          <div className="bg-primary/12 border border-primary/20 rounded-2xl rounded-br-sm px-4 py-3 text-sm text-foreground/90 leading-relaxed break-words overflow-hidden whitespace-pre-wrap">
            {cleaned}
          </div>
        )}
        {time && (
          <span className="text-[10px] text-muted-foreground/40 px-1">{time}</span>
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
  sessionId,
  agentId,
}: Props) {
  const phase = group.phase
  const hasThinking = !!group.thinkingText
  const hasTools = (group.toolCalls?.length ?? 0) > 0
  // Check against the stripped version so a response made entirely of gateway
  // directive markers (which strip to empty) doesn't render an empty bubble.
  const hasResponse = !!group.responseText && !!stripGatewayEnvelopes(group.responseText).trim()
  const isStreaming = group.isStreaming

  // Phase-driven indicators.
  const showThinkingLive = phase === "thinking" && !hasThinking
  const showAnalyzing    = (phase === "analyzing" || phase === "tool_running") && (!hasResponse || !group.responseDone)
  const showResponding   = (phase === "responding" || (hasResponse && !group.responseDone)) && isStreaming
  const showWorkingOnIt  = !hasResponse && isStreaming && !phase

  const hasRunningTool   = (group.toolCalls ?? []).some(tc => tc.status === "running")

  // "Composing final answer" indicator: shown ONLY when:
  //   1. phase='analyzing' — set exclusively by processing_end/chat:done (true end-of-run signals)
  //   2. No tools are currently RUNNING — double-guard against processing_end firing mid-sub-run
  //   3. Still streaming + no response text yet (the dead zone before JSONL text arrives)
  const showComposing    = phase === "analyzing" && !hasRunningTool && isStreaming && !hasResponse && !group.responseDone

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

        {/* Phase: THINKING */}
        {showThinkingLive && (
          <PhasePill color="violet" icon={<Brain className="w-3 h-3 text-violet-300 animate-pulse" />} label="Thinking…" />
        )}

        {hasThinking && (
          <ThinkingBlock
            text={group.thinkingText!}
            done={group.thinkingDone}
            defaultExpanded={!group.responseDone}
          />
        )}

        {hasTools && (
          <ToolCallBlock
            toolCalls={group.toolCalls!}
            defaultCollapsed={!!group.responseDone}
          />
        )}

        {/* Phase: ANALYZING (tool running / post-tool analysis) */}
        {showAnalyzing && !showResponding && !showComposing && (
          <PhasePill
            color="violet"
            icon={<Brain className="w-3 h-3 text-violet-300 animate-pulse" />}
            label={hasRunningTool ? "Running tool…" : "Analyzing results…"}
          />
        )}

        {/* Phase: COMPOSING FINAL ANSWER
             Shows after all tools complete while gateway buffers state=final.
             Replaces the silent dead zone with explicit visual feedback. */}
        {showComposing && (
          <PhasePill
            color="emerald"
            icon={<PenLine className="w-3 h-3 text-emerald-400 animate-pulse" />}
            label="Composing final answer…"
          />
        )}

        {/* Phase: RESPONDING (Buffered until done) */}
        {showResponding && !showAnalyzing && !showComposing && (
          <PhasePill color="muted" icon={<Loader2 className="w-3 h-3 text-muted-foreground/50 animate-spin" />} label="Composing response…" />
        )}

        {/* Phase: WORKING (no tools, no thinking, no phase) */}
        {showWorkingOnIt && !hasTools && !hasThinking && !showResponding && !showComposing && (
          <PhasePill color="muted" icon={<Loader2 className="w-3 h-3 text-muted-foreground/50 animate-spin" />} label="Working on it…" />
        )}

        {/* Agent image blocks */}
        {group.agentImages && group.agentImages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {group.agentImages.map((src, i) => (
              <AgentImageBlock key={i} src={src} />
            ))}
          </div>
        )}

        {/* Response text — Rendered ONLY when completely done to avoid live-streaming final text */}
        {hasResponse && group.responseDone ? (
          <div className={cn("bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3")}>
            <MarkdownRenderer content={stripGatewayEnvelopes(group.responseText!)} />
          </div>
        ) : null}
        
        {hasResponse && group.responseDone && group.timestamp && (
          <span className="text-[10px] text-muted-foreground/40 px-1 -mt-1">{formatTime(group.timestamp)}</span>
        )}

        {/* Feedback thumbs — only after the response is fully done, and only
            when the surface passed both sessionId and agentId. The messageId
            uses the group id (which mirrors the underlying JSONL message id
            once history is reloaded post-run). */}
        {hasResponse && group.responseDone && group.id && sessionId && agentId && (
          <FeedbackThumbs
            messageId={group.id}
            sessionId={sessionId}
            agentId={agentId}
            className="mt-1 opacity-60 hover:opacity-100 transition-opacity"
          />
        )}
      </div>
    </div>
  )
}

function PhasePill({ color, icon, label }: { color: "violet" | "muted" | "emerald"; icon: React.ReactNode; label: string }) {
  const isViolet  = color === "violet"
  const isEmerald = color === "emerald"
  return (
    <div className={cn(
      "flex items-center gap-3 px-4 py-2.5 rounded-2xl rounded-tl-sm border",
      isViolet  ? "bg-violet-500/5 border-violet-500/15"
               : isEmerald ? "bg-emerald-500/5 border-emerald-500/15"
               : "bg-foreground/4 border-foreground/8"
    )}>
      <div className={cn(
        "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
        isViolet  ? "bg-violet-400/20"
                 : isEmerald ? "bg-emerald-400/20"
                 : "bg-foreground/8"
      )}>
        {icon}
      </div>
      <span className={cn(
        "text-xs flex-1",
        isViolet  ? "text-violet-300/70"
                 : isEmerald ? "text-emerald-300/70"
                 : "text-muted-foreground/40"
      )}>
        {label}
      </span>
      <span className="flex gap-0.5 shrink-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              "w-1 h-1 rounded-full animate-bounce",
              isViolet  ? "bg-violet-400/60"
                       : isEmerald ? "bg-emerald-400/60"
                       : "bg-foreground/25"
            )}
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </div>
  )
}

export function ChatMessage({ group, agentName, agentAvatarPresetId, agentEmoji, isLast, sessionId, agentId }: Props) {
  if (group.role === "user") {
    return <UserMessage text={group.userText ?? ""} images={group.userImages} timestamp={group.timestamp} />
  }
  return (
    <AgentMessage
      group={group}
      agentName={agentName}
      agentAvatarPresetId={agentAvatarPresetId}
      agentEmoji={agentEmoji}
      isLast={isLast}
      sessionId={sessionId}
      agentId={agentId}
    />
  )
}

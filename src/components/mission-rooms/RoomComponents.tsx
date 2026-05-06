import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { FileText, Hash, Loader2, MessageSquarePlus, Send, Users, ClipboardList, FolderKanban, LayoutDashboard, Terminal } from "lucide-react"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAgentStore, useAuthStore, useProcessingStore, useRoomStore, useTaskStore, useLiveFeedStore } from "@/stores"
import type { Agent, Artifact, MissionMessage, MissionRoom, Task } from "@/types"
import { MarkdownRenderer } from "../chat/MarkdownRenderer"

const CATEGORY_STYLES: Record<string, string> = {
  briefs: "bg-blue-500/10 text-blue-500",
  outputs: "bg-emerald-500/10 text-emerald-500",
  research: "bg-violet-500/10 text-violet-500",
  decisions: "bg-amber-500/10 text-amber-500",
  assets: "bg-muted text-muted-foreground",
}

function roomGroupsFlat(rooms: { global: MissionRoom[]; project: MissionRoom[] }) {
  return [...rooms.global, ...rooms.project]
}

export function RoomSidebar({ onNewRoom, onSelectRoom }: { onNewRoom: () => void; onSelectRoom?: () => void }) {
  const { rooms, activeRoomId, unreadByRoom, setActiveRoom } = useRoomStore()

  const renderGroup = (label: string, list: MissionRoom[]) => {
    // Sort HQ rooms first within the group
    const sortedList = [...list].sort((a, b) => {
      if (a.isHq && !b.isHq) return -1
      if (!a.isHq && b.isHq) return 1
      return 0
    })
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between px-3">
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
          {label === "Rooms" && (
            <button onClick={onNewRoom} className="h-5 w-5 rounded hover:bg-muted inline-flex items-center justify-center">
              <span className="text-muted-foreground">+</span>
            </button>
          )}
        </div>
        <div className="space-y-1">
          {sortedList.map((room) => {
            const active = room.id === activeRoomId
            const unread = unreadByRoom[room.id] || 0
            return (
              <button
                key={room.id}
                onClick={() => { setActiveRoom(room.id); onSelectRoom?.() }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors group",
                  active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                <div className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-card border border-border group-hover:border-primary/30 transition-colors">
                  {label === "Projects" ? <FolderKanban className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm font-semibold truncate", active ? "text-primary" : "text-foreground")}>
                    {room.isHq ? '🏠 ' : ''}{room.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{room.description || "All agents & departments"}</p>
                </div>
                {unread > 0 && (
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
                    active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                  )}>
                    {unread}
                  </span>
                )}
                {/* delete button: hide when room.isSystem */}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col h-full border-r border-border bg-background">
      <div className="flex-1 overflow-y-auto p-3 space-y-6 pt-5">
        {renderGroup("Rooms", rooms.global)}
        {rooms.project.length > 0 && renderGroup("Projects", rooms.project)}
      </div>
    </aside>
  )
}

function RoomHeader({ room, agents, filter, setFilter }: { room: MissionRoom; agents: Agent[]; filter: string; setFilter: (f: string) => void }) {
  const tabs = ["All", "Commands", "Mentions", "System"]
  const navigate = useNavigate()
  const isProjectRoom = room.kind === "project" && !!room.projectId
  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-border bg-background/70 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-card border border-border flex items-center justify-center">
          <Hash className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-1">
            # {room.name} <span className="text-muted-foreground/50 ml-1 text-[10px]">▼</span>
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">{room.description || `${agents.length} members`}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isProjectRoom && (
          <button
            onClick={() => navigate(`/projects/${room.projectId}?tab=board`)}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
            title="Open project board"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            <span>Open Board</span>
          </button>
        )}
        <div className="hidden sm:flex bg-card border border-border rounded-lg p-0.5">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={cn(
                "px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors",
                filter === t ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <button className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:bg-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message, repliedMessage, agentsById, onReply }: { message: MissionMessage; repliedMessage?: MissionMessage | null; agentsById: Map<string, Agent>; onReply?: (msg: MissionMessage) => void }) {
  const navigate = useNavigate()
  const tasks = useTaskStore((s) => s.tasks)
  const [submitting, setSubmitting] = useState<null | "approve" | "request-change">(null)
  const [showRequestPrompt, setShowRequestPrompt] = useState(false)
  const [requestReason, setRequestReason] = useState("")
  const agent = message.authorId ? agentsById.get(message.authorId) : null
  const isSystem = message.authorType === "system"
  const isAgent = message.authorType === "agent"

  if (isSystem) {
    const taskId = message.relatedTaskId
    const taskMeta = message.meta as { projectId?: string; status?: string; taskId?: string } | undefined
    const liveTask = taskId ? tasks.find(t => t.id === taskId) : null
    // Show inline approve/request-change ONLY when the task is currently in_review.
    // The message might be from a past state; we check the live task status.
    const showReviewActions = !!(liveTask && liveTask.status === "in_review")

    const onApprove = async () => {
      if (!taskId || submitting) return
      setSubmitting("approve")
      try { await api.approveTask(taskId) }
      catch (e) { console.error(e); alert((e as Error).message || "Failed to approve") }
      finally { setSubmitting(null) }
    }
    const onSubmitRequestChange = async () => {
      if (!taskId || submitting || !requestReason.trim()) return
      setSubmitting("request-change")
      try {
        await api.requestTaskChange(taskId, requestReason.trim())
        setShowRequestPrompt(false)
        setRequestReason("")
      } catch (e) { console.error(e); alert((e as Error).message || "Failed to request change") }
      finally { setSubmitting(null) }
    }

    return (
      <div className="flex gap-2.5 items-start py-1.5 group">
        <div className="w-7 h-7 rounded-md bg-foreground/5 flex items-center justify-center border border-border/50 shadow-sm shrink-0 mt-0.5">
          <Terminal className="w-3.5 h-3.5 text-foreground/60" />
        </div>
        <div className="flex-1 min-w-0 border-b border-border/40 pb-2">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground text-sm">System</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-muted text-muted-foreground">SYSTEM</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-2">
              {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              <span className="w-1.5 h-1.5 rounded-full bg-primary/80"></span>
            </span>
          </div>
          <div className="text-sm text-foreground/80 leading-snug">
            <div className="prose prose-sm dark:prose-invert prose-p:leading-snug prose-pre:p-0 max-w-none text-foreground/80">
              <MarkdownRenderer content={message.body} />
            </div>
            {taskId && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const projectId = taskMeta?.projectId
                    const href = projectId
                      ? `/projects/${projectId}?tab=board&task=${encodeURIComponent(taskId)}`
                      : `/board?task=${encodeURIComponent(taskId)}`
                    navigate(href)
                  }}
                  className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs"
                >
                  <ClipboardList className="h-3 w-3" />Open task
                </button>
                {showReviewActions && (
                  <>
                    <button
                      onClick={onApprove}
                      disabled={!!submitting}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {submitting === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : "✓"} Approve
                    </button>
                    <button
                      onClick={() => setShowRequestPrompt((v) => !v)}
                      disabled={!!submitting}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      ↺ Request Change
                    </button>
                  </>
                )}
              </div>
            )}
            {showReviewActions && showRequestPrompt && (
              <div className="mt-2 flex items-start gap-2">
                <Textarea
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  placeholder="What needs to change? This becomes the agent's brief for the next turn."
                  className="text-xs min-h-[60px]"
                />
                <div className="flex flex-col gap-1 shrink-0">
                  <Button
                    onClick={onSubmitRequestChange}
                    disabled={!requestReason.trim() || !!submitting}
                    size="sm"
                    className="h-7 text-xs"
                  >
                    {submitting === "request-change" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setShowRequestPrompt(false); setRequestReason("") }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const roleText = isAgent ? "AGENT" : (message.body.startsWith("/") ? "COMMAND" : "USER")
  const roleClass = isAgent ? "bg-indigo-500/10 text-indigo-500" : (roleText === "COMMAND" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")

  // Prefer live agent name (renames/profile updates) over snapshot authorName,
  // and fall back to authorName only if the agent isn't in the local map.
  const authorLabel = isAgent
    ? (agent?.name || message.authorName || agent?.id || "Agent")
    : (message.authorName || "You")
  const initial = authorLabel ? authorLabel.charAt(0).toUpperCase() : "U"

  const isUser = !isAgent && !isSystem

  return (
    <div className={cn("flex gap-2 items-end py-2 group w-full", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      {isAgent ? (
        <AgentAvatar avatarPresetId={agent?.avatarPresetId} emoji={agent?.emoji ?? "🤖"} size="w-7 h-7 shrink-0 mb-1" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20 shrink-0 mb-1">
          <span className="text-primary text-[10px] font-bold">{initial}</span>
        </div>
      )}

      {/* Message Content */}
      <div className={cn("flex flex-col gap-1 max-w-[80%]", isUser ? "items-end" : "items-start")}>
        
        {/* Header: Name, Role, Time */}
        <div className={cn("flex items-baseline gap-1.5 px-1", isUser && "flex-row-reverse")}>
          <span className="font-semibold text-foreground/80 text-[11px]">{authorLabel}</span>
          <span className={cn("px-1 py-0.5 rounded text-[8px] font-bold tracking-wider", roleClass)}>
            {roleText}
          </span>
          <span className="text-[9px] text-muted-foreground font-medium">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {/* Read Receipt indicator for users */}
          {isUser && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 ml-0.5"><polyline points="20 6 9 17 4 12"/></svg>
          )}
        </div>

        {/* Bubble */}
        <div className={cn(
          "relative flex flex-col gap-1.5 px-3.5 py-2.5 rounded-2xl shadow-sm",
          isUser 
            ? "bg-primary/15 text-foreground rounded-br-sm border border-primary/10" 
            : "bg-muted text-foreground rounded-bl-sm border border-border/40"
        )}>
          {/* Reply Context */}
          {message.meta?.replyTo && repliedMessage && (
            <div className={cn("flex items-center gap-1.5 text-[10px] text-muted-foreground bg-background/50 px-2 py-1.5 rounded-lg border border-border/30 w-fit max-w-full")}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60 shrink-0"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="font-semibold text-foreground/80 truncate">
                  Replying to {repliedMessage.authorType === 'agent'
                    ? (agentsById.get(repliedMessage.authorId)?.name || repliedMessage.authorName || repliedMessage.authorId)
                    : (repliedMessage.authorName || 'You')}
                </span>
                <span className="truncate max-w-[200px] text-muted-foreground opacity-80">{repliedMessage.body}</span>
              </div>
            </div>
          )}

          {/* Markdown Content */}
          <div className="prose prose-sm dark:prose-invert prose-p:leading-snug prose-pre:p-0 max-w-none text-foreground/90 text-[13px] break-words">
            <MarkdownRenderer content={message.body} />
          </div>
        </div>
      </div>

      {/* Reply Action */}
      <div className={cn("opacity-0 group-hover:opacity-100 transition-opacity flex items-center shrink-0 mb-3", isUser && "flex-row-reverse")}>
        <button 
          onClick={() => onReply?.(message)}
          className="p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground rounded-full transition-colors"
          title="Reply"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
        </button>
      </div>
    </div>
  )
}

const COMMANDS = [
  { id: "status", name: "/status", description: "View team roles and availability" },
  { id: "connections", name: "/connections", description: "List each agent's assigned connections" },
  { id: "summary", name: "/summary", description: "Summarize the room's chat history" },
  { id: "delegate", name: "/delegate", description: "Let Master Agent assign a task" },
  { id: "reset", name: "/reset", description: "Clear agent session contexts" },
  { id: "stop", name: "/stop", description: "Abort active agent executions" }
]

const renderHighlightedText = (text: string) => {
  if (!text) return null
  const regex = /(@[a-zA-Z0-9_-]+|\/[a-zA-Z0-9_-]+)/g
  const parts = text.split(regex)
  return parts.map((part, i) => {
    if (part.startsWith('@')) return <span key={i} className="text-indigo-500 bg-indigo-500/20 rounded-sm">{part}</span>
    if (part.startsWith('/')) return <span key={i} className="text-orange-500 bg-orange-500/20 rounded-sm">{part}</span>
    return <span key={i}>{part}</span>
  })
}

function MentionComposer({ room, agents, replyingToMessage, setReplyingToMessage }: { room: MissionRoom; agents: Agent[]; replyingToMessage: MissionMessage | null; setReplyingToMessage: (msg: MissionMessage | null) => void }) {
  const [text, setText] = useState(() => localStorage.getItem(`aoc.room.draft.${room.id}`) || "")
  const [sending, setSending] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<{ query: string; index: number } | null>(null)
  const [commandQuery, setCommandQuery] = useState<{ query: string; index: number } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setText(localStorage.getItem(`aoc.room.draft.${room.id}`) || "") }, [room.id])
  useEffect(() => { localStorage.setItem(`aoc.room.draft.${room.id}`, text) }, [room.id, text])

  const canSend = text.trim() && !sending

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      // Word-boundary mention parser — prevents @Ar matching when user typed @Ars.
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const mentions = agents
        .filter((a) => {
          const labels = [a.name, a.id].filter(Boolean) as string[]
          return labels.some((label) => new RegExp(`(^|[^\\w@])@${escapeRegex(label)}(?![\\w])`, "i").test(text))
        })
        .map((a) => a.id)
      
      if (replyingToMessage?.authorType === "agent" && replyingToMessage.authorId) {
        if (!mentions.includes(replyingToMessage.authorId)) {
          mentions.push(replyingToMessage.authorId)
        }
      }

      const meta = replyingToMessage ? { replyTo: replyingToMessage.id } : undefined
      const res = await api.postRoomMessage(room.id, text.trim(), mentions, meta)
      useRoomStore.getState().appendMessage(room.id, res.message)

      // Optimistically set processing flag for each mentioned agent so
      // TypingIndicator + RightRail show "Thinking..." immediately while
      // the gateway processes the request. Cleared when room:message
      // arrives from that agent via WebSocket.
      const procStore = useProcessingStore.getState()
      for (const agentId of mentions) {
        const procKey = `agent:${agentId}:room:${room.id}`
        procStore.start(procKey, agentId)
      }

      setText("")
      setReplyingToMessage(null)
      localStorage.removeItem(`aoc.room.draft.${room.id}`)
      setMentionQuery(null)
      setCommandQuery(null)
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    } finally {
      setSending(false)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setText(val)
    
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`
    }

    const cursor = e.target.selectionStart
    const textBeforeCursor = val.slice(0, cursor)
    
    const commandMatch = textBeforeCursor.match(/(?:^|\n)(\/[a-zA-Z0-9_-]*)$/)
    const mentionMatch = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/)
    
    if (commandMatch) {
      setCommandQuery({ query: commandMatch[1].slice(1), index: cursor - commandMatch[1].length })
      setSelectedIndex(0)
      setMentionQuery(null)
    } else if (mentionMatch) {
      setMentionQuery({ query: mentionMatch[1], index: cursor - mentionMatch[0].length })
      setSelectedIndex(0)
      setCommandQuery(null)
    } else {
      setMentionQuery(null)
      setCommandQuery(null)
    }
  }

  const filteredAgents = mentionQuery 
    ? agents.filter(a => a.name.toLowerCase().includes(mentionQuery.query.toLowerCase()) || a.id.toLowerCase().includes(mentionQuery.query.toLowerCase()))
    : []

  const filteredCommands = commandQuery
    ? COMMANDS.filter(c => c.name.toLowerCase().includes(`/${commandQuery.query.toLowerCase()}`))
    : []

  const handleSelectMention = (agentName: string) => {
    if (!mentionQuery) return
    const before = text.slice(0, mentionQuery.index)
    const after = text.slice(textareaRef.current?.selectionStart || text.length)
    setText(`${before}@${agentName} ${after}`)
    setMentionQuery(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleSelectCommand = (cmdName: string) => {
    if (!commandQuery) return
    const before = text.slice(0, commandQuery.index)
    const after = text.slice(textareaRef.current?.selectionStart || text.length)
    setText(`${before}${cmdName} ${after}`)
    setCommandQuery(null)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery && filteredAgents.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredAgents.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredAgents.length) % filteredAgents.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        handleSelectMention(filteredAgents[selectedIndex].name)
        return
      }
      if (e.key === "Escape") {
        setMentionQuery(null)
        return
      }
    }

    if (commandQuery && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex(prev => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        handleSelectCommand(filteredCommands[selectedIndex].name)
        return
      }
      if (e.key === "Escape") {
        setCommandQuery(null)
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="relative px-4 pb-6 pt-3 bg-background">
      {mentionQuery && filteredAgents.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 max-h-48 overflow-y-auto rounded-xl border border-border bg-card shadow-lg z-50">
          <div className="p-1">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Mention Agent
            </div>
            {filteredAgents.map((a, i) => (
              <button
                key={a.id}
                onClick={() => handleSelectMention(a.name)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left",
                  i === selectedIndex ? "bg-primary/15 text-primary" : "hover:bg-primary/10 text-foreground"
                )}
              >
                <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.emoji ?? "🤖"} size="w-5 h-5" />
                <span className="text-xs font-medium">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {commandQuery && filteredCommands.length > 0 && (
        <div className="absolute bottom-full left-4 mb-2 w-64 max-h-48 overflow-y-auto rounded-xl border border-border bg-card shadow-lg z-50">
          <div className="p-1">
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
              Commands
            </div>
            {filteredCommands.map((c, i) => (
              <button
                key={c.id}
                onClick={() => handleSelectCommand(c.name)}
                className={cn(
                  "w-full flex flex-col gap-0.5 px-2 py-1.5 rounded-lg transition-colors text-left",
                  i === selectedIndex ? "bg-primary/15" : "hover:bg-primary/10"
                )}
              >
                <span className={cn("text-xs font-bold", i === selectedIndex ? "text-primary" : "text-foreground")}>{c.name}</span>
                <span className="text-[10px] text-muted-foreground truncate w-full">{c.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cn(
        "rounded-2xl border transition-all duration-200 shadow-sm overflow-hidden",
        "bg-card border-border hover:shadow-md focus-within:shadow-md focus-within:border-primary/30"
      )}>
        {replyingToMessage && (
          <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border/40">
            <div className="flex items-center gap-2 overflow-hidden">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
              <span className="text-[11px] font-semibold text-foreground/80 shrink-0">Replying to {replyingToMessage.authorName || 'user'}</span>
              <span className="text-[11px] text-muted-foreground truncate">{replyingToMessage.body}</span>
            </div>
            <button onClick={() => setReplyingToMessage(null)} className="p-1 text-muted-foreground hover:bg-muted hover:text-foreground rounded-md transition-colors shrink-0">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        )}
        <div className="relative px-3 pt-2.5 pb-1.5">
          <div className="absolute top-2.5 left-3 right-3 bottom-1.5 pointer-events-none">
            <div className="w-full text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed font-sans">
              {renderHighlightedText(text)}
              {text.endsWith('\n') ? <br /> : null}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${room.name}…`}
            rows={1}
            spellCheck={false}
            className="room-composer-textarea w-full bg-transparent text-sm text-foreground placeholder-muted-foreground/40 resize-none outline-none leading-relaxed max-h-48 min-h-[24px] relative z-10 font-sans"
            style={{ WebkitTextFillColor: 'transparent' }}
          />
        </div>
        
        {/* Chips Row */}
        <div className="px-3 py-1.5 flex flex-col gap-1 border-t border-border/40">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] uppercase font-bold text-muted-foreground/60 flex items-center w-24 shrink-0">Commands</span>
            {COMMANDS.map(c => (
              <button 
                key={c.id} 
                onClick={() => { setText((t) => `${t}${c.name} `); setTimeout(() => textareaRef.current?.focus(), 0) }}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-muted/30 hover:bg-muted/60 text-foreground/80 rounded-md border border-border/50 transition-colors shrink-0"
              >
                <span className="text-[10px] font-medium">{c.name}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[10px] uppercase font-bold text-muted-foreground/60 flex items-center w-24 shrink-0">Agents</span>
            {agents.map(a => (
              <button 
                key={a.id} 
                onClick={() => { setText((t) => `${t}@${a.name} `); setTimeout(() => textareaRef.current?.focus(), 0) }}
                className="flex items-center gap-1.5 px-1.5 py-0.5 bg-muted/30 hover:bg-muted/60 text-foreground/80 rounded-full border border-border/50 transition-colors shrink-0"
              >
                <AgentAvatar avatarPresetId={a.avatarPresetId} emoji={a.emoji ?? "🤖"} size="w-3 h-3" />
                <span className="text-[10px] font-medium">@{a.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-2 py-1.5 bg-muted/10 border-t border-border/40">
          <div className="flex items-center gap-1">
            <button className="p-1.5 text-muted-foreground hover:bg-muted rounded-md transition-colors"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button>
            <button className="p-1.5 text-muted-foreground hover:bg-muted rounded-md transition-colors"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold bg-primary/10 text-primary">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-primary" />
              Room Mode
            </div>
            <button
              onClick={send}
              disabled={!canSend}
              className={cn(
                "flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200",
                canSend
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                  : "bg-foreground/10 text-muted-foreground/30 cursor-not-allowed"
              )}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-0.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RightRail({ room, messages }: { room: MissionRoom; messages: MissionMessage[] }) {
  const agents = useAgentStore((s) => s.agents)
  const isAgentProcessingInScope = useProcessingStore((s) => s.isAgentProcessingInScope)
  const tasks = useTaskStore((s) => s.tasks)
  const liveFeedEntries = useLiveFeedStore((s) => s.entries)
  const members = room.memberAgentIds
    .map((id) => agents.find((a) => a.id === id) || (id === "main" ? { id, name: "Main", emoji: "🧭" } as Agent : null))
    .filter(Boolean) as Agent[]

  const roomTasks = tasks.filter((t) => t.status === "in_progress" && (!room.projectId || t.projectId === room.projectId))
  const recentUserMessages = messages.filter(m => m.authorType === "user").slice(-4).reverse()

  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [artifactsLoading, setArtifactsLoading] = useState(true)
  const loadArtifacts = useCallback(() => {
    setArtifactsLoading(true)
    api.listArtifacts(room.id).then((res) => setArtifacts(res.artifacts)).catch(() => setArtifacts([])).finally(() => setArtifactsLoading(false))
  }, [room.id])
  useEffect(() => { loadArtifacts() }, [loadArtifacts])

  const [showAgents, setShowAgents] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [showLiveActivity, setShowLiveActivity] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const [showArtifacts, setShowArtifacts] = useState(false)
  const [showContext, setShowContext] = useState(false)

  const [contextContent, setContextContent] = useState<string | null>(null)
  const [contextLoading, setContextLoading] = useState(true)
  const loadContext = useCallback(() => {
    setContextLoading(true)
    api.getRoomContext(room.id).then((res) => setContextContent(res.content)).catch(() => setContextContent(null)).finally(() => setContextLoading(false))
  }, [room.id])
  useEffect(() => { loadContext() }, [loadContext])

  return (
    <>
    <aside className="hidden xl:flex w-72 shrink-0 flex-col border-l border-border bg-background/50 p-5 gap-6 overflow-y-auto">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Active Agents
          </h3>
          <button onClick={() => setShowAgents(true)} className="text-[10px] text-primary hover:underline cursor-pointer">View all</button>
        </div>
        <div className="space-y-3">
          {members.map((agent) => {
            const processing = isAgentProcessingInScope(agent.id, { roomId: room.id })
            const activeTask = roomTasks.find(t => t.agentId === agent.id)
            let statusText = "Idle"
            let statusColor = "text-muted-foreground"
            if (processing) { statusText = "Thinking..."; statusColor = "text-emerald-500" }
            else if (activeTask) { statusText = activeTask.title; statusColor = "text-amber-500" }
            return (
              <div key={agent.id} className="flex items-center gap-3">
                <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji} size="w-8 h-8 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="truncate text-xs font-bold text-foreground">{agent.name} <span className="text-[10px] font-normal text-muted-foreground ml-1">({agent.role || "Agent"})</span></span>
                  </div>
                  <p className={cn("text-[10px] font-medium truncate mt-0.5", statusColor)}>{statusText}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {!room.projectId ? "Live Agent Activity" : "Running Tasks"}
          </h3>
          <button onClick={() => !room.projectId ? setShowLiveActivity(true) : setShowTasks(true)} className="text-[10px] text-primary hover:underline cursor-pointer">View all</button>
        </div>
        <div className="space-y-4">
          {!room.projectId ? (
            // HQ Room: Show active agents
            members.filter(a => isAgentProcessingInScope(a.id, { roomId: room.id })).length > 0 ? (
              members.filter(a => isAgentProcessingInScope(a.id, { roomId: room.id })).map((agent) => {
                const liveEntry = liveFeedEntries.find(e => e.agentId === agent.id);
                let statusLabel = "Thinking...";
                if (liveEntry) {
                  if (liveEntry.type === 'tool_call') statusLabel = "Running tool...";
                  else if (liveEntry.type === 'tool_result') statusLabel = "Processing result...";
                  else if (liveEntry.type === 'message') statusLabel = "Writing response...";
                  else if (liveEntry.type === 'system') statusLabel = "System task...";
                }

                return (
                  <div key={agent.id} className="text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-foreground line-clamp-1">{agent.name}</span>
                          <span className="text-[10px] font-medium text-emerald-500 truncate">{statusLabel}</span>
                        </div>
                        <div className="mt-1.5 bg-muted/40 border border-border/50 rounded flex items-start gap-1.5 p-1.5">
                          <Terminal className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-[9px] font-mono text-muted-foreground line-clamp-2 break-all leading-relaxed">
                            {liveEntry?.content || "Waiting for output..."}
                          </p>
                        </div>
                      </div>
                      <span className="flex h-2 w-2 relative mt-1 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-[11px] text-muted-foreground">No active tasks.</p>
            )
          ) : (
            // Regular Project Room: Show DB tasks
            <>
              {roomTasks.slice(0, 4).map((task) => (
                <div key={task.id} className="text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground line-clamp-1">{task.title}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{task.agentName || task.agentId || "Unassigned"}</p>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-primary/10 text-primary whitespace-nowrap">In Progress</span>
                  </div>
                </div>
              ))}
              {roomTasks.length === 0 && <p className="text-[11px] text-muted-foreground">No active tasks.</p>}
            </>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            Recent Commands
          </h3>
          <button onClick={() => setShowCommands(true)} className="text-[10px] text-primary hover:underline cursor-pointer">View all</button>
        </div>
        <div className="space-y-3">
          {recentUserMessages.map((msg) => (
            <div key={msg.id} className="flex gap-2 text-[11px]">
              <span className="text-primary font-medium shrink-0">{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-muted-foreground line-clamp-2 leading-relaxed">{msg.body}</span>
            </div>
          ))}
          {recentUserMessages.length === 0 && <p className="text-[11px] text-muted-foreground">No recent commands.</p>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            Artifacts
          </h3>
          <button onClick={() => setShowArtifacts(true)} className="text-[10px] text-primary hover:underline cursor-pointer">View all</button>
        </div>
        <div className="space-y-3">
          {artifactsLoading && <p className="text-[11px] text-muted-foreground">Loading...</p>}
          {!artifactsLoading && artifacts.filter(a => !a.archived).slice(0, 3).map((artifact) => (
            <div key={artifact.id} className="text-xs">
              <p className="font-semibold text-foreground line-clamp-1">{artifact.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider", CATEGORY_STYLES[artifact.category] || "bg-muted text-muted-foreground")}>{artifact.category}</span>
                {artifact.pinned && <span className="text-[10px] text-amber-500">📌</span>}
              </div>
            </div>
          ))}
          {!artifactsLoading && artifacts.filter(a => !a.archived).length === 0 && <p className="text-[11px] text-muted-foreground">No artifacts yet.</p>}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
            Context
          </h3>
          <button onClick={() => setShowContext(true)} className="text-[10px] text-primary hover:underline cursor-pointer">View all</button>
        </div>
        <div className="space-y-2">
          {contextLoading && <p className="text-[11px] text-muted-foreground">Loading...</p>}
          {!contextLoading && contextContent && contextContent.trim() !== "" && (
            <p className="text-[11px] text-foreground/80 line-clamp-4 leading-relaxed font-mono">{contextContent}</p>
          )}
          {!contextLoading && (!contextContent || contextContent.trim() === "") && <p className="text-[11px] text-muted-foreground">No context yet.</p>}
        </div>
      </section>
    </aside>

    <Dialog open={showAgents} onOpenChange={setShowAgents}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Room Members</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {members.map((agent) => {
            const processing = isAgentProcessingInScope(agent.id, { roomId: room.id })
            const activeTask = roomTasks.find(t => t.agentId === agent.id)
            let statusText = "Idle"
            let statusColor = "text-muted-foreground"
            if (processing) { statusText = "Thinking..."; statusColor = "text-emerald-500" }
            else if (activeTask) { statusText = activeTask.title; statusColor = "text-amber-500" }
            return (
              <div key={agent.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji} size="w-10 h-10 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground">{agent.role || "Agent"}</p>
                </div>
                <p className={cn("text-[10px] font-medium", statusColor)}>{statusText}</p>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showTasks} onOpenChange={setShowTasks}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>All Running Tasks</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {roomTasks.map((task) => (
            <div key={task.id} className="p-3 rounded-lg border border-border bg-card">
              <p className="text-sm font-semibold text-foreground">{task.title}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary">In Progress</span>
                <span className="text-[11px] text-muted-foreground">{task.agentName || task.agentId}</span>
              </div>
              {task.description && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{task.description}</p>}
            </div>
          ))}
          {roomTasks.length === 0 && <p className="text-sm text-muted-foreground">No active tasks.</p>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showLiveActivity} onOpenChange={setShowLiveActivity}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Live Agent Activity</DialogTitle></DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {members.filter(a => isAgentProcessingInScope(a.id, { roomId: room.id })).length > 0 ? (
            members.filter(a => isAgentProcessingInScope(a.id, { roomId: room.id })).map((agent) => {
              const liveEntry = liveFeedEntries.find(e => e.agentId === agent.id);
              let statusLabel = "Thinking...";
              if (liveEntry) {
                if (liveEntry.type === 'tool_call') statusLabel = "Running tool...";
                else if (liveEntry.type === 'tool_result') statusLabel = "Processing result...";
                else if (liveEntry.type === 'message') statusLabel = "Writing response...";
                else if (liveEntry.type === 'system') statusLabel = "System task...";
              }

              // Get ALL recent entries for this agent
              const agentEntries = liveFeedEntries.filter(e => e.agentId === agent.id).slice(0, 10);

              return (
                <div key={agent.id} className="border border-border/50 rounded-lg p-3 space-y-3 bg-card shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji ?? "🤖"} size="w-8 h-8 shrink-0" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground text-sm">{agent.name}</span>
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                        </div>
                        <span className="text-xs font-medium text-emerald-500">{statusLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-muted/40 border border-border/50 rounded-md p-2.5 space-y-2">
                    {agentEntries.length > 0 ? agentEntries.map(entry => (
                      <div key={entry.id} className="flex items-start gap-2 text-[10px]">
                        <Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <p className="font-mono text-muted-foreground break-all leading-relaxed whitespace-pre-wrap">
                          {entry.content}
                        </p>
                      </div>
                    )) : (
                       <p className="text-xs text-muted-foreground italic">Waiting for output...</p>
                    )}
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No agents are currently active.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showCommands} onOpenChange={setShowCommands}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Command History</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {messages.filter(m => m.authorType === "user").slice().reverse().map((msg) => (
            <div key={msg.id} className="flex gap-3 p-2 rounded-lg hover:bg-muted/50">
              <span className="text-[10px] text-primary font-medium shrink-0 w-12 pt-0.5">{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-sm text-foreground">{msg.body}</span>
            </div>
          ))}
          {messages.filter(m => m.authorType === "user").length === 0 && <p className="text-sm text-muted-foreground">No commands yet.</p>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showArtifacts} onOpenChange={setShowArtifacts}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>All Artifacts</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {artifactsLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!artifactsLoading && artifacts.filter(a => !a.archived).map((artifact) => (
            <div key={artifact.id} className="p-3 rounded-lg border border-border bg-card">
              <p className="text-sm font-semibold text-foreground">{artifact.title}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", CATEGORY_STYLES[artifact.category] || "bg-muted text-muted-foreground")}>{artifact.category}</span>
                {artifact.pinned && <span className="text-[10px] text-amber-500">📌 Pinned</span>}
              </div>
              {artifact.description && <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{artifact.description}</p>}
            </div>
          ))}
          {!artifactsLoading && artifacts.filter(a => !a.archived).length === 0 && <p className="text-sm text-muted-foreground">No artifacts yet.</p>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={showContext} onOpenChange={setShowContext}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Room Context</DialogTitle></DialogHeader>
        <div className="max-h-80 overflow-y-auto">
          {contextLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
          {!contextLoading && contextContent && contextContent.trim() !== "" && (
            <pre className="whitespace-pre-wrap text-sm font-mono text-foreground/90 leading-relaxed">{contextContent}</pre>
          )}
          {!contextLoading && (!contextContent || contextContent.trim() === "") && (
            <p className="text-sm text-muted-foreground text-center py-8">Context is empty. Agents can append notes using <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">room-context-append</code>.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

export function NewRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const agents = useAgentStore((s) => s.agents)
  const currentUser = useAuthStore((s) => s.user)
  // Pickable agents: main + admin sees all + non-admin sees only their own.
  const pickableAgents = useMemo(() => agents.filter((a) => {
    if (a.id === "main") return true
    if (currentUser?.role === "admin") return true
    return a.provisionedBy != null && a.provisionedBy === currentUser?.id
  }), [agents, currentUser])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selected, setSelected] = useState<string[]>(["main"])
  const create = async () => {
    if (!name.trim()) return
    const res = await api.createRoom({ kind: "global", name: name.trim(), description, memberAgentIds: selected })
    useRoomStore.getState().upsertRoom(res.room)
    useRoomStore.getState().setActiveRoom(res.room.id)
    setName("")
    setDescription("")
    setSelected(["main"])
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Mission Room</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name" />
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-border p-2">
            {pickableAgents.map((agent) => {
              const checked = selected.includes(agent.id)
              const disabled = agent.id === "main"
              return (
                <label key={agent.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => setSelected((v) => e.target.checked ? [...v, agent.id] : v.filter((id) => id !== agent.id))} />
                  <AgentAvatar avatarPresetId={agent.avatarPresetId} emoji={agent.emoji} size="w-6 h-6" />
                  {agent.name}{disabled && <span className="text-xs text-muted-foreground">orchestrator</span>}
                </label>
              )
            })}
          </div>
        </div>
        <DialogFooter><Button onClick={create} disabled={!name.trim()}>Create Room</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TypingIndicator({ agents, roomId }: { agents: Agent[]; roomId: string }) {
  // Only show "is typing" if the agent is processing a session bound to THIS
  // room (key shape: `agent:<id>:room:<roomId>...`). Processing in DM or in
  // a different room does NOT light this up.
  const isAgentProcessingInScope = useProcessingStore((s) => s.isAgentProcessingInScope)
  const typingAgents = agents.filter((a) => isAgentProcessingInScope(a.id, { roomId }))

  if (typingAgents.length === 0) return null

  const names = typingAgents.map((a) => a.name).join(", ")

  return (
    <div className="flex items-center gap-3 py-2 px-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex -space-x-2">
        {typingAgents.slice(0, 3).map((agent) => (
          <AgentAvatar key={agent.id} avatarPresetId={agent.avatarPresetId} emoji={agent.emoji ?? "🤖"} size="w-6 h-6 shrink-0 ring-2 ring-background" />
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">{names}</span>
        <span>is typing</span>
        <span className="flex gap-0.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms" }} />
        </span>
      </div>
    </div>
  )
}

export function RoomMain({ roomId }: { roomId: string | null }) {
  const { rooms, messagesByRoom, setMessages } = useRoomStore()
  const agents = useAgentStore((s) => s.agents)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState("All")
  const [replyingToMessage, setReplyingToMessage] = useState<MissionMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const room = roomGroupsFlat(rooms).find((r) => r.id === roomId) || null

  const currentUser = useAuthStore((s) => s.user)
  const roomAgents = useMemo(() => room ? room.memberAgentIds
    .map((id) => agents.find((a) => a.id === id) || (id === "main" ? { id, name: "Main", emoji: "🧭" } as Agent : null))
    .filter(Boolean) as Agent[]
  : [], [room, agents])
  const agentsById = useMemo(() => new Map(roomAgents.map((a) => [a.id, a])), [roomAgents])
  // Mention picker only shows agents the user can mention: main + admin (any) + own.
  // Server enforces the same rule on POST; this filter just keeps the UX honest.
  const mentionableAgents = useMemo(() => roomAgents.filter((a) => {
    if (a.id === "main") return true
    if (currentUser?.role === "admin") return true
    return a.provisionedBy != null && a.provisionedBy === currentUser?.id
  }), [roomAgents, currentUser])
  const messages = roomId ? messagesByRoom[roomId] || [] : []

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    setReplyingToMessage(null)
    api.getRoomMessages(roomId, { limit: 50 })
      .then((res) => setMessages(roomId, res.messages))
      .finally(() => setLoading(false))
  }, [roomId, setMessages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }) }, [messages.length])

  if (!room) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Select a room to start coordinating.</div>
  }

  const filteredMessages = messages.filter(m => {
    if (filter === "System") return m.authorType === "system"
    if (filter === "Commands") return m.authorType === "user" && m.body.startsWith("/")
    if (filter === "Mentions") return m.mentions && m.mentions.length > 0
    return true
  })

  return (
    <div className="flex flex-1 min-w-0 h-full overflow-hidden">
      <div className="flex flex-1 min-w-0 flex-col">
        <RoomHeader room={room} agents={roomAgents} filter={filter} setFilter={setFilter} />
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2">
          {loading ? (
            <div className="flex justify-center py-16 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            filteredMessages.map((message) => {
              const repliedMessage = message.meta?.replyTo ? messages.find(m => m.id === message.meta!.replyTo) : null;
              return (
                <MessageBubble 
                  key={message.id} 
                  message={message} 
                  repliedMessage={repliedMessage}
                  agentsById={agentsById} 
                  onReply={(msg) => {
                    setReplyingToMessage(msg);
                    // Optionally wait for state then focus composer
                    setTimeout(() => document.querySelector<HTMLTextAreaElement>('.room-composer-textarea')?.focus(), 50);
                  }}
                />
              )
            })
          )}
          <TypingIndicator agents={roomAgents} roomId={room.id} />
          <div ref={bottomRef} />
        </div>
        <MentionComposer
          room={room}
          agents={mentionableAgents}
          replyingToMessage={replyingToMessage}
          setReplyingToMessage={setReplyingToMessage}
        />
      </div>
      <RightRail room={room} messages={messages} />
    </div>
  )
}

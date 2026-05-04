import React, { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores"
import type { Agent, Task, TaskComment } from "@/types"
import { MessageSquare, Bot, User, Pencil, Trash2, Loader2, X, Check } from "lucide-react"
import { AgentAvatar } from "@/components/agents/AgentAvatar"
import { cn } from "@/lib/utils"

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" })
}

interface Props {
  task: Task
  agents?: Agent[]
}

export function CommentsThread({ task, agents }: Props) {
  const currentUser = useAuthStore(s => s.user)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const feedRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getTaskComments(task.id)
      setComments(res.comments)
    } catch (e) {
      setError((e as Error).message || "Failed to load comments")
    } finally { setLoading(false) }
  }, [task.id])

  useEffect(() => { load() }, [load])

  // Live updates via WS
  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<{ type: string; taskId?: string; comment?: TaskComment }>).detail
      if (!detail || detail.taskId !== task.id || !detail.comment) return
      setComments(prev => {
        if (detail.type === "task:comment_added") {
          if (prev.some(c => c.id === detail.comment!.id)) return prev
          return [...prev, detail.comment!]
        }
        if (detail.type === "task:comment_edited") {
          return prev.map(c => c.id === detail.comment!.id ? detail.comment! : c)
        }
        if (detail.type === "task:comment_deleted") {
          // Server soft-deletes; hide here to match initial list (which filters out deletedAt)
          return prev.filter(c => c.id !== detail.comment!.id)
        }
        return prev
      })
    }
    window.addEventListener('aoc:task-comment', onEvent)
    return () => window.removeEventListener('aoc:task-comment', onEvent)
  }, [task.id])

  // Auto-scroll to bottom on new comment
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [comments.length])

  async function handleEdit(c: TaskComment) {
    if (!editDraft.trim() || editDraft.trim() === c.body) { setEditingId(null); return }
    try {
      await api.updateTaskComment(task.id, c.id, editDraft.trim())
      setEditingId(null)
    } catch (e) {
      setError((e as Error).message || "Failed to update")
    }
  }

  async function handleDelete(c: TaskComment) {
    if (!confirm(`Delete this comment?`)) return
    try {
      await api.deleteTaskComment(task.id, c.id)
    } catch (e) {
      setError((e as Error).message || "Failed to delete")
    }
  }

  function canModify(c: TaskComment): boolean {
    if (!currentUser) return false
    if (currentUser.role === 'admin') return true
    if (c.authorType !== 'user') return false
    return String(c.authorId) === String(currentUser.id)
  }

  function resolveAgent(agentId: string) {
    return agents?.find(a => a.id === agentId)
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-muted/10">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        <span className="text-xs font-semibold text-foreground/80 tracking-wide">Comments</span>
        <span className="text-[10px] text-muted-foreground/50">{comments.length}</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/40 ml-1" />}
      </div>

      <div ref={feedRef} className="max-h-[320px] overflow-y-auto p-3 space-y-3">
        {!loading && comments.length === 0 && (
          <p className="text-xs text-muted-foreground/60 italic px-1 py-2">
            No comments yet. Start the conversation below.
          </p>
        )}
        {comments.map(c => {
          const isAgent = c.authorType === 'agent'
          const ag = isAgent ? resolveAgent(c.authorId) : undefined
          const isEditing = editingId === c.id
          return (
            <div key={c.id} className="flex gap-2.5 group">
              {/* Avatar */}
              <div className="shrink-0 mt-0.5">
                {isAgent ? (
                  ag ? (
                    <AgentAvatar avatarPresetId={ag.avatarPresetId} emoji={ag.emoji} size="w-7 h-7" className="rounded-md" />
                  ) : (
                    <div className="w-7 h-7 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-blue-400" />
                    </div>
                  )
                ) : (
                  <div className="w-7 h-7 rounded-md bg-muted/40 border border-border/30 flex items-center justify-center">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Bubble */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className={cn(
                    "text-xs font-semibold",
                    isAgent ? "text-blue-400" : "text-foreground/90"
                  )}>
                    {c.authorName || (isAgent ? `agent-${c.authorId}` : `user-${c.authorId}`)}
                  </span>
                  {isAgent && (
                    <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400/80 border border-blue-500/20 uppercase tracking-wide font-semibold">
                      Agent
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground/50">{relativeTime(c.createdAt)}</span>
                  {c.editedAt && <span className="text-[10px] text-muted-foreground/40 italic">(edited)</span>}
                  {canModify(c) && !isEditing && (
                    <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingId(c.id); setEditDraft(c.body) }}
                        className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground/60 hover:text-foreground"
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(c)}
                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground/60 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="mt-1 space-y-1">
                    <textarea
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      className="w-full text-xs px-2 py-1.5 rounded-md border border-border/40 bg-background/40 focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none min-h-[60px]"
                      autoFocus
                    />
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/30"
                      >
                        <X className="h-3 w-3" /> Cancel
                      </button>
                      <button
                        onClick={() => handleEdit(c)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/20 text-primary hover:bg-primary/30"
                      >
                        <Check className="h-3 w-3" /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-foreground/85 leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
                    {c.body}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer lives in the parent (TaskPanel sticky bottom). */}
      {error && (
        <div className="border-t border-border/30 px-3 py-2 bg-destructive/5">
          <p className="text-[11px] text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}

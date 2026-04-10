import React, { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress", done: "Done",
}

interface SessionMessage {
  role: string
  content: string
  timestamp?: string
  toolName?: string
  toolId?: string
}

interface TaskDetailDrawerProps {
  task: Task | null
  agents: Agent[]
  open: boolean
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

export function TaskDetailDrawer({ task, agents, open, onClose, onUpdate }: TaskDetailDrawerProps) {
  const [activity, setActivity]   = useState<TaskActivity[]>([])
  const [messages, setMessages]   = useState<SessionMessage[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [expandedTools, setExpandedTools]   = useState<Set<string>>(new Set())

  const agent = task?.agentId ? agents.find(a => a.id === task.agentId) : null

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

  useEffect(() => {
    if (!task?.sessionId || !task?.agentId || !open) return
    setLoadingMessages(true)
    fetch(`/api/sessions/${task.agentId}/${task.sessionId}/messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('aoc_token') || ''}` }
    })
      .then(r => r.json())
      .then(r => setMessages(r.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false))
  }, [task?.sessionId, task?.agentId, open])

  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base leading-snug pr-6">{task.title}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={task.status} onValueChange={(v) => onUpdate(task.id, { status: v })}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={task.agentId || ""} onValueChange={(v) => onUpdate(task.id, { assignTo: v || null })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Unassigned</SelectItem>
                {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>)}
              </SelectContent>
            </Select>
            {(task.tags || []).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
            ))}
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
            <TabsTrigger value="agent-work" className="flex-1 text-xs">Agent Work</TabsTrigger>
            <TabsTrigger value="activity" className="flex-1 text-xs">Activity</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 space-y-3">
            {task.description && (
              <div>
                <p className="text-xs text-muted-foreground mb-1 font-medium uppercase tracking-wide">Description</p>
                <p className="text-sm text-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-muted-foreground">Priority:</span> <span className="font-medium capitalize">{task.priority}</span></div>
              {task.cost != null && <div><span className="text-muted-foreground">Cost:</span> <span className="font-medium">${task.cost.toFixed(2)}</span></div>}
              <div><span className="text-muted-foreground">Created:</span> <span className="font-medium">{new Date(task.createdAt).toLocaleDateString()}</span></div>
              {task.completedAt && <div><span className="text-muted-foreground">Completed:</span> <span className="font-medium">{new Date(task.completedAt).toLocaleDateString()}</span></div>}
            </div>
          </TabsContent>

          {/* Agent Work */}
          <TabsContent value="agent-work" className="mt-4">
            {!task.sessionId ? (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Agent belum mulai bekerja pada ticket ini.
              </div>
            ) : loadingMessages ? (
              <div className="text-center py-10 text-muted-foreground text-xs">Loading session...</div>
            ) : messages.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No messages found for this session.</div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => {
                  const isLast = i === messages.length - 1 && msg.role === 'assistant'
                  if (msg.role === 'human') return (
                    <div key={i} className="flex gap-2 justify-end">
                      <div className="bg-primary/10 text-foreground text-xs rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  )
                  if (msg.role === 'tool_use') return (
                    <div key={i} className="border border-border rounded-lg overflow-hidden text-xs">
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/50 hover:bg-muted text-left"
                        onClick={() => setExpandedTools(p => { const n = new Set(p); n.has(String(i)) ? n.delete(String(i)) : n.add(String(i)); return n })}
                      >
                        <span>🔧</span>
                        <span className="font-mono font-medium">{msg.toolName || "tool_use"}</span>
                        <span className="ml-auto text-muted-foreground">{expandedTools.has(String(i)) ? "▲" : "▼"}</span>
                      </button>
                      {expandedTools.has(String(i)) && (
                        <pre className="px-3 py-2 text-[11px] overflow-x-auto text-muted-foreground whitespace-pre-wrap">{msg.content}</pre>
                      )}
                    </div>
                  )
                  if (msg.role === 'tool_result') return null
                  return (
                    <div key={i} className={cn("rounded-lg px-3 py-2 text-xs whitespace-pre-wrap", isLast ? "bg-green-500/10 border border-green-500/20" : "bg-card border border-border")}>
                      {isLast && <p className="text-green-600 dark:text-green-400 font-semibold text-[11px] mb-1">✅ Final Result</p>}
                      {msg.content}
                    </div>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* Activity */}
          <TabsContent value="activity" className="mt-4">
            {loadingActivity ? (
              <div className="text-center py-10 text-muted-foreground text-xs">Loading...</div>
            ) : activity.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No activity yet.</div>
            ) : (
              <div className="space-y-2">
                {activity.map((a) => (
                  <div key={a.id} className="flex gap-3 text-xs">
                    <div className="w-1 shrink-0 bg-border rounded-full mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="font-medium">{a.actor === 'user' ? '👤 User' : `🤖 ${a.actor}`}</span>
                        {a.type === 'status_change' && (
                          <span className="text-muted-foreground">moved <span className="font-mono">{a.fromValue}</span> → <span className="font-mono">{a.toValue}</span></span>
                        )}
                        {a.type === 'assignment' && (
                          <span className="text-muted-foreground">assigned to <span className="font-medium">{a.toValue || 'nobody'}</span></span>
                        )}
                        {a.type === 'created' && <span className="text-muted-foreground">created ticket</span>}
                        {a.type === 'comment' && <span className="text-muted-foreground">commented</span>}
                        <span className="ml-auto text-muted-foreground/60 shrink-0">{new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                      {a.note && <p className="text-muted-foreground mt-0.5 italic">"{a.note}"</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

import React, { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Task, TaskActivity, Agent } from "@/types"
import { api } from "@/lib/api"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Zap } from "lucide-react"
import { AgentWorkTab } from "./AgentWorkTab"

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog", todo: "Todo", in_progress: "In Progress", blocked: "🚫 Blocked", done: "Done",
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
  isActive?: boolean      // whether the drawer is currently visible (for polling control)
  onClose: () => void
  onUpdate: (id: string, patch: object) => Promise<void>
}

export function TaskDetailDrawer({ task, agents, open, isActive = true, onClose, onUpdate }: TaskDetailDrawerProps) {
  const [activity, setActivity]   = useState<TaskActivity[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activeTab, setActiveTab] = useState("overview")
  const [dispatching, setDispatching] = useState(false)
  const [dispatchMsg, setDispatchMsg] = useState("")

  const agent = task?.agentId ? agents.find(a => a.id === task.agentId) : null

  async function handleDispatch() {
    if (!task) return
    setDispatching(true)
    setDispatchMsg("")
    try {
      await api.dispatchTask(task.id)
      setDispatchMsg("✓ Task dispatched — agent is working")
      setTimeout(() => setDispatchMsg(""), 5000)
    } catch (e: unknown) {
      setDispatchMsg(`❌ ${(e as Error).message || "Dispatch failed"}`)
      setTimeout(() => setDispatchMsg(""), 5000)
    } finally {
      setDispatching(false)
    }
  }

  useEffect(() => {
    if (!task || !open) return
    setLoadingActivity(true)
    api.getTaskActivity(task.id)
      .then(r => setActivity(r.activity))
      .catch(() => setActivity([]))
      .finally(() => setLoadingActivity(false))
  }, [task?.id, open])

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
            <Select value={task.agentId || "__none__"} onValueChange={(v) => onUpdate(task.id, { assignTo: v === "__none__" ? null : v })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Unassigned</SelectItem>
                {agents.map(a => <SelectItem key={a.id} value={a.id}>{a.emoji || "🤖"} {a.name || a.id}</SelectItem>)}
              </SelectContent>
            </Select>
            {(task.tags || []).map(tag => (
              <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
            ))}
            {task.agentId && (
              <Button
                size="sm"
                variant={task.status === 'in_progress' ? 'outline' : 'default'}
                className="ml-auto h-7 text-xs gap-1"
                onClick={handleDispatch}
                disabled={dispatching}
                title="Send task to agent via gateway and start a chat session"
              >
                <Zap className="h-3 w-3" />
                {dispatching ? "Dispatching..." : task.sessionId ? "Re-dispatch" : "Dispatch to Agent"}
              </Button>
            )}
          </div>
          {dispatchMsg && (
            <p className="text-xs mt-1 text-muted-foreground">{dispatchMsg}</p>
          )}
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1 text-xs">Overview</TabsTrigger>
            <TabsTrigger value="agent-work" className="flex-1 text-xs">
              Agent Work
              {task.status === 'in_progress' && task.sessionId && (
                <span className="ml-1.5 relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
              )}
            </TabsTrigger>
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

          {/* Agent Work — live session viewer */}
          <TabsContent value="agent-work" className="mt-3">
            {!task.sessionId ? (
              <div className="py-12 text-center space-y-2">
                <p className="text-sm text-muted-foreground">Agent belum mulai bekerja pada ticket ini.</p>
                {task.agentId && (
                  <p className="text-xs text-muted-foreground/60">Klik "Dispatch to Agent" untuk mulai.</p>
                )}
              </div>
            ) : (
              <AgentWorkTab
                sessionKey={task.sessionId}
                agentId={task.agentId || ""}
                isActive={isActive && activeTab === "agent-work"}
                taskStatus={task.status}
              />
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

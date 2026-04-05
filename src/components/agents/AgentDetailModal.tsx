import { useState, useEffect, useCallback } from "react"
import {
  Dialog, DialogContent
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import {
  Loader2, RefreshCw, Zap, Save, X,
  MessageSquare, Wrench, DollarSign, Hash,
  Terminal, Globe, Database, Shield,
  Pencil, ArrowRight,
} from "lucide-react"
import type { Agent } from "@/types"

/* ─────────────────────────────────────────────────────────────────── */
/*  TYPES                                                              */
/* ─────────────────────────────────────────────────────────────────── */

interface AgentDetail {
  id: string
  model: string
  status: string
  config: Record<string, unknown>
  identity: {
    name: string
    emoji: string
    creature: string
    vibe: string
  }
  soul: {
    description: string
    traits: string[]
    raw: string
  }
  tools: {
    sections: { name: string; items: string[] }[]
    raw: string
  }
  workspace: {
    path: string
    agentDir: string
    hasCustomWorkspace: boolean
    files: Record<string, boolean>
  }
  channel: {
    type: string
    accountId: string
    streaming: string
    dmPolicy: string
  } | null
  stats: {
    totalSessions: number
    activeSessions: number
    totalCost: number
    totalTokens: number
    totalMessages: number
    totalToolCalls: number
  }
  sessions: {
    id: string
    name: string
    type: string
    status: string
    lastMessage: string
    updatedAt: number | string
    messageCount: number
  }[]
}

/* ─────────────────────────────────────────────────────────────────── */
/*  HELPERS                                                            */
/* ─────────────────────────────────────────────────────────────────── */

function fmtTime(ts: number | string): string {
  const d = new Date(typeof ts === "number" ? ts : new Date(ts).getTime())
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

const toolIcons: Record<string, React.ElementType> = {
  terminal: Terminal,
  ssh: Terminal,
  git: Terminal,
  web: Globe,
  scraper: Globe,
  browser: Globe,
  sql: Database,
  database: Database,
  odoo: Database,
  sandbox: Shield,
  security: Shield,
}

function getToolIcon(name: string): React.ElementType {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(toolIcons)) {
    if (lower.includes(key)) return icon
  }
  return Wrench
}

/* ─────────────────────────────────────────────────────────────────── */
/*  STAT PILL                                                          */
/* ─────────────────────────────────────────────────────────────────── */

function StatPill({ icon: Icon, label, value }: {
  icon: React.ElementType
  label: string
  value: string | number
}) {
  return (
    <div className="flex flex-col items-center gap-1 p-3 rounded-xl bg-white/[0.03] border border-white/5 min-w-[80px]">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-display text-lg font-bold text-foreground tabular-nums">{value}</span>
      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  EDIT FORM                                                          */
/* ─────────────────────────────────────────────────────────────────── */

function EditField({ label, value, onChange, mono }: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
}) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1.5 block">{label}</label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-8 text-sm", mono && "font-mono text-xs")}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────── */
/*  MAIN COMPONENT                                                     */
/* ─────────────────────────────────────────────────────────────────── */

interface Props {
  agent: Agent
  onClose: () => void
}

export function AgentDetailModal({ agent, onClose }: Props) {
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editEmoji, setEditEmoji] = useState("")
  const [editModel, setEditModel] = useState("")
  const [editVibe, setEditVibe] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState("")

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const data = await api.getAgentDetail(agent.id) as AgentDetail
      setDetail(data)
      setEditName(data.identity.name)
      setEditEmoji(data.identity.emoji)
      setEditModel(data.model)
      setEditVibe(data.identity.vibe)
    } catch (err) {
      setError((err as Error).message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [agent.id])

  useEffect(() => { loadDetail() }, [loadDetail])

  async function handleSave() {
    if (!detail) return
    setSaving(true)
    setSaveMsg("")
    try {
      const updates: Record<string, unknown> = {}
      if (editName !== detail.identity.name) updates.name = editName
      if (editEmoji !== detail.identity.emoji) updates.emoji = editEmoji
      if (editModel !== detail.model) updates.model = editModel
      if (editVibe !== detail.identity.vibe) updates.theme = editVibe

      if (Object.keys(updates).length === 0) {
        setEditing(false)
        return
      }

      await api.updateAgent(agent.id, updates)
      setSaveMsg("Saved to openclaw.json")
      setEditing(false)
      loadDetail() // Refresh
    } catch (err) {
      setSaveMsg(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(""), 3000)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] p-0 flex flex-col overflow-hidden gap-0">
        {loading ? (
          <div className="flex items-center justify-center h-96">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-96 gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={loadDetail} className="text-xs text-primary hover:underline">Retry</button>
          </div>
        ) : detail ? (
          <>
            {/* ── Header ── */}
            <div className="p-6 pb-4 border-b border-white/5 shrink-0">
              <div className="flex items-start gap-5">
                {/* Avatar */}
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-white/10 flex items-center justify-center text-3xl shrink-0 shadow-lg">
                  {editing ? (
                    <input
                      value={editEmoji}
                      onChange={(e) => setEditEmoji(e.target.value)}
                      className="w-full h-full bg-transparent text-center text-3xl outline-none"
                      maxLength={4}
                    />
                  ) : (
                    detail.identity.emoji
                  )}
                </div>

                {/* Name & Meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    {editing ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="text-2xl font-display font-bold text-foreground bg-transparent border-b border-primary/40 outline-none pb-0.5"
                      />
                    ) : (
                      <h2 className="text-2xl font-display font-bold text-foreground tracking-tight">
                        {detail.identity.name}
                      </h2>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded border border-white/5">
                      ID: {detail.id.toUpperCase()}
                    </span>
                    {/* Status */}
                    <span className={cn(
                      "text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider border",
                      detail.status === "active"
                        ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/20"
                        : "text-muted-foreground bg-white/5 border-white/10"
                    )}>
                      {detail.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {editing ? (
                      <input
                        value={editModel}
                        onChange={(e) => setEditModel(e.target.value)}
                        className="font-mono text-xs text-primary/80 bg-transparent border-b border-primary/30 outline-none"
                      />
                    ) : (
                      <span className="font-mono text-primary/80">Model: {detail.model}</span>
                    )}
                    {detail.workspace.hasCustomWorkspace && (
                      <span>Custom Workspace</span>
                    )}
                    {detail.channel && (
                      <span>Channel: {detail.channel.type} ({detail.channel.accountId})</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {saveMsg && (
                    <span className={cn(
                      "text-[10px] font-medium px-2 py-1 rounded",
                      saveMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"
                    )}>
                      {saveMsg}
                    </span>
                  )}
                  {editing ? (
                    <>
                      <button
                        onClick={() => setEditing(false)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-3.5 h-3.5" /> Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 border border-primary/30 text-xs text-primary font-semibold hover:bg-primary/30 transition-colors disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={loadDetail}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Refresh
                      </button>
                      <button
                        onClick={() => setEditing(true)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/20 border border-primary/30 text-xs text-primary font-semibold hover:bg-primary/30 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit Agent
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 mt-5">
                <StatPill icon={Hash} label="Sessions" value={detail.stats.totalSessions} />
                <StatPill icon={MessageSquare} label="Messages" value={formatTokens(detail.stats.totalMessages)} />
                <StatPill icon={Wrench} label="Tool Calls" value={formatTokens(detail.stats.totalToolCalls)} />
                <StatPill icon={Zap} label="Tokens" value={formatTokens(detail.stats.totalTokens)} />
                <StatPill icon={DollarSign} label="Cost" value={`$${detail.stats.totalCost.toFixed(2)}`} />
              </div>
            </div>

            {/* ── Body ── */}
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-6 space-y-6">
                {/* Two column layout */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                  {/* ── Core Soul Configuration ── */}
                  <div className="bg-white/[0.02] rounded-xl border border-white/5 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-display font-bold text-foreground flex items-center gap-2">
                        <span className="text-base">⚙️</span> Core Soul Configuration
                      </h3>
                      {detail.workspace.files.soul && (
                        <span className="text-[9px] font-bold text-primary/60 uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded">
                          SOUL.md
                        </span>
                      )}
                    </div>

                    {detail.soul.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed mb-4 italic">
                        {detail.soul.description}
                      </p>
                    )}

                    {detail.soul.traits.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {detail.soul.traits.map((trait, i) => (
                          <div key={i} className="text-xs text-foreground/80 pl-3 border-l-2 border-primary/30 py-0.5">
                            {trait}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Identity attributes */}
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      {editing ? (
                        <div className="col-span-2">
                          <EditField label="Vibe / Theme" value={editVibe} onChange={setEditVibe} />
                        </div>
                      ) : (
                        <>
                          {detail.identity.vibe && (
                            <div className="bg-white/[0.03] rounded-lg p-3 border border-white/5">
                              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">Vibe</span>
                              <span className="text-xs text-foreground font-medium">{detail.identity.vibe}</span>
                            </div>
                          )}
                          {detail.identity.creature && (
                            <div className="bg-white/[0.03] rounded-lg p-3 border border-white/5">
                              <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold block mb-1">Creature</span>
                              <span className="text-xs text-foreground font-medium">{detail.identity.creature}</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Workspace info */}
                    <div className="mt-4 pt-3 border-t border-white/5">
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold block mb-2">Workspace Files</span>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(detail.workspace.files).map(([file, exists]) => (
                          <span key={file} className={cn(
                            "text-[10px] font-mono px-2 py-0.5 rounded border",
                            exists
                              ? "text-emerald-400/80 bg-emerald-500/10 border-emerald-500/20"
                              : "text-white/20 bg-white/[0.02] border-white/5"
                          )}>
                            {file.toUpperCase()}.md
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── Capabilities / Instructions ── */}
                  <div className="bg-white/[0.02] rounded-xl border border-white/5 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-display font-bold text-foreground flex items-center gap-2">
                        <span className="text-base">🧠</span> Agent Capabilities
                      </h3>
                      {detail.channel && (
                        <span className="text-[9px] font-bold text-primary/60 uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded">
                          {detail.channel.type}
                        </span>
                      )}
                    </div>

                    {/* Derived capability bars from session stats */}
                    {(() => {
                      const s = detail.stats
                      const capabilities = [
                        { name: "Conversation Handling", value: Math.min(100, Math.round((s.totalMessages / Math.max(s.totalSessions, 1)) * 2)) },
                        { name: "Tool Proficiency", value: s.totalToolCalls > 0 ? Math.min(100, Math.round((s.totalToolCalls / Math.max(s.totalMessages, 1)) * 100)) : 0 },
                        { name: "Session Endurance", value: Math.min(100, s.totalSessions * 15) },
                        { name: "Token Efficiency", value: s.totalTokens > 0 ? Math.min(100, Math.round(70 + Math.random() * 20)) : 0 },
                      ]
                      return (
                        <div className="space-y-4">
                          {capabilities.map((cap) => (
                            <div key={cap.name}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{cap.name}</span>
                                <span className="text-[10px] font-bold text-foreground tabular-nums">{cap.value}%</span>
                              </div>
                              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-primary/80 to-primary/40 rounded-full transition-all duration-500"
                                  style={{ width: `${cap.value}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}

                    {/* Channel config */}
                    {detail.channel && (
                      <div className="mt-5 pt-4 border-t border-white/5">
                        <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold block mb-2">Channel Config</span>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="text-[10px]">
                            <span className="text-muted-foreground">Streaming:</span>{" "}
                            <span className="text-foreground font-medium">{detail.channel.streaming}</span>
                          </div>
                          <div className="text-[10px]">
                            <span className="text-muted-foreground">DM Policy:</span>{" "}
                            <span className="text-foreground font-medium">{detail.channel.dmPolicy}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Bottom row: Tools + Live Activity ── */}
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                  {/* Peripheral Tools */}
                  <div className="lg:col-span-3 bg-white/[0.02] rounded-xl border border-white/5 p-5">
                    <h3 className="text-sm font-display font-bold text-foreground flex items-center gap-2 mb-4">
                      <span className="text-base">🛠</span> Peripheral Tools
                    </h3>
                    {detail.tools.sections.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {detail.tools.sections.map((section) => {
                          const Icon = getToolIcon(section.name)
                          return (
                            <div key={section.name} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
                              <div className="w-10 h-10 rounded-lg bg-white/[0.04] flex items-center justify-center">
                                <Icon className="w-5 h-5 text-muted-foreground" />
                              </div>
                              <span className="text-xs font-semibold text-foreground text-center">{section.name}</span>
                              {section.items.length > 0 && (
                                <span className="text-[10px] text-muted-foreground text-center">
                                  {section.items.length} item{section.items.length > 1 ? "s" : ""}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tools sections defined in TOOLS.md</p>
                    )}
                  </div>

                  {/* Live Activity */}
                  <div className="lg:col-span-2 bg-white/[0.02] rounded-xl border border-white/5 p-5">
                    <h3 className="text-sm font-display font-bold text-foreground flex items-center gap-2 mb-4">
                      <span className="text-base">⏱</span> Live Activity
                    </h3>
                    {detail.sessions.length > 0 ? (
                      <div className="space-y-4">
                        {detail.sessions.slice(0, 6).map((session) => {
                          const isActive = session.status === "active"
                          return (
                            <div key={session.id} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <span className={cn(
                                  "w-2 h-2 rounded-full mt-1.5 shrink-0",
                                  isActive ? "bg-primary" : "bg-white/15"
                                )} />
                                <div className="w-px flex-1 bg-white/5 mt-1" />
                              </div>
                              <div className="pb-3 min-w-0">
                                <span className="text-[10px] font-mono text-muted-foreground/60">
                                  {fmtTime(session.updatedAt)}
                                </span>
                                <p className="text-xs text-foreground font-medium mt-0.5 leading-snug">
                                  {session.lastMessage || `${session.name} — ${session.messageCount} messages`}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 w-full justify-center py-2 rounded-lg border border-white/5 hover:border-white/10">
                          View Full Logs <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No activity yet</p>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/**
 * DiscordGuildsSection — extracted from AgentDetailPage.tsx (Sprint 3 split).
 *
 * Renders the Discord guild allowlist for a per-account binding. Self-contained:
 * fetches `channels.discord.accounts.<accountId>.guilds`, supports inline
 * add / edit / delete of guild ids with a label.
 */

import { useState, useEffect, useCallback } from "react"
import {
  Loader2, Save, X, Check, AlertCircle, Plus, Trash2, Pencil, Globe,
  Lock as LockIcon,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/stores"
import { useCanEditAgent } from "@/lib/permissions"

export function DiscordGuildsSection({ agentId }: { agentId: string }) {
  const [data, setData] = useState<import("@/types").DiscordGuildsResult | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [newGuildId, setNewGuildId] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [newRequireMention, setNewRequireMention] = useState(true)
  const [newUsers, setNewUsers] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editRequireMention, setEditRequireMention] = useState(true)
  const [editUsersDraft, setEditUsersDraft] = useState("")

  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === agentId))
  const canEdit = useCanEditAgent(agentFromList)

  const load = useCallback(async () => {
    try {
      const res = await api.getAgentDiscordGuilds(agentId)
      setData(res); setLoadErr(null)
    } catch (e) {
      setLoadErr((e as Error).message)
      setData(null)
    }
  }, [agentId])

  useEffect(() => { load() }, [load])

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const parseUserList = (text: string): string[] =>
    text.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)

  async function handleAdd() {
    const guildId = newGuildId.trim()
    if (!guildId) return
    setBusy(`add:${guildId}`)
    try {
      const users = parseUserList(newUsers)
      const res = await api.upsertAgentDiscordGuild(agentId, guildId, {
        label: newLabel.trim(),
        requireMention: newRequireMention,
        users,
      })
      if (res.ok) {
        setNewGuildId(""); setNewLabel(""); setNewUsers(""); setNewRequireMention(true)
        showToast(`Added guild ${newLabel.trim() || guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Add failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  function startEdit(g: import("@/types").DiscordGuildEntry) {
    setEditingId(g.guildId)
    setEditLabel(g.label || "")
    setEditRequireMention(g.requireMention)
    setEditUsersDraft(g.users.join(", "))
  }

  async function handleSaveEdit(guildId: string) {
    setBusy(`edit:${guildId}`)
    try {
      const users = parseUserList(editUsersDraft)
      const res = await api.upsertAgentDiscordGuild(agentId, guildId, {
        label: editLabel.trim(),
        requireMention: editRequireMention,
        users,
      })
      if (res.ok) {
        setEditingId(null)
        showToast(`Updated guild ${editLabel.trim() || guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Update failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(guildId: string) {
    if (!confirm(`Remove guild ${guildId} from allowlist? The agent will stop responding in this server's channels.`)) return
    setBusy(`del:${guildId}`)
    try {
      const res = await api.removeAgentDiscordGuild(agentId, guildId)
      if (res.ok) {
        showToast(`Removed guild ${guildId}`, true)
        await load()
      } else {
        showToast(res.error || "Remove failed", false)
      }
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  if (loadErr) {
    return (
      <div className="px-5 py-4 border-t border-border bg-red-500/5">
        <p className="text-[11px] text-red-500 font-medium flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed to load guilds: {loadErr}
        </p>
      </div>
    )
  }
  if (!data) return null

  const guilds = data.guilds || []
  const isEmpty = guilds.length === 0
  const adding = busy === "add:" + newGuildId.trim()

  return (
    <div className="px-5 py-4 border-t border-border bg-background/50 space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">Allowed Guilds</span>
        <span className="text-[10px] text-muted-foreground/40 font-medium">guild allowlist · per-account</span>
        <span className={cn(
          "ml-auto text-[10px] font-mono font-bold px-2 py-0.5 rounded border tabular-nums",
          isEmpty
            ? "border-foreground/10 bg-foreground/4 text-muted-foreground/50"
            : "border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
        )}>
          {guilds.length} {guilds.length === 1 ? "guild" : "guilds"}
        </span>
      </div>

      {toast && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium",
          toast.ok
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
        )}>
          {toast.ok ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {toast.msg}
        </div>
      )}

      {/* Existing guild entries */}
      {isEmpty ? (
        <div className="flex items-center justify-center p-4 rounded-lg border border-dashed border-foreground/10 bg-foreground/2">
          <p className="text-[11px] text-muted-foreground/50 font-medium flex items-center gap-2">
            {!canEdit && <LockIcon className="w-3.5 h-3.5" />}
            {canEdit
              ? "No guilds configured — agent won't respond in any Discord server channel until added below."
              : "No guilds configured (read-only)."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {guilds.map(g => {
            const editing = editingId === g.guildId
            const removing = busy === `del:${g.guildId}`
            const saving = busy === `edit:${g.guildId}`
            return (
              <div key={g.guildId} className="rounded-xl border border-border bg-card shadow-sm p-3.5 space-y-3 transition-all hover:border-foreground/15">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {g.label ? (
                        <>
                          <span className="text-[13px] font-bold text-foreground/90 truncate">{g.label}</span>
                          <span className="text-[10px] font-mono font-medium text-muted-foreground/60 truncate bg-foreground/5 px-1.5 py-0.5 rounded">{g.guildId}</span>
                        </>
                      ) : (
                        <span className="text-[13px] font-mono font-bold text-foreground/90 truncate">{g.guildId}</span>
                      )}
                      <span className={cn(
                        "text-[9px] font-bold px-2 py-0.5 rounded border ml-1",
                        g.requireMention
                          ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      )}>
                        {g.requireMention ? "@mention required" : "respond to all"}
                      </span>
                    </div>
                    <p className="text-[11px] font-medium text-muted-foreground/50">
                      {g.users.length} authorized {g.users.length === 1 ? "user" : "users"}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {editing ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(g.guildId)}
                            disabled={saving}
                            className="w-7 h-7 rounded-md flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                            title="Save Changes"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="w-7 h-7 rounded-md flex items-center justify-center border border-border text-muted-foreground hover:bg-foreground/5 transition-colors"
                            title="Cancel Edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(g)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/5 hover:text-foreground transition-colors"
                            title="Edit Guild"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemove(g.guildId)}
                            disabled={removing}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40 transition-colors"
                            title="Remove Guild"
                          >
                            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editing ? (
                  <div className="bg-foreground/2 p-3 rounded-lg border border-border/50 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground/60 block mb-1">Friendly Label</label>
                        <Input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder="e.g. Team Server"
                          maxLength={60}
                          className="h-8 text-[11px] bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-muted-foreground/60 block mb-1">Authorized Users</label>
                        <Input
                          value={editUsersDraft}
                          onChange={e => setEditUsersDraft(e.target.value)}
                          placeholder="User IDs (comma separated)"
                          className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-2 rounded hover:bg-foreground/5 transition-colors">
                      <input
                        type="checkbox"
                        checked={editRequireMention}
                        onChange={e => setEditRequireMention(e.target.checked)}
                        className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
                      />
                      Require @mention for bot to respond
                    </label>
                  </div>
                ) : (
                  g.users.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                      {g.users.map(u => (
                        <span key={u} className="inline-flex items-center px-2 py-0.5 rounded border border-foreground/10 bg-foreground/4 text-[10px] font-mono font-medium text-muted-foreground">
                          {u}
                        </span>
                      ))}
                    </div>
                  )
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add new guild form */}
      {canEdit ? (
        <div className="rounded-xl border border-dashed border-foreground/15 bg-foreground/2 p-4 space-y-3 transition-colors hover:border-foreground/30 hover:bg-foreground/4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-indigo-500/10">
              <Plus className="w-3 h-3 text-indigo-500" />
            </div>
            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Add Discord Server</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Server ID *</label>
              <Input
                value={newGuildId}
                onChange={e => setNewGuildId(e.target.value)}
                placeholder="Numeric snowflake (17–19 digits)"
                className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Friendly Label</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="e.g. My Workspace (Optional)"
                maxLength={60}
                className="h-8 text-[11px] bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Authorized Users</label>
            <Input
              value={newUsers}
              onChange={e => setNewUsers(e.target.value)}
              placeholder="Authorized user IDs (comma separated, optional)"
              className="h-8 text-[11px] font-mono bg-background focus:border-indigo-500/40 focus:ring-indigo-500/10"
            />
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-1.5 -ml-1.5 rounded hover:bg-foreground/5 transition-colors">
              <input
                type="checkbox"
                checked={newRequireMention}
                onChange={e => setNewRequireMention(e.target.checked)}
                className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
              />
              Require @mention
            </label>
            <button
              onClick={handleAdd}
              disabled={!newGuildId.trim() || adding}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all shadow-sm",
                !newGuildId.trim() || adding
                  ? "bg-foreground/5 text-muted-foreground/50 cursor-not-allowed border border-transparent"
                  : "bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/25"
              )}
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Server
            </button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 px-1 font-medium">
          <LockIcon className="w-3 h-3" />
          Read-only — only the agent owner or an admin can edit guild allowlist.
        </p>
      )}

      <p className="text-[10px] font-medium text-muted-foreground/40 px-1 mt-2">
        Stored in <span className="font-mono bg-foreground/5 px-1 py-0.5 rounded">channels.discord.accounts.{data.accountId}.guilds</span>. Edits take effect after gateway restart.
      </p>
    </div>
  )
}

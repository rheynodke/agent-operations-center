/**
 * WhatsAppGroupsSection — sibling to DiscordGuildsSection, but tuned to the
 * WhatsApp schema:
 *   - per-account groupPolicy / groupAllowFrom / historyLimit
 *   - per-group requireMention (label is AOC sidecar)
 *   - per-agent mentionPatterns (regex list)
 *   - "Recently active" picker fed by gateway.log scraping (passive)
 */

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Loader2, Save, X, Check, AlertCircle, Plus, Trash2, Pencil,
  Users as UsersIcon, Lock as LockIcon, MessageSquare,
  ListChecks, RefreshCw,
} from "lucide-react"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { confirmDialog } from "@/lib/dialogs"
import { Input } from "@/components/ui/input"
import { useAgentStore } from "@/stores"
import { useCanEditAgent } from "@/lib/permissions"
import type {
  WhatsAppGroupsResult,
  WhatsAppGroupEntry,
  WhatsAppSeenGroup,
} from "@/types"

type Policy = "open" | "allowlist" | "disabled"

const POLICY_LABEL: Record<Policy, string> = {
  open: "Open (any sender)",
  allowlist: "Allowlist (only listed senders)",
  disabled: "Disabled (block all groups)",
}

function parseTokens(text: string): string[] {
  return text.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  const diffMs = Date.now() - t
  if (diffMs < 60_000) return "just now"
  const m = Math.floor(diffMs / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function WhatsAppGroupsSection({ agentId }: { agentId: string }) {
  const [data, setData] = useState<WhatsAppGroupsResult | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Account-level settings draft
  const [policyDraft, setPolicyDraft] = useState<Policy>("allowlist")
  const [allowFromDraft, setAllowFromDraft] = useState("")
  const [mentionDraft, setMentionDraft] = useState("")
  const [historyDraft, setHistoryDraft] = useState("")

  // Add new group
  const [newJid, setNewJid] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [newRequireMention, setNewRequireMention] = useState(true)

  // Edit existing
  const [editingJid, setEditingJid] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [editRequireMention, setEditRequireMention] = useState(true)

  // Picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [seen, setSeen] = useState<WhatsAppSeenGroup[] | null>(null)
  const [seenErr, setSeenErr] = useState<string | null>(null)
  const [seenLoading, setSeenLoading] = useState(false)

  const agentFromList = useAgentStore((s) => s.agents.find((a) => a.id === agentId))
  const canEdit = useCanEditAgent(agentFromList)

  const load = useCallback(async () => {
    try {
      const res = await api.getAgentWhatsAppGroups(agentId)
      setData(res); setLoadErr(null)
      setPolicyDraft(res.groupPolicy)
      setAllowFromDraft(res.groupAllowFrom.join(", "))
      setMentionDraft(res.mentionPatterns.join("\n"))
      setHistoryDraft(res.historyLimit == null ? "" : String(res.historyLimit))
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

  const settingsDirty = useMemo(() => {
    if (!data) return false
    if (policyDraft !== data.groupPolicy) return true
    if (parseTokens(allowFromDraft).join(",") !== data.groupAllowFrom.join(",")) return true
    if (mentionDraft.split("\n").map(s => s.trim()).filter(Boolean).join("\n") !== data.mentionPatterns.join("\n")) return true
    const histNow = historyDraft.trim() === "" ? null : Number(historyDraft)
    if (histNow !== data.historyLimit) return true
    return false
  }, [data, policyDraft, allowFromDraft, mentionDraft, historyDraft])

  async function handleSaveSettings() {
    if (!data) return
    setBusy("settings")
    try {
      const histNow = historyDraft.trim() === "" ? null : Number(historyDraft)
      const res = await api.updateAgentWhatsAppSettings(agentId, {
        groupPolicy: policyDraft,
        groupAllowFrom: parseTokens(allowFromDraft),
        historyLimit: histNow,
        mentionPatterns: mentionDraft.split("\n").map(s => s.trim()).filter(Boolean),
      })
      setData(res)
      showToast("Account settings saved (restart gateway to apply)", true)
    } catch (e) {
      showToast((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  async function handleAddGroup() {
    const jid = newJid.trim().toLowerCase()
    if (!jid) return
    setBusy(`add:${jid}`)
    try {
      const res = await api.upsertAgentWhatsAppGroup(agentId, jid, {
        label: newLabel.trim(),
        requireMention: newRequireMention,
      })
      if (res.ok) {
        setNewJid(""); setNewLabel(""); setNewRequireMention(true)
        showToast(`Added group ${newLabel.trim() || jid}`, true)
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

  function startEdit(g: WhatsAppGroupEntry) {
    setEditingJid(g.jid)
    setEditLabel(g.label || "")
    setEditRequireMention(g.requireMention)
  }

  async function handleSaveEdit(jid: string) {
    setBusy(`edit:${jid}`)
    try {
      const res = await api.upsertAgentWhatsAppGroup(agentId, jid, {
        label: editLabel.trim(),
        requireMention: editRequireMention,
      })
      if (res.ok) {
        setEditingJid(null)
        showToast(`Updated ${editLabel.trim() || jid}`, true)
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

  async function handleRemove(jid: string, label: string) {
    if (!await confirmDialog({
      title: `Remove group ${label || jid}?`,
      description: "The agent will stop responding in this group.",
      confirmLabel: "Remove",
      destructive: true,
    })) return
    setBusy(`del:${jid}`)
    try {
      const res = await api.removeAgentWhatsAppGroup(agentId, jid)
      if (res.ok) {
        showToast(`Removed ${label || jid}`, true)
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

  async function openPicker() {
    setPickerOpen(true)
    setSeenLoading(true)
    setSeenErr(null)
    try {
      const res = await api.getAgentWhatsAppSeenGroups(agentId)
      setSeen(res.groups)
    } catch (e) {
      setSeenErr((e as Error).message)
      setSeen([])
    } finally {
      setSeenLoading(false)
    }
  }

  function pickFromSeen(jid: string) {
    setNewJid(jid)
    setPickerOpen(false)
  }

  if (loadErr) {
    return (
      <div className="px-5 py-4 border-t border-border bg-red-500/5">
        <p className="text-[11px] text-red-500 font-medium flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Failed to load WhatsApp groups: {loadErr}
        </p>
      </div>
    )
  }
  if (!data) return null

  const groups = data.groups || []
  const configuredJids = new Set(groups.map(g => g.jid))
  const isEmpty = groups.length === 0
  const adding = busy === "add:" + newJid.trim().toLowerCase()
  const savingSettings = busy === "settings"

  return (
    <div className="px-5 py-4 border-t border-border bg-background/50 space-y-5">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <UsersIcon className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider">WhatsApp Groups</span>
        <span className="text-[10px] text-muted-foreground/40 font-medium">activation · per-account</span>
        <span className={cn(
          "ml-auto text-[10px] font-mono font-bold px-2 py-0.5 rounded border tabular-nums",
          isEmpty
            ? "border-foreground/10 bg-foreground/4 text-muted-foreground/50"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        )}>
          {groups.length} {groups.length === 1 ? "group" : "groups"}
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

      {/* ── Account-level settings ────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="w-3.5 h-3.5 text-muted-foreground/60" />
          <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Account Settings</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground/60 block">Group Policy</label>
            <select
              value={policyDraft}
              onChange={e => setPolicyDraft(e.target.value as Policy)}
              disabled={!canEdit}
              className="w-full h-8 text-[11px] font-medium rounded-md border border-border bg-background px-2 disabled:opacity-50"
            >
              <option value="allowlist">{POLICY_LABEL.allowlist}</option>
              <option value="open">{POLICY_LABEL.open}</option>
              <option value="disabled">{POLICY_LABEL.disabled}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-muted-foreground/60 block">History Limit (group msgs)</label>
            <Input
              type="number"
              min={0}
              max={1000}
              value={historyDraft}
              onChange={e => setHistoryDraft(e.target.value)}
              placeholder="50 (default)"
              disabled={!canEdit}
              className="h-8 text-[11px] font-mono bg-background"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-muted-foreground/60 block">
            Group Sender Allowlist (E.164 numbers, comma-separated)
          </label>
          <Input
            value={allowFromDraft}
            onChange={e => setAllowFromDraft(e.target.value)}
            placeholder="6281234567890, 6289000000000"
            disabled={!canEdit || policyDraft !== "allowlist"}
            className="h-8 text-[11px] font-mono bg-background"
          />
          <p className="text-[10px] text-muted-foreground/50">
            Used only when policy = allowlist. Without "+"; same as <code className="font-mono bg-foreground/5 px-1 rounded">groupAllowFrom</code>.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] font-bold text-muted-foreground/60 flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" />
            Mention Patterns (regex, one per line)
          </label>
          <textarea
            value={mentionDraft}
            onChange={e => setMentionDraft(e.target.value)}
            placeholder={"@?openclaw\n\\+?628\\d{8,11}"}
            disabled={!canEdit}
            rows={3}
            className="w-full text-[11px] font-mono rounded-md border border-border bg-background p-2 disabled:opacity-50"
          />
          <p className="text-[10px] text-muted-foreground/50">
            Matched against incoming text to detect bot mentions. Stored at <code className="font-mono bg-foreground/5 px-1 rounded">agents.list[].groupChat.mentionPatterns</code>.
          </p>
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={handleSaveSettings}
              disabled={!settingsDirty || savingSettings}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                !settingsDirty || savingSettings
                  ? "bg-foreground/5 text-muted-foreground/50 cursor-not-allowed border border-transparent"
                  : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
              )}
            >
              {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save Settings
            </button>
          </div>
        )}
      </div>

      {/* ── Configured groups list ────────────────────────────────────────── */}
      {isEmpty ? (
        <div className="flex items-center justify-center p-4 rounded-lg border border-dashed border-foreground/10 bg-foreground/2">
          <p className="text-[11px] text-muted-foreground/50 font-medium flex items-center gap-2">
            {!canEdit && <LockIcon className="w-3.5 h-3.5" />}
            {canEdit
              ? "No groups configured. Agent will follow account-level policy for any group it's in."
              : "No groups configured (read-only)."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {groups.map(g => {
            const editing = editingJid === g.jid
            const removing = busy === `del:${g.jid}`
            const saving = busy === `edit:${g.jid}`
            return (
              <div key={g.jid} className="rounded-xl border border-border bg-card shadow-sm p-3.5 space-y-3 transition-all hover:border-foreground/15">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {g.label ? (
                        <>
                          <span className="text-[13px] font-bold text-foreground/90 truncate">{g.label}</span>
                          <span className="text-[10px] font-mono font-medium text-muted-foreground/60 truncate bg-foreground/5 px-1.5 py-0.5 rounded">{g.jid}</span>
                        </>
                      ) : (
                        <span className="text-[13px] font-mono font-bold text-foreground/90 truncate">{g.jid}</span>
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
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {editing ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(g.jid)}
                            disabled={saving}
                            className="w-7 h-7 rounded-md flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
                            title="Save"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => setEditingJid(null)}
                            className="w-7 h-7 rounded-md flex items-center justify-center border border-border text-muted-foreground hover:bg-foreground/5"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(g)}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemove(g.jid, g.label)}
                            disabled={removing}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                            title="Remove"
                          >
                            {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="bg-foreground/2 p-3 rounded-lg border border-border/50 space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground/60 block mb-1">Friendly Label</label>
                      <Input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        placeholder="e.g. Customer Support"
                        maxLength={80}
                        className="h-8 text-[11px] bg-background"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-2 rounded hover:bg-foreground/5">
                      <input
                        type="checkbox"
                        checked={editRequireMention}
                        onChange={e => setEditRequireMention(e.target.checked)}
                        className="w-3.5 h-3.5 accent-emerald-500 rounded-sm"
                      />
                      Require @mention for bot to respond
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add new group ─────────────────────────────────────────────────── */}
      {canEdit ? (
        <div className="rounded-xl border border-dashed border-foreground/15 bg-foreground/2 p-4 space-y-3 hover:border-foreground/30 hover:bg-foreground/4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-emerald-500/10">
              <Plus className="w-3 h-3 text-emerald-500" />
            </div>
            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-wider">Add WhatsApp Group</span>
            <button
              onClick={openPicker}
              className="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Pick from recently active
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Group JID *</label>
              <Input
                value={newJid}
                onChange={e => setNewJid(e.target.value)}
                placeholder="<digits>[-<digits>]@g.us"
                className="h-8 text-[11px] font-mono bg-background"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-muted-foreground/60 px-0.5">Friendly Label</label>
              <Input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Optional"
                maxLength={80}
                className="h-8 text-[11px] bg-background"
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <label className="inline-flex items-center gap-2 text-[11px] font-medium text-foreground/80 cursor-pointer p-1.5 -ml-1.5 rounded hover:bg-foreground/5">
              <input
                type="checkbox"
                checked={newRequireMention}
                onChange={e => setNewRequireMention(e.target.checked)}
                className="w-3.5 h-3.5 accent-emerald-500 rounded-sm"
              />
              Require @mention
            </label>
            <button
              onClick={handleAddGroup}
              disabled={!newJid.trim() || adding}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-[11px] font-bold transition-all shadow-sm",
                !newJid.trim() || adding
                  ? "bg-foreground/5 text-muted-foreground/50 cursor-not-allowed border border-transparent"
                  : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25"
              )}
            >
              {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Add Group
            </button>
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40 px-1 font-medium">
          <LockIcon className="w-3 h-3" />
          Read-only — only the agent owner or an admin can edit.
        </p>
      )}

      <p className="text-[10px] font-medium text-muted-foreground/40 px-1">
        Stored in <span className="font-mono bg-foreground/5 px-1 py-0.5 rounded">channels.whatsapp.accounts.{data.accountId}</span> + <span className="font-mono bg-foreground/5 px-1 py-0.5 rounded">agents.list[].groupChat</span>. Edits take effect after gateway restart.
      </p>

      {/* ── Picker modal ──────────────────────────────────────────────────── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setPickerOpen(false)}>
          <div
            className="bg-card border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-bold text-foreground">Recently Active Groups</h3>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Groups that sent a message to this bot recently (from gateway.log).
                </p>
              </div>
              <button
                onClick={() => setPickerOpen(false)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-foreground/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {seenLoading && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 p-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Scanning gateway log…
                </div>
              )}
              {!seenLoading && seenErr && (
                <p className="text-[11px] text-red-500 p-3">{seenErr}</p>
              )}
              {!seenLoading && !seenErr && (seen?.length ?? 0) === 0 && (
                <p className="text-[11px] text-muted-foreground/60 p-4 text-center">
                  No active groups found. The bot must receive at least one message in a group for it to appear here. You can also paste the JID manually.
                </p>
              )}
              {!seenLoading && (seen ?? []).map(sg => {
                const already = configuredJids.has(sg.jid)
                return (
                  <button
                    key={sg.jid}
                    onClick={() => !already && pickFromSeen(sg.jid)}
                    disabled={already}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between gap-3",
                      already
                        ? "border-foreground/5 bg-foreground/2 cursor-not-allowed opacity-60"
                        : "border-border hover:border-emerald-500/40 hover:bg-emerald-500/5"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-mono font-bold text-foreground/90 truncate">{sg.jid}</p>
                      <p className="text-[10px] text-muted-foreground/60">last seen {formatRelative(sg.lastSeenAt)}</p>
                    </div>
                    {already ? (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50">already added</span>
                    ) : (
                      <Plus className="w-4 h-4 text-emerald-500" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

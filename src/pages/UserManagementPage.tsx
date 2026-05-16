import { useEffect, useState } from "react"
import { Loader2, Trash2, Copy, Ban, Plus, UserCog, Link as LinkIcon, Check, KeyRound } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { PasswordResetDialog } from "@/components/ui/PasswordResetDialog"
import type { Invitation, ManagedUser } from "@/types"
import { confirmDialog, alertDialog } from "@/lib/dialogs"
import { GatewaysTab } from "@/components/admin/GatewaysTab"

type Confirm =
  | { kind: "revoke-invite"; id: number }
  | { kind: "delete-invite"; id: number }
  | { kind: "delete-user"; user: ManagedUser }

const ROLE_OPTIONS = ["user", "admin"] as const

function formatDate(s?: string | null) {
  if (!s) return "—"
  try { return new Date(s).toLocaleString() } catch { return s }
}

export function UserManagementPage() {
  const currentUser = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<"users" | "invitations" | "gateways">("users")
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Create-invitation form
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [expiresInHours, setExpiresInHours] = useState(24)
  const [inviteRole, setInviteRole] = useState("user")
  const [inviteNote, setInviteNote] = useState("")
  const [creating, setCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [pwReset, setPwReset] = useState<ManagedUser | null>(null)
  const [pwResetLoading, setPwResetLoading] = useState(false)
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null)

  async function refresh() {
    setLoading(true)
    setError("")
    try {
      const [u, i] = await Promise.all([api.listUsers(), api.listInvitations()])
      setUsers(u.users)
      setInvitations(i.invitations)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  async function handleCreateInvitation() {
    setCreating(true)
    try {
      const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString()
      await api.createInvitation({ expiresAt, defaultRole: inviteRole, note: inviteNote || undefined })
      setShowInviteForm(false)
      setInviteNote("")
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invitation")
    } finally {
      setCreating(false)
    }
  }

  async function handleRoleChange(user: ManagedUser, role: string) {
    try { await api.updateUser(user.id, { role }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : "Failed") }
  }

  async function handleTerminalToggle(user: ManagedUser, enabled: boolean) {
    try { await api.updateUser(user.id, { canUseClaudeTerminal: enabled }); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : "Failed") }
  }

  async function handleQuotaSave(user: ManagedUser, raw: string) {
    // Convention: empty / 0 / negative ⇒ unlimited (server stores NULL).
    const trimmed = (raw || "").trim()
    const n = trimmed === "" ? null : Number(trimmed)
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      setError("Token quota must be a non-negative number, or empty for unlimited")
      return
    }
    try {
      await api.updateUser(user.id, { dailyTokenQuota: n })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed")
    }
  }

  async function runConfirm() {
    if (!confirm) return
    setConfirmLoading(true)
    try {
      if (confirm.kind === "revoke-invite") await api.revokeInvitation(confirm.id)
      else if (confirm.kind === "delete-invite") await api.deleteInvitation(confirm.id)
      else if (confirm.kind === "delete-user") await api.deleteUser(confirm.user.id)
      setConfirm(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed")
    } finally {
      setConfirmLoading(false)
    }
  }

  const confirmCopy = !confirm ? null :
    confirm.kind === "revoke-invite" ? {
      title: "Revoke invitation?",
      description: "The link will stop working immediately. Existing users created with it are not affected.",
      confirmLabel: "Revoke",
      destructive: false,
    } :
    confirm.kind === "delete-invite" ? {
      title: "Delete invitation?",
      description: "The link will be permanently removed from the list.",
      confirmLabel: "Delete",
      destructive: true,
    } : {
      title: `Delete user "${confirm.user.username}"?`,
      description: "This cannot be undone. The user will lose access immediately.",
      confirmLabel: "Delete",
      destructive: true,
    }

  function copyInviteLink(inv: Invitation) {
    const url = `${window.location.origin}/register?token=${inv.token}`
    navigator.clipboard.writeText(url)
    setCopiedId(inv.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-6">
        <UserCog className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground">Manage users and invitation links.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-border">
        {(["users", "invitations", "gateways"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "users" ? `users (${users.length})` : t === "invitations" ? `invitations (${invitations.length})` : "gateways"}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : tab === "users" ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr className="text-left">
                <th className="px-4 py-2 font-semibold">Username</th>
                <th className="px-4 py-2 font-semibold">Display name</th>
                <th className="px-4 py-2 font-semibold">Role</th>
                <th className="px-4 py-2 font-semibold" title="Grant access to the Skills page Claude Code terminal">Claude Terminal</th>
                <th className="px-4 py-2 font-semibold" title="Daily token budget. Empty / 0 = unlimited.">Token quota</th>
                <th className="px-4 py-2 font-semibold">Created</th>
                <th className="px-4 py-2 font-semibold">Last login</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-4 py-2 font-mono">{u.username}{currentUser?.id === u.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</td>
                  <td className="px-4 py-2">{u.display_name}</td>
                  <td className="px-4 py-2">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u, e.target.value)}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                    >
                      {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {u.role === "admin" ? (
                      <span className="text-[11px] text-muted-foreground italic">always on (admin)</span>
                    ) : (
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(u.can_use_claude_terminal)}
                          onChange={(e) => handleTerminalToggle(u, e.target.checked)}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-[11px] text-muted-foreground">{u.can_use_claude_terminal ? "Enabled" : "Disabled"}</span>
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {u.role === "admin" ? (
                      <span className="text-[11px] text-muted-foreground italic">unlimited (admin)</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step={1000}
                          defaultValue={u.daily_token_quota ?? ""}
                          placeholder="∞"
                          onBlur={(e) => {
                            const next = e.currentTarget.value
                            const prev = u.daily_token_quota == null ? "" : String(u.daily_token_quota)
                            if (next !== prev) handleQuotaSave(u, next)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
                          }}
                          className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs text-right tabular-nums focus:border-primary outline-none"
                          title="Empty / 0 = unlimited. Otherwise hard cap of tokens per UTC day."
                        />
                        {u.daily_token_quota ? (
                          <span className="text-[10px] text-muted-foreground tabular-nums" title="Used today / Quota">
                            {(u.daily_token_used ?? 0).toLocaleString()}/{u.daily_token_quota.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">unlimited</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{formatDate(u.last_login)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {u.id === 1 ? (
                        <span className="text-xs text-muted-foreground" title="External gateway">External</span>
                      ) : (
                        <>
                          <button
                            onClick={async () => {
                              if (!await confirmDialog({ title: `Restart workspace for ${u.username}?`, confirmLabel: "Restart" })) return
                              try { await api.adminRestartUserGateway(u.id) }
                              catch (e) { alertDialog({ title: "Restart failed", description: (e as Error).message, tone: "error" }) }
                            }}
                            className="text-xs px-2 py-1 border border-border rounded hover:bg-card"
                            title="Restart this user's gateway workspace"
                          >
                            Restart workspace
                          </button>
                          <button
                            onClick={async () => {
                              if (!await confirmDialog({ title: `Stop workspace for ${u.username}?`, confirmLabel: "Stop", destructive: true })) return
                              try { await api.adminStopUserGateway(u.id) }
                              catch (e) { alertDialog({ title: "Stop failed", description: (e as Error).message, tone: "error" }) }
                            }}
                            className="text-xs px-2 py-1 border border-border rounded hover:bg-card text-red-500"
                          >
                            Stop workspace
                          </button>
                        </>
                      )}
                      {currentUser?.id !== u.id && (
                        <>
                          <button
                            onClick={() => setPwReset(u)}
                            className="text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 p-1.5 rounded-md"
                            title="Reset password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button onClick={() => setConfirm({ kind: "delete-user", user: u })} className="text-destructive hover:bg-destructive/10 p-1.5 rounded-md" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "gateways" ? (
        <GatewaysTab />
      ) : (
        <div>
          <div className="flex justify-end mb-3">
            <button
              onClick={() => setShowInviteForm(!showInviteForm)}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              <Plus className="w-4 h-4" /> New invitation
            </button>
          </div>

          {showInviteForm && (
            <div className="rounded-lg border border-border bg-card p-4 mb-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Expires in (hours)</label>
                  <input
                    type="number"
                    min={1}
                    max={8760}
                    value={expiresInHours}
                    onChange={(e) => setExpiresInHours(parseInt(e.target.value) || 1)}
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Default role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Note (optional)</label>
                  <input
                    type="text"
                    value={inviteNote}
                    onChange={(e) => setInviteNote(e.target.value)}
                    placeholder="e.g. for marketing team"
                    className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowInviteForm(false)} className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80">Cancel</button>
                <button onClick={handleCreateInvitation} disabled={creating} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50 inline-flex items-center gap-2">
                  {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Generate link
                </button>
              </div>
            </div>
          )}

          {invitations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted-foreground text-sm">
              No invitations yet.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Note</th>
                    <th className="px-4 py-2 font-semibold">Uses</th>
                    <th className="px-4 py-2 font-semibold">Expires</th>
                    <th className="px-4 py-2 font-semibold">Created</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((inv) => {
                    const status = inv.revokedAt ? "revoked" : inv.expired ? "expired" : "active"
                    const statusColor =
                      status === "active" ? "bg-emerald-500/15 text-emerald-500"
                      : status === "revoked" ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground"
                    return (
                      <tr key={inv.id} className="border-t border-border">
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusColor}`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{inv.defaultRole}</td>
                        <td className="px-4 py-2 text-muted-foreground">{inv.note || "—"}</td>
                        <td className="px-4 py-2">{inv.useCount}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(inv.expiresAt)}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(inv.createdAt)}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {status === "active" && (
                              <>
                                <button onClick={() => copyInviteLink(inv)} title="Copy link"
                                  className="p-1.5 rounded-md hover:bg-secondary">
                                  {copiedId === inv.id ? <Check className="w-4 h-4 text-emerald-500" /> : <LinkIcon className="w-4 h-4" />}
                                </button>
                                <button onClick={() => setConfirm({ kind: "revoke-invite", id: inv.id })} title="Revoke"
                                  className="p-1.5 rounded-md hover:bg-secondary text-amber-500">
                                  <Ban className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            <button onClick={() => setConfirm({ kind: "delete-invite", id: inv.id })} title="Delete"
                              className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-muted-foreground flex items-center gap-2">
        <Copy className="w-3 h-3" /> Invite links: <code className="bg-secondary px-1 py-0.5 rounded">{`${window.location.origin}/register?token=...`}</code>
      </div>

      {confirm && confirmCopy && (
        <ConfirmDialog
          title={confirmCopy.title}
          description={confirmCopy.description}
          confirmLabel={confirmCopy.confirmLabel}
          destructive={confirmCopy.destructive}
          loading={confirmLoading}
          onConfirm={runConfirm}
          onCancel={() => { if (!confirmLoading) setConfirm(null) }}
        />
      )}

      {pwReset && (
        <PasswordResetDialog
          username={pwReset.username}
          loading={pwResetLoading}
          onCancel={() => { if (!pwResetLoading) setPwReset(null) }}
          onSubmit={async (password) => {
            setPwResetLoading(true)
            try {
              await api.resetUserPassword(pwReset.id, password)
              setPwReset(null)
              setToast({ type: "ok", msg: `Password updated for ${pwReset.username}. Tell them to sign out and back in.` })
              setTimeout(() => setToast(null), 5000)
            } catch (e) {
              setToast({ type: "err", msg: `Reset failed: ${(e as Error).message}` })
              setTimeout(() => setToast(null), 5000)
            } finally {
              setPwResetLoading(false)
            }
          }}
        />
      )}

      {toast && (
        <div className={
          "fixed bottom-6 right-6 z-50 max-w-sm px-4 py-3 rounded-xl shadow-2xl border text-sm " +
          (toast.type === "ok"
            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
            : "bg-red-500/15 border-red-500/40 text-red-200")
        }>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

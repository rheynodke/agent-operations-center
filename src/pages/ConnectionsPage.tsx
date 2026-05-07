import React, { useCallback, useEffect, useState } from "react"
import { Plus, Plug, CheckCircle2, XCircle, Loader2, Trash2, RefreshCw, Database, Server, Cloud, Globe, GitBranch, Box, FolderOpen, ChevronRight, ArrowUp, FolderGit2, FileText, Workflow, Eye, EyeOff, X, Share2, Users2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { api } from "@/lib/api"
import { canEditConnection } from "@/lib/permissions"
import { useAuthStore } from "@/stores"
import { Connection, ConnectionType, ConnectionFeatureFlags, GoogleWorkspaceMetadata, McpPreset, McpTool, McpTransport, McpOAuthMetadata } from "@/types"
import { ComposioPanel } from "@/components/connections/ComposioPanel"
import { cn } from "@/lib/utils"
import { useConnectionsStore, useThemeStore } from "@/stores"
import { confirmDialog, alertDialog } from "@/lib/dialogs"

// Asset icons live in /public/connections_icon. GitHub has separate light/dark
// glyphs; everything else is theme-neutral. Returns null → fallback to lucide.
const CONN_ICON_BASE = "/connections_icon"
function getTypeImage(type: string, theme: 'light' | 'dark'): string | null {
  switch (type) {
    case "bigquery": return `${CONN_ICON_BASE}/bigquery.svg`
    case "postgres": return `${CONN_ICON_BASE}/postgres.jpg`
    case "ssh": return `${CONN_ICON_BASE}/vps.png`
    case "website": return `${CONN_ICON_BASE}/website.png`
    case "github": return theme === 'dark' ? `${CONN_ICON_BASE}/github-white.webp` : `${CONN_ICON_BASE}/github-black.png`
    case "odoocli": return `${CONN_ICON_BASE}/odoo.webp`
    case "google_workspace": return `${CONN_ICON_BASE}/google.webp`
    case "mcp": return `${CONN_ICON_BASE}/mcp.png`
    default: return null
  }
}

function ConnectionTypeIcon({ type, size = 40, rounded = "rounded-lg" }: { type: string; size?: number; rounded?: string }) {
  const theme = useThemeStore(s => s.theme)
  const src = getTypeImage(type, theme)
  const Fallback = CONNECTION_TYPES.find(t => t.value === type)?.icon || Plug
  // bg-card backdrop keeps light/transparent assets readable in dark mode and
  // gives the dark-mode github glyph contrast against the card.
  return (
    <div
      className={cn(
        "flex items-center justify-center shrink-0 overflow-hidden",
        rounded
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={type}
          className="object-contain"
          style={{ width: size * 0.7, height: size * 0.7 }}
          draggable={false}
        />
      ) : (
        <Fallback className="h-1/2 w-1/2 text-muted-foreground" />
      )}
    </div>
  )
}

const CONNECTION_TYPES: { value: ConnectionType; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: "bigquery", label: "Google BigQuery", icon: Cloud, description: "Query data warehouse via bq CLI" },
  { value: "postgres", label: "PostgreSQL", icon: Database, description: "Connect to PostgreSQL database" },
  { value: "ssh", label: "VPS / SSH", icon: Server, description: "Remote server access via SSH" },
  { value: "website", label: "Website / Service", icon: Globe, description: "Web service with auth credentials" },
  { value: "github", label: "GitHub Repo", icon: GitBranch, description: "Repository access via gh CLI" },
  { value: "odoocli", label: "Odoo (XML-RPC)", icon: Box, description: "Odoo ERP via odoocli — CRUD, methods, debug" },
  { value: "google_workspace", label: "Google Workspace", icon: FileText, description: "Docs, Drive, Sheets — OAuth per account" },
  { value: "mcp", label: "MCP Server", icon: Workflow, description: "Model Context Protocol — expose external tools to agents (incl. Composio MCP preset)" },
]

// ── MCP Presets ──────────────────────────────────────────────────────────────
// Each preset pre-fills command/args and suggests which env keys are secrets.
// User can always pick "custom" to enter anything.
interface McpPresetDef {
  value: McpPreset
  label: string
  description: string
  transport: McpTransport
  // stdio
  command?: string
  args?: string[]
  secretEnvKeys?: string[]
  // http/sse
  url?: string
  secretHeaderKeys?: string[]
  docsUrl?: string
  // OAuth-backed HTTP server (Mixpanel, future Linear/Notion/etc.)
  oauth?: boolean
}

const MCP_PRESETS: McpPresetDef[] = [
  {
    value: 'filesystem',
    label: 'Filesystem',
    description: 'Read/write local files within allowed dirs',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    secretEnvKeys: [],
  },
  {
    value: 'github',
    label: 'GitHub',
    description: 'Repos, issues, PRs via GitHub API',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    secretEnvKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    value: 'slack',
    label: 'Slack',
    description: 'Post messages, read channels',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    secretEnvKeys: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
  {
    value: 'postgres',
    label: 'PostgreSQL',
    description: 'Query a Postgres DB read-only · credentials via ${DATABASE_URL}',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '${DATABASE_URL}'],
    secretEnvKeys: ['DATABASE_URL'],
  },
  {
    value: 'brave-search',
    label: 'Brave Search',
    description: 'Web + local search via Brave API',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    secretEnvKeys: ['BRAVE_API_KEY'],
  },
  {
    value: 'puppeteer',
    label: 'Puppeteer',
    description: 'Browser automation — navigate, click, screenshot',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    secretEnvKeys: [],
  },
  {
    value: 'memory',
    label: 'Memory',
    description: 'Persistent knowledge graph for the agent',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    secretEnvKeys: [],
  },
  {
    value: 'mixpanel',
    label: 'Mixpanel',
    description: 'Official Mixpanel MCP — OAuth, works through AOC tunnel',
    transport: 'http',
    url: 'https://mcp.mixpanel.com/mcp',
    secretHeaderKeys: [],
    oauth: true, // triggers OAuth flow in create + disables header editor
  },
  {
    value: 'context7-http',
    label: 'Context7',
    description: 'Up-to-date library docs · Bearer API key (anonymous tier rate-limited)',
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
    secretHeaderKeys: ['Authorization'],
  },
  {
    value: 'composio-mcp',
    label: 'Composio MCP',
    description: 'Composio MCP integration · X-CONSUMER-API-KEY (paste ck_x... from app.composio.dev)',
    transport: 'http',
    url: 'https://connect.composio.dev/mcp',
    secretHeaderKeys: ['X-CONSUMER-API-KEY'],
    docsUrl: 'https://app.composio.dev',
  },
  {
    value: 'http-custom',
    label: 'Custom HTTP',
    description: 'Zapier, n8n, any modern remote MCP · URL + optional Bearer token',
    transport: 'http',
    url: '',
    secretHeaderKeys: ['Authorization'],
  },
  {
    value: 'sse-custom',
    label: 'Custom SSE',
    description: 'Legacy transport · only if server does not support Streamable HTTP',
    transport: 'sse',
    url: '',
    secretHeaderKeys: ['Authorization'],
  },
  {
    value: 'custom',
    label: 'Custom stdio',
    description: 'Any stdio MCP server · enter command + args manually',
    transport: 'stdio',
    command: '',
    args: [],
    secretEnvKeys: [],
  },
]

function getTypeLabel(type: string) {
  return CONNECTION_TYPES.find(t => t.value === type)?.label || type
}

// ── Connection Card ──────────────────────────────────────────────────────────

function ConnectionCard({
  conn, onTest, onDelete, onEdit, onManageComposio, onShare, assignedAgents, onGoogleOauth, canEdit,
}: {
  conn: Connection
  onTest: (id: string) => void
  onDelete: (conn: Connection) => void
  onEdit: (conn: Connection) => void
  onManageComposio?: (conn: Connection) => void
  onShare?: (conn: Connection) => void
  assignedAgents?: string[]
  onGoogleOauth?: (authUrl: string) => Promise<{ connectionId: string } | null>
  canEdit: boolean
}) {
  const meta = conn.metadata || {}

  let detail = ""
  if (conn.type === "bigquery") {
    detail = `Project: ${meta.projectId || "?"}` + (meta.datasets?.length ? ` · ${meta.datasets.join(", ")}` : "")
  } else if (conn.type === "postgres") {
    detail = `${meta.host || "localhost"}:${meta.port || 5432}/${meta.database || "?"}`
  } else if (conn.type === "ssh") {
    detail = `${meta.sshUser || "root"}@${meta.sshHost || "?"}:${meta.sshPort || 22}`
  } else if (conn.type === "website") {
    detail = (meta.url || "?") + (meta.loginUrl ? ` · login: ${meta.loginUrl}` : "")
  } else if (conn.type === "github") {
    if (meta.githubMode === "local") {
      detail = `local: ${meta.localPath || "?"} · ${meta.branch || "main"}`
    } else {
      detail = `${meta.repoOwner || "?"}/${meta.repoName || "?"} · ${meta.branch || "main"}`
    }
  } else if (conn.type === "odoocli") {
    detail = `${meta.odooUrl || "?"} · ${meta.odooDb || "?"}`
  } else if (conn.type === "google_workspace") {
    const gmeta = (conn.metadata || {}) as Partial<GoogleWorkspaceMetadata>
    detail = `${gmeta.linkedEmail || '(not linked)'} · ${gmeta.preset || 'custom'}`
  } else if (conn.type === "mcp") {
    const preset = meta.preset || 'custom'
    const transport = (meta.transport as string) || 'stdio'
    const toolCount = (meta.tools || []).length
    let target = ''
    if (transport === 'stdio') {
      const cmd = meta.command || '?'
      const firstArg = (meta.args || [])[1] || (meta.args || [])[0] || ''
      target = `${cmd}${firstArg ? ' ' + firstArg : ''}`
    } else {
      target = meta.url || '?'
    }
    detail = `${preset} · ${transport} · ${target} · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
  } else if (conn.type === "composio") {
    const co = (meta.composio as Partial<{ userId: string; toolkits: string[] }>) || {}
    const tk = co.toolkits || []
    const tkLabel = tk.length === 0 ? 'all toolkits' : `${tk.length} toolkit${tk.length === 1 ? '' : 's'}`
    detail = `user: ${co.userId || '?'} · ${tkLabel}`
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/50 bg-card/60 p-4 hover:border-border hover:shadow-sm transition-all",
        canEdit ? "cursor-pointer" : "cursor-default"
      )}
      onClick={canEdit ? () => onEdit(conn) : undefined}
    >
      <div className="flex items-start gap-3">
        <ConnectionTypeIcon type={conn.type} size={40} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{conn.name}</h3>
            {conn.lastTestOk === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
            {conn.lastTestOk === false && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
            {conn.sharedWithMe && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 font-medium shrink-0"
                title="Shared with you — you can use it for your agents but cannot edit the credential."
              >
                <Share2 className="h-2.5 w-2.5" /> Shared
              </span>
            )}
            {conn.type === "google_workspace" && (() => {
              const gmeta = (conn.metadata || {}) as Partial<GoogleWorkspaceMetadata>
              const state = gmeta.authState || 'unknown'
              const cls = state === 'connected' ? 'bg-emerald-500/15 text-emerald-500'
                       : state === 'expired'   ? 'bg-red-500/15 text-red-500'
                       : state === 'pending'   ? 'bg-yellow-500/15 text-yellow-500'
                       : 'bg-muted text-muted-foreground'
              return <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0", cls)}>{state}</span>
            })()}
            {conn.type === "mcp" && (conn.metadata as { oauth?: McpOAuthMetadata })?.oauth?.enabled && (() => {
              const state = (conn.metadata as { oauth?: McpOAuthMetadata })?.oauth?.authState || 'unknown'
              const cls = state === 'connected' ? 'bg-emerald-500/15 text-emerald-500'
                       : state === 'expired'   ? 'bg-red-500/15 text-red-500'
                       : state === 'pending'   ? 'bg-yellow-500/15 text-yellow-500'
                       : state === 'disconnected' ? 'bg-muted text-muted-foreground'
                       : 'bg-muted text-muted-foreground'
              return <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0", cls)}>oauth · {state}</span>
            })()}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{getTypeLabel(conn.type)}</p>
          {detail && <p className="text-[11px] text-muted-foreground/60 font-mono mt-1 truncate">{detail}</p>}
          {(conn.type === "website" || conn.type === "github" || conn.type === "odoocli") && meta.description && (
            <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-2 leading-relaxed">{meta.description}</p>
          )}
          {assignedAgents && assignedAgents.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {assignedAgents.map(a => (
                <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/70 font-medium">{a}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          {conn.type === 'mcp' && (conn.metadata as { oauth?: McpOAuthMetadata })?.oauth?.enabled && (() => {
            const state = (conn.metadata as { oauth?: McpOAuthMetadata })?.oauth?.authState
            return (
              <>
                {(state === 'pending' || state === 'expired' || state === 'disconnected') && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const { authUrl } = await api.startMcpOauth(conn.id)
                      if (onGoogleOauth) {
                        const result = await onGoogleOauth(authUrl)
                        if (result) onTest(conn.id)
                      }
                    } catch (err) { alertDialog({ title: "OAuth failed", description: (err as Error).message, tone: "error" }) }
                  }}>{state === 'pending' ? 'Connect' : 'Re-authenticate'}</Button>
                )}
                {state === 'connected' && (
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={async (e) => {
                    e.stopPropagation()
                    if (!await confirmDialog({
                      title: `Disconnect ${conn.name}?`,
                      description: "The MCP server will revoke the token. The connection row is kept.",
                      confirmLabel: "Disconnect",
                      destructive: true,
                    })) return
                    try { await api.disconnectMcpOauth(conn.id); onTest(conn.id) }
                    catch (err) { alertDialog({ title: "Disconnect failed", description: (err as Error).message, tone: "error" }) }
                  }}>Disconnect</Button>
                )}
              </>
            )
          })()}
          {conn.type === 'google_workspace' && (() => {
            const gmeta = (conn.metadata || {}) as Partial<GoogleWorkspaceMetadata>
            return (
              <>
                {(gmeta.authState === 'expired' || gmeta.authState === 'disconnected') && (
                  <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" onClick={async (e) => {
                    e.stopPropagation()
                    try {
                      const { authUrl } = await api.reauthGoogleConnection(conn.id)
                      if (onGoogleOauth) {
                        const result = await onGoogleOauth(authUrl)
                        if (result) onTest(conn.id)
                      }
                    } catch (err) {
                      alertDialog({ title: "Re-authenticate failed", description: (err as Error).message, tone: "error" })
                    }
                  }}>Re-authenticate</Button>
                )}
                {gmeta.authState === 'connected' && (
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2" onClick={async (e) => {
                    e.stopPropagation()
                    if (!await confirmDialog({
                      title: `Disconnect ${conn.name}?`,
                      description: "This revokes the token at Google. The connection row is kept.",
                      confirmLabel: "Disconnect",
                      destructive: true,
                    })) return
                    try {
                      await api.disconnectGoogleConnection(conn.id)
                      onTest(conn.id)
                    } catch (err) {
                      alertDialog({ title: "Disconnect failed", description: (err as Error).message, tone: "error" })
                    }
                  }}>Disconnect</Button>
                )}
              </>
            )
          })()}
          {canEdit ? (
            <>
              {conn.type === 'composio' && onManageComposio && (
                <Button
                  size="sm" variant="outline" className="h-7 text-[11px] px-2"
                  onClick={(e) => { e.stopPropagation(); onManageComposio(conn) }}
                  title="Manage connected toolkits"
                >
                  Manage
                </Button>
              )}
              <button
                onClick={() => onTest(conn.id)}
                className="p-1.5 rounded-md hover:bg-muted/30 text-muted-foreground/50 hover:text-foreground transition-colors"
                title="Test connection"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              {onShare && (
                <button
                  onClick={(e) => { e.stopPropagation(); onShare(conn) }}
                  className={cn(
                    "p-1.5 rounded-md transition-colors",
                    conn.shared
                      ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                      : "hover:bg-cyan-500/10 text-muted-foreground/50 hover:text-cyan-300"
                  )}
                  title={conn.shared
                    ? "Shared with the team — click to manage or see who's using it"
                    : "Share with the team (anyone can assign it to their agents; only you can edit/delete)"}
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => onDelete(conn)}
                className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <span className="text-[10px] text-muted-foreground/50 px-1.5" title="Read-only — you are not the owner">read-only</span>
          )}
        </div>
      </div>

      {!conn.enabled && (
        <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground/60 font-medium">Disabled</span>
      )}
    </div>
  )
}

// ── Share Connection Dialog ──────────────────────────────────────────────────
//
// Use-only ACL: recipient enters owner's connection by email — backend resolves
// to a userId and inserts into `connection_shares`. Recipient may then assign
// the connection to their agents (dispatch reads decrypted creds at runtime),
// but cannot edit/delete/test/reauth or read raw credentials.

function ShareConnectionDialog({
  conn, canEdit, onClose, onUpdated,
}: {
  conn: Connection
  canEdit: boolean
  onClose: () => void
  onUpdated: (next: Connection) => void
}) {
  const [shared, setShared] = useState<boolean>(!!conn.shared)
  const [usage, setUsage] = useState<import("@/types").ConnectionUsageEntry[]>([])
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setShared(!!conn.shared) }, [conn.shared])

  useEffect(() => {
    let cancelled = false
    setLoadingUsage(true)
    api.getConnectionUsage(conn.id)
      .then(r => { if (!cancelled) setUsage(r.usage) })
      .catch(e => { if (!cancelled) setError((e as Error).message) })
      .finally(() => { if (!cancelled) setLoadingUsage(false) })
    return () => { cancelled = true }
  }, [conn.id])

  async function toggle() {
    if (!canEdit || submitting) return
    const next = !shared
    setSubmitting(true)
    setError(null)
    const prev = shared
    setShared(next) // optimistic
    try {
      const r = await api.setConnectionShared(conn.id, next)
      onUpdated(r.connection)
    } catch (e) {
      setShared(prev)
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // Group usage by owner so the panel reads "Alice: agent-a, agent-b" instead
  // of one row per agent — keeps the dialog compact when many agents reuse
  // a popular shared credential.
  const groupedUsage = usage.reduce((acc, u) => {
    const key = u.ownerId == null ? '__unknown__' : String(u.ownerId)
    if (!acc[key]) acc[key] = { ownerId: u.ownerId, label: u.ownerEmail || u.ownerUsername || `user #${u.ownerId ?? '?'}`, agents: [] as string[] }
    acc[key].agents.push(u.agentId)
    return acc
  }, {} as Record<string, { ownerId: number | null; label: string; agents: string[] }>)
  const groups = Object.values(groupedUsage).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-cyan-400" />
            Sharing "{conn.name}"
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Toggle */}
          <div className={cn(
            "flex items-start gap-3 p-3 rounded-lg border",
            shared ? "border-cyan-500/30 bg-cyan-500/5" : "border-border/40 bg-muted/20",
          )}>
            <button
              type="button"
              role="switch"
              aria-checked={shared}
              disabled={!canEdit || submitting}
              onClick={toggle}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 mt-0.5 items-center rounded-full transition-colors",
                shared ? "bg-cyan-500" : "bg-muted/60",
                (!canEdit || submitting) && "opacity-50 cursor-not-allowed",
              )}
            >
              <span className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                shared ? "translate-x-4" : "translate-x-0.5",
              )} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {shared ? "Shared with the team" : "Private to you"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                {shared
                  ? "Anyone on this AOC can assign this connection to their agents. Only you (and admins) can edit, test, or delete it. Turning this off will detach every agent currently using it that doesn't belong to you."
                  : "Only you can see and use this connection. Toggle on to let teammates assign it to their own agents."}
              </p>
              {!canEdit && (
                <p className="text-[10px] text-amber-400/80 mt-1.5">Only the owner or an admin can change this.</p>
              )}
            </div>
          </div>

          {error && (
            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-1.5">
              {error}
            </div>
          )}

          {/* Usage list */}
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              <Users2 className="h-3 w-3" />
              Currently in use
              <span className="ml-auto normal-case tracking-normal text-muted-foreground/60">{usage.length} agent{usage.length === 1 ? "" : "s"}</span>
            </div>
            {loadingUsage ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : usage.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic py-2">No agents are using this connection yet.</p>
            ) : (
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {groups.map(g => (
                  <li key={String(g.ownerId)} className="px-2.5 py-1.5 rounded-md bg-muted/20 border border-border/30">
                    <p className="text-xs font-medium text-foreground truncate">{g.label}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {g.agents.map(a => (
                        <span key={a} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 font-mono">{a}</span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Directory Picker ─────────────────────────────────────────────────────────

function DirectoryPicker({
  value, onChange,
}: {
  value: string
  onChange: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState("")
  const [dirs, setDirs] = useState<string[]>([])
  const [parentPath, setParentPath] = useState("")
  const [isGitRepo, setIsGitRepo] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function browse(dirPath?: string) {
    setLoading(true)
    setError("")
    try {
      const r = await api.browseDirs(dirPath)
      setCurrentPath(r.path)
      setDirs(r.dirs)
      setParentPath(r.parent)
      setIsGitRepo(r.isGitRepo)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function handleOpen() {
    setOpen(true)
    browse(value || undefined)
  }

  function handleSelect() {
    onChange(currentPath)
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/path/to/repo"
          className="flex-1 h-8 rounded-md px-3 text-xs font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors"
        />
        <button
          type="button"
          onClick={handleOpen}
          className="h-8 px-2.5 rounded-md border border-border/50 bg-input hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          title="Browse directories"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/50 bg-input overflow-hidden">
      {/* Current path bar */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-border/30 bg-muted/20">
        <button
          type="button"
          onClick={() => browse(parentPath)}
          disabled={loading || currentPath === parentPath}
          className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          title="Go up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">{currentPath}</span>
        {isGitRepo && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">
            <FolderGit2 className="h-3 w-3" /> git repo
          </span>
        )}
      </div>

      {/* Directory list */}
      <div className="max-h-40 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-xs text-red-400 px-3 py-2">{error}</div>
        ) : dirs.length === 0 ? (
          <div className="text-xs text-muted-foreground/50 px-3 py-3 text-center">No subdirectories</div>
        ) : (
          dirs.map(dir => (
            <button
              key={dir}
              type="button"
              onClick={() => browse(`${currentPath}/${dir}`)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-muted/30 transition-colors group"
            >
              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-foreground/70 shrink-0" />
              <span className="truncate text-foreground/80 group-hover:text-foreground">{dir}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground/30 ml-auto shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border/30 bg-muted/20">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSelect}
          className={cn(
            "text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors",
            isGitRepo
              ? "bg-primary/15 text-primary hover:bg-primary/25"
              : "bg-muted/50 text-foreground/70 hover:bg-muted/80"
          )}
        >
          Select this directory
        </button>
      </div>
    </div>
  )
}

// ── Create / Edit Dialog ─────────────────────────────────────────────────────

interface ConnFormState {
  name: string
  type: ConnectionType
  credentials: string
  // BigQuery
  projectId: string
  datasets: string
  // PostgreSQL
  host: string
  port: string
  database: string
  username: string
  sslMode: string
  // SSH
  sshHost: string
  sshPort: string
  sshUser: string
  // Website
  url: string
  loginUrl: string
  authType: string
  authUsername: string
  siteDescription: string
  // GitHub
  githubMode: 'remote' | 'local'
  repoOwner: string
  repoName: string
  branch: string
  localPath: string
  ghDescription: string
  // OdooCLI
  odooUrl: string
  odooDb: string
  odooUsername: string
  odooAuthType: string
  odooDescription: string
  // Google Workspace
  gwsPreset: 'prd-writer' | 'sheets-analyst' | 'full-workspace' | 'custom'
  gwsCustomScopes: string
  // MCP
  mcpPreset: McpPreset
  mcpTransport: McpTransport
  mcpCommand: string
  mcpArgs: string            // one per line
  mcpUrl: string
  mcpDescription: string
  mcpEnv: Array<{ key: string; value: string; secret: boolean }>     // stdio env OR http/sse headers
  mcpOauth: boolean
  // Composio
  composioApiKey: string
  composioUserId: string
  composioToolkits: string[]   // selected toolkit slugs
  composioCustomToolkit: string // free-form input for adding off-list slugs
}

const emptyForm: ConnFormState = {
  name: "", type: "bigquery", credentials: "",
  projectId: "", datasets: "",
  host: "", port: "5432", database: "", username: "", sslMode: "",
  sshHost: "", sshPort: "22", sshUser: "root",
  url: "", loginUrl: "", authType: "basic", authUsername: "", siteDescription: "",
  githubMode: "remote", repoOwner: "", repoName: "", branch: "main", localPath: "", ghDescription: "",
  odooUrl: "", odooDb: "", odooUsername: "", odooAuthType: "password", odooDescription: "",
  gwsPreset: "full-workspace", gwsCustomScopes: "",
  mcpPreset: "filesystem",
  mcpTransport: "stdio",
  mcpCommand: "npx",
  mcpArgs: "-y\n@modelcontextprotocol/server-filesystem\n/tmp",
  mcpUrl: "",
  mcpDescription: "",
  mcpEnv: [],
  mcpOauth: false,
  composioApiKey: "",
  composioUserId: "",
  composioToolkits: [],
  composioCustomToolkit: "",
}

function ConnectionDialog({
  open, onClose, editConn, onGoogleOauth, features,
}: {
  open: boolean
  onClose: () => void
  editConn: Connection | null
  onGoogleOauth?: (authUrl: string) => Promise<{ connectionId: string } | null>
  features: ConnectionFeatureFlags
}) {
  const [form, setForm] = useState<ConnFormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)
  const [error, setError] = useState("")
  // Composio discovery state — populated after the user clicks "Discover".
  const [composioDiscovered, setComposioDiscovered] = useState<{ slug: string; label: string; accountCount: number }[] | null>(null)
  const [composioDiscovering, setComposioDiscovering] = useState(false)
  const [composioDiscoverErr, setComposioDiscoverErr] = useState<string | null>(null)

  useEffect(() => {
    if (editConn) {
      const m = editConn.metadata || {}
      setForm({
        name: editConn.name,
        type: editConn.type,
        credentials: "", // never sent back from server
        projectId: m.projectId || "",
        datasets: (m.datasets || []).join(", "),
        host: m.host || "",
        port: String(m.port || "5432"),
        database: m.database || "",
        username: m.username || "",
        sslMode: m.sslMode || "",
        sshHost: m.sshHost || "",
        sshPort: String(m.sshPort || "22"),
        sshUser: m.sshUser || "root",
        url: m.url || "",
        loginUrl: m.loginUrl || "",
        authType: m.authType || "basic",
        authUsername: m.authUsername || "",
        siteDescription: m.description || "",
        githubMode: (m.githubMode as 'remote' | 'local') || "remote",
        repoOwner: m.repoOwner || "",
        repoName: m.repoName || "",
        branch: m.branch || "main",
        localPath: m.localPath || "",
        ghDescription: m.description || "",
        odooUrl: m.odooUrl || "",
        odooDb: m.odooDb || "",
        odooUsername: m.odooUsername || "",
        odooAuthType: m.odooAuthType || "password",
        odooDescription: m.description || "",
        gwsPreset: ((m as Partial<GoogleWorkspaceMetadata>).preset as ConnFormState['gwsPreset']) || "full-workspace",
        gwsCustomScopes: ((m as Partial<GoogleWorkspaceMetadata>).customScopes || []).join(", "),
        mcpPreset: (m.preset as McpPreset) || "custom",
        mcpTransport: (m.transport as McpTransport) || "stdio",
        mcpCommand: (m.command as string) || "",
        mcpArgs: Array.isArray(m.args) ? (m.args as string[]).join("\n") : "",
        mcpUrl: (m.url as string) || "",
        mcpDescription: (m.description as string) || "",
        mcpOauth: !!(m.oauth && (m.oauth as { enabled?: boolean }).enabled),
        // Union of env vars (stdio) and headers (http/sse). Credentials never come back; list keys as secret placeholders.
        mcpEnv: [
          ...Object.entries((m.env as Record<string, string>) || {}).map(([k, v]) => ({ key: k, value: v, secret: false })),
          ...((m.envKeys as string[]) || []).map(k => ({ key: k, value: "", secret: true })),
          ...Object.entries((m.headers as Record<string, string>) || {}).map(([k, v]) => ({ key: k, value: v, secret: false })),
          ...((m.headerKeys as string[]) || []).map(k => ({ key: k, value: "", secret: true })),
        ],
        composioApiKey: "",
        composioUserId: (m.composio?.userId as string) || "",
        composioToolkits: (m.composio?.toolkits as string[]) || [],
        composioCustomToolkit: "",
      })
    } else {
      setForm(emptyForm)
    }
    setTestResult(null)
    setError("")
  }, [editConn, open])

  function buildMetadata() {
    if (form.type === "bigquery") {
      return {
        projectId: form.projectId,
        datasets: form.datasets.split(",").map(s => s.trim()).filter(Boolean),
      }
    }
    if (form.type === "postgres") {
      return {
        host: form.host, port: Number(form.port) || 5432,
        database: form.database, username: form.username,
        sslMode: form.sslMode || undefined,
      }
    }
    if (form.type === "ssh") {
      return {
        sshHost: form.sshHost, sshPort: Number(form.sshPort) || 22,
        sshUser: form.sshUser,
      }
    }
    if (form.type === "website") {
      return {
        url: form.url,
        loginUrl: form.loginUrl || undefined,
        authType: form.authType || 'none',
        authUsername: form.authUsername || undefined,
        description: form.siteDescription || undefined,
      }
    }
    if (form.type === "github") {
      if (form.githubMode === "local") {
        return {
          githubMode: "local" as const,
          localPath: form.localPath,
          branch: form.branch || 'main',
          description: form.ghDescription || undefined,
        }
      }
      return {
        githubMode: "remote" as const,
        repoOwner: form.repoOwner,
        repoName: form.repoName,
        branch: form.branch || 'main',
        description: form.ghDescription || undefined,
      }
    }
    if (form.type === "odoocli") {
      return {
        odooUrl: form.odooUrl,
        odooDb: form.odooDb,
        odooUsername: form.odooUsername,
        odooAuthType: form.odooAuthType || 'password',
        description: form.odooDescription || undefined,
      }
    }
    if (form.type === "google_workspace") {
      const meta: Record<string, unknown> = { preset: form.gwsPreset }
      if (form.gwsPreset === 'custom') {
        meta.customScopes = form.gwsCustomScopes.split(",").map(s => s.trim()).filter(Boolean)
      }
      return meta
    }
    if (form.type === "mcp") {
      const nonSecret: Record<string, string> = {}
      const secretKeys: string[] = []
      for (const row of form.mcpEnv) {
        if (!row.key) continue
        if (row.secret) secretKeys.push(row.key)
        else nonSecret[row.key] = row.value
      }
      const base: Record<string, unknown> = {
        transport: form.mcpTransport,
        preset: form.mcpPreset,
        description: form.mcpDescription || undefined,
      }
      if (form.mcpTransport === 'stdio') {
        base.command = form.mcpCommand
        base.args = form.mcpArgs.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        base.env = nonSecret
        base.envKeys = secretKeys
      } else {
        base.url = form.mcpUrl
        base.headers = form.mcpOauth ? {} : nonSecret
        base.headerKeys = form.mcpOauth ? [] : secretKeys
        if (form.mcpOauth) {
          // Start as pending; the server sets authState='connected' after
          // completing the callback. Editing an already-connected oauth
          // connection preserves its state via the editConn init block.
          const existing = (editConn?.metadata as { oauth?: McpOAuthMetadata } | undefined)?.oauth
          base.oauth = existing && existing.authState === 'connected'
            ? existing
            : { enabled: true, authState: 'pending' }
        }
      }
      return base
    }
    if (form.type === "composio") {
      const meta: Record<string, unknown> = {
        composio: {
          userId: form.composioUserId || undefined, // server falls back to user email
          toolkits: form.composioToolkits,
        },
      }
      return meta
    }
    return {}
  }

  function buildMcpCredentials(): string | undefined {
    if (form.type !== "mcp") return undefined
    const secrets: Record<string, string> = {}
    let anyFilled = false
    for (const row of form.mcpEnv) {
      if (row.secret && row.key && row.value) {
        secrets[row.key] = row.value
        anyFilled = true
      }
    }
    return anyFilled ? JSON.stringify(secrets) : undefined
  }

  async function handleTest() {
    if (!editConn) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testConnection(editConn.id)
      setTestResult(result)
    } catch (e: unknown) {
      setTestResult({ ok: false, error: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    setTestResult(null)
    try {
      const metadata = buildMetadata()
      const mcpCreds = buildMcpCredentials()
      if (editConn) {
        const patch: Record<string, unknown> = { name: form.name, metadata }
        if (form.type === 'mcp') {
          if (mcpCreds) patch.credentials = mcpCreds
        } else if (form.credentials) {
          patch.credentials = form.credentials
        }
        await api.updateConnection(editConn.id, patch)
        onClose()
      } else {
        const credentials = form.type === 'google_workspace'
          ? undefined
          : form.type === 'mcp'
            ? (mcpCreds || '')
            : form.type === 'composio'
              ? form.composioApiKey
              : form.credentials
        const { authUrl } = await api.createConnection({
          name: form.name, type: form.type,
          credentials,
          metadata,
        })
        onClose()
        // OAuth connections return authUrl to trigger the popup flow.
        // runOauthPopup is content-agnostic (it's just a postMessage listener).
        if (authUrl && onGoogleOauth) {
          if (form.type === 'google_workspace' || (form.type === 'mcp' && form.mcpOauth)) {
            await onGoogleOauth(authUrl)
          }
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const f = form
  const set = (k: keyof ConnFormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // Reset Composio discovery whenever modal closes or apiKey changes — stale
  // results from a different account would mislead the picker.
  useEffect(() => {
    setComposioDiscovered(null)
    setComposioDiscoverErr(null)
  }, [form.composioApiKey, form.composioUserId, open])

  async function handleComposioDiscover() {
    setComposioDiscovering(true)
    setComposioDiscoverErr(null)
    try {
      const res = editConn
        ? await api.composioDiscoverToolkitsForConn(editConn.id)
        : (() => {
            const apiKey = form.composioApiKey.trim()
            if (!apiKey) throw new Error("Enter API key first")
            return api.composioDiscoverToolkits(apiKey, form.composioUserId.trim() || undefined)
          })()
      const data = await Promise.resolve(res)
      setComposioDiscovered(data.toolkits)
      if (data.toolkits.length === 0) {
        setComposioDiscoverErr(`No connected toolkits for user "${data.userId}". Connect one on app.composio.dev first, or add a slug below.`)
      }
    } catch (e) {
      setComposioDiscoverErr((e as Error).message || "Discovery failed")
      setComposioDiscovered(null)
    } finally {
      setComposioDiscovering(false)
    }
  }

  const inputClass = "flex h-8 w-full rounded-md px-3 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors"
  const monoInputClass = inputClass + " font-mono"

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base flex items-center gap-2.5">
            <ConnectionTypeIcon type={f.type} size={32} rounded="rounded-md" />
            <div className="flex flex-col min-w-0">
              <span className="leading-tight truncate">{editConn ? "Edit Connection" : "New Connection"}</span>
              <span className="text-[11px] font-normal text-muted-foreground leading-tight truncate">
                {getTypeLabel(f.type)}
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 py-1">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2.5 py-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Type picker (new) or locked badge (edit) */}
          {!editConn && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CONNECTION_TYPES
                  .filter(t => t.value !== 'google_workspace' || features.googleWorkspace)
                  .map(t => {
                    const selected = f.type === t.value
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => set("type", t.value)}
                        title={t.description}
                        className={cn(
                          "group flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-center transition-all",
                          selected
                            ? "border-primary/70 bg-primary/5 ring-1 ring-primary/30"
                            : "border-border/50 bg-card/40 hover:border-border hover:bg-card/70"
                        )}
                      >
                        <ConnectionTypeIcon type={t.value} size={36} rounded="rounded-md" />
                        <span className={cn(
                          "text-[11px] font-medium leading-tight line-clamp-2",
                          selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                        )}>
                          {t.label}
                        </span>
                      </button>
                    )
                  })}
              </div>
              <p className="text-[10px] text-muted-foreground/60 leading-snug pt-0.5">
                {CONNECTION_TYPES.find(t => t.value === f.type)?.description}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Name</Label>
            <input value={f.name} onChange={e => set("name", e.target.value)}
              placeholder="e.g. DKE BigQuery" className={inputClass} />
          </div>

          {/* Type-specific fields */}
          {f.type === "bigquery" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">GCP Project ID</Label>
                <input value={f.projectId} onChange={e => set("projectId", e.target.value)}
                  placeholder="my-project-123" className={monoInputClass} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Datasets (comma-separated)</Label>
                <input value={f.datasets} onChange={e => set("datasets", e.target.value)}
                  placeholder="dataset1, dataset2" className={monoInputClass} />
                <p className="text-[10px] text-muted-foreground/50">Agent can also discover via bq ls</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Service Account JSON</Label>
                <textarea value={f.credentials} onChange={e => set("credentials", e.target.value)}
                  placeholder={'{"type":"service_account",...}'}
                  rows={4} className="flex w-full rounded-md px-3 py-2 text-[11px] font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
                {editConn?.hasCredentials && !f.credentials && (
                  <p className="text-[10px] text-muted-foreground/50">Credentials stored. Leave blank to keep current.</p>
                )}
              </div>
            </>
          )}

          {f.type === "postgres" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">Host</Label>
                  <input value={f.host} onChange={e => set("host", e.target.value)}
                    placeholder="localhost" className={monoInputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <input value={f.port} onChange={e => set("port", e.target.value)}
                    placeholder="5432" className={monoInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Database</Label>
                  <input value={f.database} onChange={e => set("database", e.target.value)}
                    placeholder="mydb" className={monoInputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <input value={f.username} onChange={e => set("username", e.target.value)}
                    placeholder="postgres" className={monoInputClass} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Password</Label>
                <input type="password" value={f.credentials} onChange={e => set("credentials", e.target.value)}
                  placeholder="••••••••" className={monoInputClass} />
                {editConn?.hasCredentials && !f.credentials && (
                  <p className="text-[10px] text-muted-foreground/50">Password stored. Leave blank to keep current.</p>
                )}
              </div>
            </>
          )}

          {f.type === "ssh" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">Host</Label>
                  <input value={f.sshHost} onChange={e => set("sshHost", e.target.value)}
                    placeholder="192.168.1.100" className={monoInputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Port</Label>
                  <input value={f.sshPort} onChange={e => set("sshPort", e.target.value)}
                    placeholder="22" className={monoInputClass} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Username</Label>
                <input value={f.sshUser} onChange={e => set("sshUser", e.target.value)}
                  placeholder="root" className={monoInputClass} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Private Key (PEM)</Label>
                <textarea value={f.credentials} onChange={e => set("credentials", e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4} className="flex w-full rounded-md px-3 py-2 text-[11px] font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
                {editConn?.hasCredentials && !f.credentials && (
                  <p className="text-[10px] text-muted-foreground/50">Key stored. Leave blank to keep current.</p>
                )}
              </div>
            </>
          )}

          {f.type === "website" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Base URL</Label>
                  <input value={f.url} onChange={e => set("url", e.target.value)}
                    placeholder="https://erp.example.com" className={monoInputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Login URL</Label>
                  <input value={f.loginUrl} onChange={e => set("loginUrl", e.target.value)}
                    placeholder="/web/login" className={monoInputClass} />
                  <p className="text-[10px] text-muted-foreground/50">Path login untuk browser agent</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Auth Type</Label>
                  <Select value={f.authType} onValueChange={v => set("authType", v)}>
                    <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basic">Basic (user/pass)</SelectItem>
                      <SelectItem value="api_key">API Key</SelectItem>
                      <SelectItem value="token">Bearer Token</SelectItem>
                      <SelectItem value="cookie">Cookie / Session</SelectItem>
                      <SelectItem value="none">None (public)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {f.authType !== "none" && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      {f.authType === "basic" ? "Username" : "Key Name"}
                    </Label>
                    <input value={f.authUsername} onChange={e => set("authUsername", e.target.value)}
                      placeholder={f.authType === "basic" ? "admin@example.com" : "X-API-Key"}
                      className={inputClass} />
                  </div>
                )}
              </div>
              {f.authType !== "none" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {f.authType === "basic" ? "Password" : f.authType === "api_key" ? "API Key" : "Token / Secret"}
                  </Label>
                  <input type="password" value={f.credentials} onChange={e => set("credentials", e.target.value)}
                    placeholder="••••••••" className={monoInputClass} />
                  {editConn?.hasCredentials && !f.credentials && (
                    <p className="text-[10px] text-muted-foreground/50">Credential stored. Leave blank to keep current.</p>
                  )}
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <textarea value={f.siteDescription} onChange={e => set("siteDescription", e.target.value)}
                  placeholder="Jelaskan service ini — data/fitur apa yang tersedia, kapan agent harus mengaksesnya, API endpoint yang relevan, dll."
                  rows={3} className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
                <p className="text-[10px] text-muted-foreground/50">Context ini diberikan ke agent saat analysis dan dispatch</p>
              </div>
            </>
          )}

          {f.type === "github" && (
            <>
              {/* Mode toggle */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Mode</Label>
                <div className="flex gap-1.5">
                  {(["remote", "local"] as const).map(m => (
                    <button key={m} type="button"
                      onClick={() => set("githubMode", m)}
                      className={cn(
                        "flex-1 h-8 rounded-md text-xs font-medium border transition-colors",
                        f.githubMode === m
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-input border-border/50 text-muted-foreground hover:text-foreground"
                      )}>
                      {m === "remote" ? "Remote (GitHub API)" : "Local (filesystem)"}
                    </button>
                  ))}
                </div>
              </div>

              {f.githubMode === "remote" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Owner / Org</Label>
                      <input value={f.repoOwner} onChange={e => set("repoOwner", e.target.value)}
                        placeholder="my-org" className={monoInputClass} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Repository</Label>
                      <input value={f.repoName} onChange={e => set("repoName", e.target.value)}
                        placeholder="my-repo" className={monoInputClass} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Branch</Label>
                    <input value={f.branch} onChange={e => set("branch", e.target.value)}
                      placeholder="main" className={monoInputClass} />
                    <p className="text-[10px] text-muted-foreground/50">Default branch untuk agent — agent terisolasi di branch ini</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Personal Access Token (PAT)</Label>
                    <input type="password" value={f.credentials} onChange={e => set("credentials", e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx" className={monoInputClass} />
                    {editConn?.hasCredentials && !f.credentials && (
                      <p className="text-[10px] text-muted-foreground/50">Token stored. Leave blank to keep current.</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/50">Perlu scope: repo, read:org. Bisa di-generate di GitHub Settings → Developer settings → PAT</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Local Path</Label>
                    <DirectoryPicker value={f.localPath} onChange={v => set("localPath", v)} />
                    <p className="text-[10px] text-muted-foreground/50">Pilih direktori git repository di mesin server</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Branch</Label>
                    <input value={f.branch} onChange={e => set("branch", e.target.value)}
                      placeholder="main" className={monoInputClass} />
                    <p className="text-[10px] text-muted-foreground/50">Branch default yang digunakan agent</p>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <textarea value={f.ghDescription} onChange={e => set("ghDescription", e.target.value)}
                  placeholder="Jelaskan repo ini — staging/production, apa yang di-deploy, kapan agent boleh akses, dll."
                  rows={2} className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
              </div>
            </>
          )}

          {f.type === "odoocli" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Odoo URL</Label>
                  <input value={f.odooUrl} onChange={e => set("odooUrl", e.target.value)}
                    placeholder="https://odoo.example.com" className={monoInputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Database</Label>
                  <input value={f.odooDb} onChange={e => set("odooDb", e.target.value)}
                    placeholder="mydb" className={monoInputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Username</Label>
                  <input value={f.odooUsername} onChange={e => set("odooUsername", e.target.value)}
                    placeholder="user@example.com" className={inputClass} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Auth Type</Label>
                  <Select value={f.odooAuthType} onValueChange={v => set("odooAuthType", v)}>
                    <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="api_key">API Key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{f.odooAuthType === "api_key" ? "API Key" : "Password"}</Label>
                <input type="password" value={f.credentials} onChange={e => set("credentials", e.target.value)}
                  placeholder="••••••••" className={monoInputClass} />
                {editConn?.hasCredentials && !f.credentials && (
                  <p className="text-[10px] text-muted-foreground/50">Credential stored. Leave blank to keep current.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <textarea value={f.odooDescription} onChange={e => set("odooDescription", e.target.value)}
                  placeholder="Jelaskan instance ini — staging/production, module apa yang aktif, data apa yang tersedia"
                  rows={2} className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
              </div>
            </>
          )}

          {f.type === "google_workspace" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Scope preset</Label>
                <Select
                  value={f.gwsPreset}
                  onValueChange={v => setForm(prev => ({ ...prev, gwsPreset: v as ConnFormState['gwsPreset'] }))}
                >
                  <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prd-writer">PRD Writer (Docs + Drive.file)</SelectItem>
                    <SelectItem value="sheets-analyst">Sheets Analyst (Sheets + Drive.file)</SelectItem>
                    <SelectItem value="full-workspace">Full Workspace (Docs + Sheets + Slides + Drive.file)</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {f.gwsPreset === 'custom' && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Custom scopes (comma-separated)</Label>
                  <input
                    value={f.gwsCustomScopes}
                    onChange={e => set("gwsCustomScopes", e.target.value)}
                    placeholder="drive.file, docs, spreadsheets"
                    className={monoInputClass}
                  />
                </div>
              )}
              {editConn ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Use the Re-authenticate button on the card to re-link this account.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">
                  After saving, a popup will open to connect your Google account.
                </p>
              )}
            </>
          )}

          {f.type === "mcp" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Preset</Label>
                <Select
                  value={f.mcpPreset}
                  onValueChange={v => {
                    const preset = v as McpPreset
                    const def = MCP_PRESETS.find(p => p.value === preset)
                    setForm(prev => {
                      if (!def) return { ...prev, mcpPreset: preset }
                      const secretKeys = [...(def.secretEnvKeys || []), ...(def.secretHeaderKeys || [])]
                      const nextSecrets = secretKeys.map(k => {
                        const existing = prev.mcpEnv.find(r => r.key === k)
                        return existing ? { ...existing, secret: true } : { key: k, value: "", secret: true }
                      })
                      const preserved = prev.mcpEnv.filter(r => !secretKeys.includes(r.key))
                      return {
                        ...prev,
                        mcpPreset: preset,
                        mcpTransport: def.transport,
                        mcpCommand: def.command ?? prev.mcpCommand,
                        mcpArgs: def.args ? def.args.join("\n") : prev.mcpArgs,
                        mcpUrl: def.url ?? prev.mcpUrl,
                        mcpEnv: def.oauth ? [] : [...nextSecrets, ...preserved],
                        mcpOauth: !!def.oauth,
                      }
                    })
                  }}
                >
                  <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[min(520px,70vh)]">
                    {(() => {
                      const stdioPresets = MCP_PRESETS.filter(p => p.transport === 'stdio' && p.value !== 'custom')
                      const remotePresets = MCP_PRESETS.filter(p => p.transport === 'http' || p.transport === 'sse')
                      const customPresets = MCP_PRESETS.filter(p => p.value === 'custom')
                      const renderItem = (p: McpPresetDef) => (
                        <SelectItem key={p.value} value={p.value} className="py-1.5">
                          <div className="flex items-center gap-2 min-w-0 w-full">
                            <span className="font-medium text-foreground/90 shrink-0">{p.label}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground/70 shrink-0">
                              {p.transport}
                            </span>
                            <span className="text-[11px] text-muted-foreground/70 truncate">{p.description}</span>
                          </div>
                        </SelectItem>
                      )
                      return (
                        <>
                          <SelectGroup>
                            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                              Local — runs on AOC server
                            </SelectLabel>
                            {stdioPresets.map(renderItem)}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                              Remote — hosted MCP endpoint
                            </SelectLabel>
                            {remotePresets.map(renderItem)}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/50 px-2 py-1">
                              Custom
                            </SelectLabel>
                            {customPresets.map(renderItem)}
                          </SelectGroup>
                        </>
                      )
                    })()}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
                  <strong>stdio</strong> = AOC spawns the MCP server as a child process · <strong>HTTP</strong> = modern remote transport (Streamable HTTP) · <strong>SSE</strong> = legacy remote transport, only if the server does not support HTTP.
                </p>
              </div>

              {f.mcpTransport === 'stdio' ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Command</Label>
                    <input value={f.mcpCommand} onChange={e => set("mcpCommand", e.target.value)}
                      placeholder="npx" className={monoInputClass}
                      disabled={f.mcpPreset !== 'custom' && !!f.mcpCommand} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs text-muted-foreground">Args (one per line)</Label>
                    <textarea value={f.mcpArgs} onChange={e => set("mcpArgs", e.target.value)}
                      placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/tmp'}
                      rows={3}
                      className="flex w-full rounded-md px-3 py-2 text-[11px] font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Server URL ({f.mcpTransport === 'http' ? 'Streamable HTTP' : 'SSE'})</Label>
                  <input value={f.mcpUrl} onChange={e => set("mcpUrl", e.target.value)}
                    placeholder="https://mcp.example.com/mcp" className={monoInputClass} />
                  <p className="text-[10px] text-muted-foreground/50">
                    Paste the MCP endpoint URL. Examples: Zapier gives you a per-user URL; n8n self-hosted: <code>https://n8n.example.com/mcp/...</code>; Context7: <code>https://mcp.context7.com/mcp</code>.
                  </p>
                </div>
              )}

              {f.mcpOauth ? (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-400/90 leading-relaxed">
                  <strong>OAuth flow:</strong> after you click Create, a popup will open to sign into the MCP provider. AOC handles the authorization code exchange and token refresh automatically — no API keys needed in the dashboard.
                </div>
              ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">{f.mcpTransport === 'stdio' ? 'Environment variables' : 'HTTP headers'}</Label>
                  <button type="button"
                    onClick={() => setForm(prev => ({ ...prev, mcpEnv: [...prev.mcpEnv, { key: "", value: "", secret: false }] }))}
                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                    <Plus className="h-2.5 w-2.5" /> Add
                  </button>
                </div>
                {f.mcpEnv.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/50">
                    {f.mcpTransport === 'stdio'
                      ? 'No env vars — add tokens/keys required by the MCP server.'
                      : 'No headers — for auth use key "Authorization" with value "Bearer <token>".'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {f.mcpEnv.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <input
                          value={row.key}
                          onChange={e => setForm(prev => ({
                            ...prev,
                            mcpEnv: prev.mcpEnv.map((r, i) => i === idx ? { ...r, key: e.target.value } : r),
                          }))}
                          placeholder="KEY"
                          className={cn(monoInputClass, "flex-1")}
                        />
                        <input
                          type={row.secret ? 'password' : 'text'}
                          value={row.value}
                          onChange={e => setForm(prev => ({
                            ...prev,
                            mcpEnv: prev.mcpEnv.map((r, i) => i === idx ? { ...r, value: e.target.value } : r),
                          }))}
                          placeholder={row.secret && editConn?.hasCredentials && !row.value ? "stored · leave blank to keep" : "value"}
                          className={cn(monoInputClass, "flex-[2]")}
                        />
                        <button type="button"
                          onClick={() => setForm(prev => ({
                            ...prev,
                            mcpEnv: prev.mcpEnv.map((r, i) => i === idx ? { ...r, secret: !r.secret } : r),
                          }))}
                          className={cn(
                            "h-8 px-2 rounded-md border text-[10px] font-medium transition-colors",
                            row.secret
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                              : "border-border/50 bg-input text-muted-foreground hover:text-foreground"
                          )}
                          title={row.secret ? "Secret — stored encrypted" : "Plain env var"}>
                          {row.secret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                        <button type="button"
                          onClick={() => setForm(prev => ({
                            ...prev,
                            mcpEnv: prev.mcpEnv.filter((_, i) => i !== idx),
                          }))}
                          className="h-8 px-1.5 rounded-md text-muted-foreground/50 hover:text-red-400 transition-colors"
                          title="Remove">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground/50">Toggle the eye icon to mark a value as secret — secrets are encrypted and never returned by the API.</p>
              </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <textarea value={f.mcpDescription} onChange={e => set("mcpDescription", e.target.value)}
                  placeholder="What does this MCP server expose? When should agents use it?"
                  rows={2} className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none" />
              </div>

              {editConn && (editConn.metadata as { tools?: McpTool[] } | undefined)?.tools && (editConn.metadata as { tools?: McpTool[] }).tools!.length > 0 && (
                <div className="rounded-md border border-border/40 bg-muted/10 px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
                    Discovered tools ({(editConn.metadata as { tools: McpTool[] }).tools.length})
                  </div>
                  <div className="text-[11px] font-mono text-foreground/70 leading-relaxed">
                    {(editConn.metadata as { tools: McpTool[] }).tools.slice(0, 10).map(t => t.name).join(', ')}
                    {(editConn.metadata as { tools: McpTool[] }).tools.length > 10 && ` +${(editConn.metadata as { tools: McpTool[] }).tools.length - 10} more`}
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground/70">
                After saving, click <strong>Test</strong> to spawn the MCP server and discover its tools.
              </p>
            </>
          )}

        </div>

        {testResult && (
          <div className={cn(
            "flex flex-col gap-1.5 text-xs rounded px-2.5 py-2 shrink-0",
            testResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}>
            <div className="flex items-start gap-2">
              {testResult.ok
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                : <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />}
              <span className="break-all">{testResult.ok ? (testResult.message || "Connection successful") : (testResult.error || "Connection failed")}</span>
            </div>
            {testResult.preview && (
              <details className="text-[10px] opacity-80 ml-5">
                <summary className="cursor-pointer select-none hover:opacity-100">show diagnostic output</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all bg-black/30 rounded p-1.5 max-h-48 overflow-auto font-mono">{testResult.preview}</pre>
              </details>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 pt-2 border-t border-border/40 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs mr-auto" onClick={onClose}>Cancel</Button>
          {editConn && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleTest} disabled={testing || saving}>
              {testing ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Testing…</> : <><RefreshCw className="h-3 w-3 mr-1" />Test</>}
            </Button>
          )}
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}
            disabled={
              saving || !f.name ||
              (!editConn && f.type !== "github" && f.type !== "google_workspace" && f.type !== "mcp" && f.type !== "composio" && !f.credentials) ||
              (f.type === "mcp" && f.mcpTransport === "stdio" && !f.mcpCommand) ||
              (f.type === "mcp" && (f.mcpTransport === "http" || f.mcpTransport === "sse") && !f.mcpUrl) ||
              (f.type === "composio" && !editConn && !f.composioApiKey)
            }>
            {saving ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</> : editConn ? "Update" : (f.type === "google_workspace" ? "Connect Google Account" : f.type === "composio" ? "Create Session" : "Create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const authUser = useAuthStore((s) => s.user)
  const currentUser = authUser ? { id: authUser.id, role: authUser.role } : null
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editConn, setEditConn] = useState<Connection | null>(null)
  const [composioPanelConn, setComposioPanelConn] = useState<Connection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null)
  const [shareTarget, setShareTarget] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  void testingId // reserved for future per-card loader
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [features, setFeatures] = useState<ConnectionFeatureFlags>({ googleWorkspace: false })

  useEffect(() => {
    api.getConnectionFeatures().then(r => setFeatures(r.features)).catch(() => {})
  }, [])

  const runGoogleOauth = useCallback(async (authUrl: string): Promise<{ connectionId: string } | null> => {
    const popup = window.open(authUrl, 'gws-oauth', 'width=600,height=700')
    if (!popup) { alertDialog({ title: "Popup blocked", description: "Please allow popups for this site and retry.", tone: "warn" }); return null }
    return await new Promise((resolve) => {
      const onMsg = (e: MessageEvent) => {
        if (!e.data || typeof e.data !== 'object') return
        if (e.data.type === 'oauth-success') {
          window.removeEventListener('message', onMsg)
          resolve({ connectionId: e.data.connectionId })
        } else if (e.data.type === 'oauth-error') {
          window.removeEventListener('message', onMsg)
          alertDialog({ title: "OAuth failed", description: e.data.error || 'unknown error', tone: "error" })
          resolve(null)
        }
      }
      window.addEventListener('message', onMsg)
      const interval = setInterval(() => {
        if (popup.closed) { clearInterval(interval); window.removeEventListener('message', onMsg); resolve(null) }
      }, 1000)
      setTimeout(() => { clearInterval(interval); window.removeEventListener('message', onMsg); resolve(null) }, 5 * 60 * 1000)
    })
  }, [])

  const load = useCallback(() => {
    Promise.all([
      api.getConnections(),
      api.getConnectionAssignments(),
    ]).then(([r, a]) => {
      setConnections(r.connections)
      setAssignments(a.assignments || {})
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Re-load when WS handlers bump the connections store (e.g. OAuth completed/expired)
  const refreshTick = useConnectionsStore(s => s.refreshTick)
  useEffect(() => {
    if (refreshTick > 0) load()
  }, [refreshTick, load])

  async function handleTest(id: string) {
    setTestingId(id)
    try {
      await api.testConnection(id)
      load()
    } catch {} finally {
      setTestingId(null)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deleteConnection(deleteTarget.id)
      load()
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-3xl font-display font-bold tracking-tight text-foreground">Connections</h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 hidden sm:block">
            Third-party data sources — credentials are encrypted and auto-injected when agents execute tasks
          </p>
        </div>
        <button
          onClick={() => { setEditConn(null); setDialogOpen(true) }}
          className="flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New Connection
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
            <Plug className="h-6 w-6 text-muted-foreground/40" />
          </div>
          <p className="text-sm text-muted-foreground">No connections yet</p>
          <p className="text-xs text-muted-foreground/60">Register a data source so agents can access it during task execution</p>
          <button
            onClick={() => { setEditConn(null); setDialogOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3 w-3" /> Add Connection
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 overflow-y-auto">
          {CONNECTION_TYPES.filter(t => connections.some(c => c.type === t.value)).map(typeInfo => {
            const group = connections.filter(c => c.type === typeInfo.value)
            const Icon = typeInfo.icon
            return (
              <div key={typeInfo.value}>
                {/* Section header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
                    typeInfo.value === "bigquery"  ? "bg-blue-500/10 text-blue-400" :
                    typeInfo.value === "postgres"  ? "bg-indigo-500/10 text-indigo-400" :
                    typeInfo.value === "website"   ? "bg-orange-500/10 text-orange-400" :
                    typeInfo.value === "github"    ? "bg-purple-500/10 text-purple-400" :
                    typeInfo.value === "odoocli"   ? "bg-violet-500/10 text-violet-400" :
                    typeInfo.value === "mcp"       ? "bg-cyan-500/10 text-cyan-400" :
                    typeInfo.value === "google_workspace" ? "bg-blue-500/10 text-blue-400" :
                    "bg-emerald-500/10 text-emerald-400"
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground/70 uppercase tracking-wider">{typeInfo.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground/60 font-medium">{group.length}</span>
                  <div className="flex-1 h-px bg-border/30" />
                </div>
                {/* Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {group.map(conn => (
                    <ConnectionCard
                      key={conn.id}
                      conn={conn}
                      assignedAgents={assignments[conn.id]}
                      onTest={handleTest}
                      onDelete={setDeleteTarget}
                      onEdit={(c) => { setEditConn(c); setDialogOpen(true) }}
                      onManageComposio={(c) => setComposioPanelConn(c)}
                      onShare={(c) => setShareTarget(c)}
                      onGoogleOauth={runGoogleOauth}
                      canEdit={canEditConnection(conn, currentUser)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <ConnectionDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditConn(null); load() }}
        editConn={editConn}
        onGoogleOauth={runGoogleOauth}
        features={features}
      />

      {/* Composio Manage Panel */}
      <ComposioPanel
        open={!!composioPanelConn}
        conn={composioPanelConn}
        onClose={() => { setComposioPanelConn(null); load() }}
      />

      {/* Share Modal */}
      {shareTarget && (
        <ShareConnectionDialog
          conn={shareTarget}
          canEdit={canEditConnection(shareTarget, currentUser)}
          onClose={() => setShareTarget(null)}
          onUpdated={(next) => {
            setShareTarget(next)
            // Refresh the list so the badge + sharedWithMe flag update.
            load()
          }}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Connection"
          description={`"${deleteTarget.name}" will be permanently deleted. Agents will no longer have access to this data source.`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

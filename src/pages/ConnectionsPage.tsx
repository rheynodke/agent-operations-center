import React, { useCallback, useEffect, useState } from "react"
import { Plus, Plug, CheckCircle2, XCircle, Loader2, Trash2, RefreshCw, Database, Server, Cloud, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { api } from "@/lib/api"
import { Connection, ConnectionType } from "@/types"
import { cn } from "@/lib/utils"

const CONNECTION_TYPES: { value: ConnectionType; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  { value: "bigquery", label: "Google BigQuery", icon: Cloud, description: "Query data warehouse via bq CLI" },
  { value: "postgres", label: "PostgreSQL", icon: Database, description: "Connect to PostgreSQL database" },
  { value: "ssh", label: "VPS / SSH", icon: Server, description: "Remote server access via SSH" },
  { value: "website", label: "Website / Service", icon: Globe, description: "Web service with auth credentials" },
]

function getTypeIcon(type: string) {
  return CONNECTION_TYPES.find(t => t.value === type)?.icon || Plug
}

function getTypeLabel(type: string) {
  return CONNECTION_TYPES.find(t => t.value === type)?.label || type
}

// ── Connection Card ──────────────────────────────────────────────────────────

function ConnectionCard({
  conn, onTest, onDelete, onEdit,
}: {
  conn: Connection
  onTest: (id: string) => void
  onDelete: (conn: Connection) => void
  onEdit: (conn: Connection) => void
}) {
  const Icon = getTypeIcon(conn.type)
  const meta = conn.metadata || {}

  let detail = ""
  if (conn.type === "bigquery") {
    detail = `Project: ${meta.projectId || "?"}` + (meta.datasets?.length ? ` · ${meta.datasets.join(", ")}` : "")
  } else if (conn.type === "postgres") {
    detail = `${meta.host || "localhost"}:${meta.port || 5432}/${meta.database || "?"}`
  } else if (conn.type === "ssh") {
    detail = `${meta.sshUser || "root"}@${meta.sshHost || "?"}:${meta.sshPort || 22}`
  } else if (conn.type === "website") {
    detail = meta.url || "?"
  }

  return (
    <div
      className="rounded-xl border border-border/50 bg-card/60 p-4 hover:border-border hover:shadow-sm transition-all cursor-pointer"
      onClick={() => onEdit(conn)}
    >
      <div className="flex items-start gap-3">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
          conn.type === "bigquery" ? "bg-blue-500/10 text-blue-400" :
          conn.type === "postgres" ? "bg-indigo-500/10 text-indigo-400" :
          conn.type === "website" ? "bg-orange-500/10 text-orange-400" :
          "bg-emerald-500/10 text-emerald-400"
        )}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">{conn.name}</h3>
            {conn.lastTestOk === true && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
            {conn.lastTestOk === false && <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{getTypeLabel(conn.type)}</p>
          {detail && <p className="text-[11px] text-muted-foreground/60 font-mono mt-1 truncate">{detail}</p>}
          {conn.type === "website" && meta.description && (
            <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-2 leading-relaxed">{meta.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onTest(conn.id)}
            className="p-1.5 rounded-md hover:bg-muted/30 text-muted-foreground/50 hover:text-foreground transition-colors"
            title="Test connection"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(conn)}
            className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!conn.enabled && (
        <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground/60 font-medium">Disabled</span>
      )}
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
  authType: string
  authUsername: string
  siteDescription: string
}

const emptyForm: ConnFormState = {
  name: "", type: "bigquery", credentials: "",
  projectId: "", datasets: "",
  host: "", port: "5432", database: "", username: "", sslMode: "",
  sshHost: "", sshPort: "22", sshUser: "root",
  url: "", authType: "basic", authUsername: "", siteDescription: "",
}

function ConnectionDialog({
  open, onClose, editConn,
}: {
  open: boolean
  onClose: () => void
  editConn: Connection | null
}) {
  const [form, setForm] = useState<ConnFormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string; error?: string } | null>(null)
  const [error, setError] = useState("")

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
        authType: m.authType || "basic",
        authUsername: m.authUsername || "",
        siteDescription: m.description || "",
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
        authType: form.authType || 'none',
        authUsername: form.authUsername || undefined,
        description: form.siteDescription || undefined,
      }
    }
    return {}
  }

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      const metadata = buildMetadata()
      if (editConn) {
        const patch: Record<string, unknown> = { name: form.name, metadata }
        if (form.credentials) patch.credentials = form.credentials
        await api.updateConnection(editConn.id, patch)
      } else {
        await api.createConnection({
          name: form.name, type: form.type,
          credentials: form.credentials, metadata,
        })
      }
      onClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const f = form
  const set = (k: keyof ConnFormState, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const inputClass = "flex h-8 w-full rounded-md px-3 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors"
  const monoInputClass = inputClass + " font-mono"

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">{editConn ? "Edit Connection" : "New Connection"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 py-1">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2.5 py-1.5">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {error}
            </div>
          )}

          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <input value={f.name} onChange={e => set("name", e.target.value)}
                placeholder="e.g. DKE BigQuery" className={inputClass} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              {editConn ? (
                <div className="h-8 flex items-center px-2.5 rounded-md border border-border/50 bg-input text-xs font-medium">
                  {getTypeLabel(f.type)}
                </div>
              ) : (
                <Select value={f.type} onValueChange={v => set("type", v)}>
                  <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONNECTION_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
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
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">URL</Label>
                <input value={f.url} onChange={e => set("url", e.target.value)}
                  placeholder="https://erp.example.com" className={monoInputClass} />
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
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border/40 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs mr-auto" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSave}
            disabled={saving || !f.name || (!editConn && !f.credentials)}>
            {saving ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</> : editConn ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editConn, setEditConn] = useState<Connection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const load = useCallback(() => {
    api.getConnections().then(r => setConnections(r.connections)).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {connections.map(conn => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              onTest={handleTest}
              onDelete={setDeleteTarget}
              onEdit={(c) => { setEditConn(c); setDialogOpen(true) }}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <ConnectionDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditConn(null); load() }}
        editConn={editConn}
      />

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

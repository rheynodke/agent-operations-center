import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, Plus, Settings as SettingsIcon, Plug, LayoutDashboard, ListChecks, GitBranch, RefreshCw, Loader2, AlertTriangle, Check, Lock, Trash2, Sparkles, BookOpen, Layers, MessageSquare } from "lucide-react"
import { ProjectMemoryTab } from "@/components/projects/ProjectMemoryTab"
import { ProjectPlanTab } from "@/components/projects/ProjectPlanTab"
import { useTaskStore } from "@/stores"
import { useCanEditProject } from "@/lib/permissions"
import { useProjectStore } from "@/stores/useProjectStore"
import { api } from "@/lib/api"
import type { Project } from "@/types"
import { cn } from "@/lib/utils"
import { formatWorkspaceMode, formatProjectKind } from "@/lib/projectLabels"
import BoardPage from "@/pages/BoardPage"
import { ProjectSettingsPanel } from "@/components/board/ProjectSettingsPanel"
import { IntegrationWizard } from "@/components/board/IntegrationWizard"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { BranchPicker } from "@/components/projects/BranchPicker"

type TabKey = "overview" | "board" | "plan" | "memory" | "settings"

const TABS: Array<{ key: TabKey; label: string; icon: typeof LayoutDashboard; adlcOnly?: boolean }> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "board",    label: "Board",    icon: ListChecks },
  { key: "plan",     label: "Plan",     icon: Layers, adlcOnly: true },
  { key: "memory",   label: "Memory",   icon: BookOpen },
  { key: "settings", label: "Settings", icon: SettingsIcon },
]

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const projects = useProjectStore((s) => s.projects)
  const navigate = useNavigate()
  const setProjects = useProjectStore((s) => s.setProjects)

  // Project from store first, fall back to direct fetch (deep-link / refresh).
  const projectFromStore = useMemo(() => projects.find((p) => p.id === id), [projects, id])
  const [projectFetched, setProjectFetched] = useState<Project | null>(null)
  const project = projectFromStore || projectFetched

  // Tab from URL query (?tab=board) for deep-link / refresh stability.
  const tabFromUrl = (searchParams.get("tab") as TabKey) || "board"
  const [tab, setTab] = useState<TabKey>(tabFromUrl)

  // Trigger handed to <BoardPage> so the "New Task" button can live in
  // the project header instead of consuming a dedicated row.
  const boardCreateRef = useRef<(() => void) | null>(null)

  // Permission gate — admin OR creator OR shared/legacy (createdBy=null).
  const canEdit = useCanEditProject(project)

  useEffect(() => {
    if (!id) return
    if (!projectFromStore) {
      api.getProjects()
        .then((data) => {
          if (data?.projects) {
            setProjects(data.projects)
            const found = data.projects.find((p) => p.id === id)
            if (found) setProjectFetched(found)
          }
        })
        .catch(() => { /* surface in UI below */ })
    }
  }, [id, projectFromStore, setProjects])

  useEffect(() => {
    if (tab !== tabFromUrl) {
      const next = new URLSearchParams(searchParams)
      next.set("tab", tab)
      setSearchParams(next, { replace: true })
    }
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!id) return <Navigate404 />

  if (!project) {
    return (
      <div className="flex flex-col h-full gap-4 animate-fade-in">
        <div className="text-sm text-muted-foreground">Loading project…</div>
      </div>
    )
  }

  async function openRoom() {
    if (!project) return
    const res = await api.getProjectRoom(project.id)
    navigate(`/chat?tab=rooms&roomId=${encodeURIComponent(res.room.id)}`)
  }

  return (
    <div className="flex flex-col h-full gap-2 animate-fade-in">
      {/* One-row header: back-link · color dot · name · kind · action */}
      <div className="flex items-center gap-2 shrink-0 min-w-0">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
          title="Back to projects"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <span className="text-muted-foreground/40 shrink-0">/</span>
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <h1 className="text-base sm:text-lg font-display font-semibold tracking-tight text-foreground truncate">
          {project.name}
        </h1>
        {project.kind && (
          <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium uppercase tracking-wide shrink-0">
            {formatProjectKind(project.kind)}
          </span>
        )}

        {/* Spacer pushes action to the right */}
        <div className="flex-1 min-w-0" />

        {/* Read-only indicator (non-owners) */}
        {!canEdit && (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/60 text-muted-foreground text-[11px] shrink-0"
            title="You can view this project but not modify it. Only the creator (or an admin) can edit."
          >
            <Lock className="h-3 w-3" /> Read-only
          </span>
        )}

        {/* Primary action — context-aware to the active tab; gated to editors. */}
        <button
          onClick={openRoom}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-muted/50 border border-border text-muted-foreground text-xs font-semibold hover:text-foreground hover:bg-muted transition-colors shrink-0"
          title="Open project room"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Open Room</span>
        </button>
        {tab === "board" && canEdit && (
          <button
            onClick={() => boardCreateRef.current?.()}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors shrink-0"
            title="New task in this project"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Task</span>
          </button>
        )}
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-border/60 shrink-0">
        {TABS.filter(t => !t.adlcOnly || project.kind === 'adlc').map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {tab === "overview" && <OverviewTab project={project} onJumpBoard={() => setTab("board")} />}
        {tab === "board"    && <BoardPage projectId={id} hideHeader openCreateRef={boardCreateRef} />}
        {tab === "plan" && project.kind === 'adlc' && (
          <ProjectPlanTab
            projectId={project.id}
            canEdit={canEdit}
            onJumpToBoardWithFilter={(epicId) => {
              // Apply epic filter then switch to board.
              useTaskStore.getState().setFilters({ epicId: epicId || undefined })
              setTab("board")
            }}
          />
        )}
        {tab === "memory"   && <ProjectMemoryTab projectId={project.id} canEdit={canEdit} />}
        {tab === "settings" && <SettingsTab project={project} canEdit={canEdit} />}
      </div>
    </div>
  )
}

function OverviewTab({ project, onJumpBoard }: { project: Project; onJumpBoard: () => void }) {
  return (
    <div className="space-y-4">
      <Card title="About">
        {project.description
          ? <p className="text-sm text-foreground/90 whitespace-pre-wrap">{project.description}</p>
          : <p className="text-sm text-muted-foreground italic">No description.</p>}
      </Card>

      <Card title="Workspace">
        {project.workspacePath ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <Field label="Type"     value={formatWorkspaceMode(project.workspaceMode)} />
            <Field label="Kind"     value={formatProjectKind(project.kind)} />
            <Field label="Path"     value={project.workspacePath}       mono />
            <Field label="Branch"   value={project.repoBranch || "—"}   mono />
            {project.repoUrl && <Field label="Remote" value={project.repoUrl} mono />}
            {project.boundAt && <Field label="Bound at" value={new Date(project.boundAt).toLocaleString()} />}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            This project has no workspace bound. Tasks dispatched here run in the agent's own workspace.
          </p>
        )}
      </Card>

      <button
        onClick={onJumpBoard}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
      >
        <ListChecks className="h-3.5 w-3.5" />
        Open task board
      </button>
    </div>
  )
}

function SettingsTab({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="space-y-4">
      {!canEdit && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 flex items-start gap-2">
          <Lock className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-foreground">Read-only view</p>
            <p className="text-muted-foreground mt-0.5">
              You can view this project's settings but not modify them. Only the project's creator
              (or an admin) can change metadata, manage integrations, or edit the workspace binding.
            </p>
          </div>
        </div>
      )}

      <Card title="Project metadata">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <Field label="ID"      value={project.id} mono />
          <Field label="Name"    value={project.name} />
          <Field label="Color"   value={project.color} mono />
          <Field label="Created" value={new Date(project.createdAt).toLocaleString()} />
          {project.createdBy != null && <Field label="Created by (user ID)" value={String(project.createdBy)} />}
          {project.description && <Field label="Description" value={project.description} />}
        </dl>
        <p className="text-[11px] text-muted-foreground mt-3">
          Inline edit lands in a later iteration. For now, edit metadata via the API.
        </p>
      </Card>

      <Card title="Integrations">
        <p className="text-[11px] text-muted-foreground mb-3">
          Sync external sources (Google Sheets, etc.) into this project's task board.
        </p>
        <button
          onClick={() => setPanelOpen(true)}
          disabled={!canEdit}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plug className="h-3.5 w-3.5" />
          Manage integrations
        </button>
      </Card>

      {project.workspacePath && (
        <WorkspaceBindingCard project={project} canEdit={canEdit} />
      )}

      {/* Epics moved to dedicated Plan tab (Phase C.6 — first-class epic UX). */}

      <ProjectSettingsPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onAddIntegration={() => { setPanelOpen(false); setWizardOpen(true) }}
        onEditIntegration={() => { setPanelOpen(false); setWizardOpen(true) }}
      />
      <IntegrationWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
      />
    </div>
  )
}

function WorkspaceBindingCard({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const setProjects = useProjectStore((s) => s.setProjects)
  const projects    = useProjectStore((s) => s.projects)

  const [switchOpen, setSwitchOpen] = useState(false)
  const [pendingBranch, setPendingBranch] = useState<string | null>(project.repoBranch || null)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [switchedFiles, setSwitchedFiles] = useState<Array<{status: string; path: string}> | null>(null)

  const [refetching, setRefetching] = useState(false)
  const [refetchError, setRefetchError] = useState<string | null>(null)
  const [refetchOk, setRefetchOk] = useState(false)

  function refreshProjectInStore(updated: Project) {
    setProjects(projects.map((p) => p.id === updated.id ? updated : p))
  }

  async function handleSwitch() {
    if (!pendingBranch || pendingBranch === project.repoBranch) {
      setSwitchOpen(false); return
    }
    setSwitching(true); setSwitchError(null); setSwitchedFiles(null)
    try {
      const res = await api.switchProjectBranch(project.id, pendingBranch)
      refreshProjectInStore(res.project)
      setSwitchOpen(false)
    } catch (e) {
      const msg = (e as Error).message
      setSwitchError(msg)
      // Try to surface dirty file info from server's 409 if shaped that way
      const m = msg.match(/uncommittedFiles/)
      if (m) {
        try {
          const errObj = JSON.parse(msg)
          if (Array.isArray(errObj.uncommittedFiles)) setSwitchedFiles(errObj.uncommittedFiles)
        } catch {}
      }
    } finally {
      setSwitching(false)
    }
  }

  async function handleRefetch() {
    setRefetching(true); setRefetchError(null); setRefetchOk(false)
    try {
      const res = await api.refetchProjectBranches(project.id)
      if (res.project) refreshProjectInStore(res.project)
      if (res.fetchSucceeded === false && res.fetchError) setRefetchError(res.fetchError)
      else setRefetchOk(true)
    } catch (e) {
      setRefetchError((e as Error).message)
    } finally {
      setRefetching(false)
      window.setTimeout(() => setRefetchOk(false), 3000)
    }
  }

  return (
    <Card title="Workspace binding" tone="muted">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <Field label="Path"   value={project.workspacePath || '—'} mono />
        <Field label="Type"   value={formatWorkspaceMode(project.workspaceMode)} />
        <Field label="Branch" value={project.repoBranch || "—"}    mono />
        {project.repoUrl && <Field label="Remote" value={project.repoUrl} mono />}
        {project.lastFetchedAt && (
          <Field label="Last fetched" value={new Date(project.lastFetchedAt).toLocaleString()} />
        )}
      </dl>

      {/* Action row — disabled for non-editors. */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button
          size="sm" variant="outline" className="h-7 text-xs"
          disabled={!canEdit}
          onClick={() => { setPendingBranch(project.repoBranch || null); setSwitchError(null); setSwitchedFiles(null); setSwitchOpen(true) }}
        >
          <GitBranch className="h-3 w-3 mr-1" /> Switch branch
        </Button>
        <Button
          size="sm" variant="outline" className="h-7 text-xs"
          onClick={handleRefetch}
          disabled={refetching || !canEdit}
        >
          {refetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
          Refetch
        </Button>
        {refetchOk && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
            <Check className="h-3 w-3" /> Refreshed
          </span>
        )}
        {refetchError && (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
            <AlertTriangle className="h-3 w-3" /> Fetch failed: {refetchError}
          </span>
        )}
      </div>

      {/* Switch branch modal */}
      <Dialog open={switchOpen} onOpenChange={(o) => { if (!o) setSwitchOpen(false) }}>
        <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Switch branch</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              Switch the active git branch for this project. Working tree must be clean —
              commit or stash any uncommitted changes first.
            </p>
            <BranchPicker
              projectId={project.id}
              value={pendingBranch}
              onChange={setPendingBranch}
              autoFetch
            />
            {switchError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p>{switchError}</p>
                  {switchedFiles && switchedFiles.length > 0 && (
                    <ul className="mt-1 font-mono text-[10px]">
                      {switchedFiles.slice(0, 6).map((f, i) => (
                        <li key={i}>{f.status || '??'} {f.path}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSwitchOpen(false)}>Cancel</Button>
            <Button
              size="sm" className="h-7 text-xs"
              onClick={handleSwitch}
              disabled={switching || !pendingBranch || pendingBranch === project.repoBranch}
            >
              {switching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function Card({ title, tone, children }: { title: string; tone?: "muted"; children: React.ReactNode }) {
  return (
    <div className={cn(
      "rounded-xl border border-border/50 p-4",
      tone === "muted" ? "bg-muted/40" : "bg-card"
    )}>
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground/70 font-semibold mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground/60">{label}</dt>
      <dd className={cn("text-foreground break-all", mono && "font-mono text-[11px]")}>{value}</dd>
    </div>
  )
}

function Navigate404() {
  return (
    <div className="text-sm text-muted-foreground p-8 text-center">
      Invalid project URL. <Link to="/projects" className="text-primary hover:underline">Back to Projects</Link>.
    </div>
  )
}

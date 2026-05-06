import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Plus, FolderGit2, Folder, GitBranch, FolderTree, Sparkles, Wrench, FlaskConical, ChevronRight, Lock } from "lucide-react"
import { useProjectStore } from "@/stores/useProjectStore"
import { ProjectCreateWizard } from "@/components/projects/ProjectCreateWizard"
import { api } from "@/lib/api"
import type { Project, ProjectKind } from "@/types"
import { cn } from "@/lib/utils"
import { formatWorkspaceMode } from "@/lib/projectLabels"
import { canEditProject } from "@/lib/permissions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import MetricsPage from "./MetricsPage"
import { useAuthStore } from "@/stores"

const KIND_META: Record<ProjectKind, { label: string; icon: typeof Folder; tone: string }> = {
  adlc:     { label: "ADLC",     icon: Sparkles,     tone: "text-violet-500 bg-violet-500/10 border-violet-500/20" },
  codebase: { label: "Codebase", icon: FolderGit2,   tone: "text-blue-500 bg-blue-500/10 border-blue-500/20" },
  ops:      { label: "Ops",      icon: Wrench,       tone: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20" },
  research: { label: "Research", icon: FlaskConical, tone: "text-amber-500 bg-amber-500/10 border-amber-500/20" },
}

function relativeTime(iso?: string): string {
  if (!iso) return ""
  const d = new Date(iso).getTime()
  if (Number.isNaN(d)) return ""
  const now = Date.now()
  const sec = Math.floor((now - d) / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function shortPath(p?: string): string {
  if (!p) return ""
  const home = "/Users/" // best-effort: replace any /Users/{name}/ with ~/
  if (p.startsWith(home)) {
    const rest = p.slice(home.length)
    const slash = rest.indexOf("/")
    if (slash >= 0) return "~/" + rest.slice(slash + 1)
  }
  return p
}

export default function ProjectsPage() {
  const projects = useProjectStore((s) => s.projects)
  const setProjects = useProjectStore((s) => s.setProjects)
  const [wizardOpen, setWizardOpen] = useState(false)

  // Refresh on mount so newly created/edited workspace metadata is up-to-date.
  useEffect(() => {
    let cancelled = false
    api.getProjects()
      .then((data) => { if (!cancelled && data?.projects) setProjects(data.projects) })
      .catch(() => { /* keep store value */ })
    return () => { cancelled = true }
  }, [setProjects])

  return (
    <div className="flex flex-col h-full gap-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4 mb-2 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            Projects
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 hidden sm:block">
            Workspace-bound projects with their own task board, integrations, and (optionally) git repository.
          </p>
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Project
        </button>
      </div>

      <Tabs defaultValue="list" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit shrink-0 mb-2">
          <TabsTrigger value="list">Project List</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="flex-1 min-h-0 overflow-y-auto outline-none mt-2">
          {/* Grid of project cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
            {projects.length === 0 && (
              <div className="col-span-full p-8 text-center text-muted-foreground text-sm">
                No projects yet. Click <span className="text-foreground">New Project</span> to create one.
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="metrics" className="flex-1 min-h-0 overflow-y-auto outline-none mt-2 -mx-4 -mb-4 px-4 pb-4">
          <MetricsPage />
        </TabsContent>
      </Tabs>

      <ProjectCreateWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const kindKey: ProjectKind = (project.kind && KIND_META[project.kind]) ? project.kind : "ops"
  const kind = KIND_META[kindKey]
  const KindIcon = kind.icon
  const isBound = !!project.workspacePath
  const isBrownfield = project.workspaceMode === "brownfield"
  const user = useAuthStore((s) => s.user)
  const canEdit = canEditProject(project, user || null)
  const isReadOnly = !canEdit

  return (
    <Link
      to={`/projects/${project.id}`}
      className={cn(
        "group flex flex-col gap-2 p-4 rounded-xl border bg-card hover:bg-card/80 hover:border-primary/40 transition-colors min-h-[140px]",
        isReadOnly ? "border-border/40 opacity-90" : "border-border/50"
      )}
      title={isReadOnly ? "Read-only — created by another user" : undefined}
    >
      {/* Top row: color dot + name + chevron */}
      <div className="flex items-start gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: project.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{project.name}</h3>
            {isReadOnly && (
              <Lock className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            )}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors ml-auto" />
          </div>
          {project.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{project.description}</p>
          )}
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium",
          kind.tone
        )}>
          <KindIcon className="h-2.5 w-2.5" />
          {kind.label}
        </span>
        {isBound && project.workspaceMode && (
          <span className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium",
            isBrownfield
              ? "text-blue-500 bg-blue-500/10 border-blue-500/20"
              : "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
          )}>
            {isBrownfield ? <FolderGit2 className="h-2.5 w-2.5" /> : <FolderTree className="h-2.5 w-2.5" />}
            {formatWorkspaceMode(project.workspaceMode)}
          </span>
        )}
        {project.repoBranch && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium">
            <GitBranch className="h-2.5 w-2.5" />
            {project.repoBranch}
          </span>
        )}
      </div>

      {/* Workspace path */}
      {project.workspacePath && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 font-mono truncate">
          <Folder className="h-3 w-3 shrink-0" />
          <span className="truncate" title={project.workspacePath}>{shortPath(project.workspacePath)}</span>
        </div>
      )}

      {/* Footer: timestamps */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border/30 text-[10px] text-muted-foreground/70">
        <span>Created {relativeTime(project.createdAt)}</span>
        {project.updatedAt && project.updatedAt !== project.createdAt && (
          <span>Updated {relativeTime(project.updatedAt)}</span>
        )}
      </div>
    </Link>
  )
}

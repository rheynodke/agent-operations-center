import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  Sparkles, FolderGit2, Wrench, FlaskConical,
  Folder, FolderTree, ArrowRight, ArrowLeft, Loader2, Check, AlertTriangle,
  GitBranch, Plus, Info, FolderSearch,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { ProjectKind, ProjectWorkspaceMode, ValidatePathResult } from "@/types"
import { useProjectStore } from "@/stores/useProjectStore"
import { BranchPicker } from "@/components/projects/BranchPicker"
import { DirectoryPicker } from "@/components/projects/DirectoryPicker"
import { formatProjectKind } from "@/lib/projectLabels"

const DEFAULT_GREENFIELD_PARENT = '~/projects'

// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

const KIND_OPTIONS: Array<{
  value: ProjectKind
  label: string
  icon: typeof Sparkles
  blurb: string
  tone: string
}> = [
  { value: 'adlc',     label: 'ADLC',     icon: Sparkles,     tone: 'text-violet-500',  blurb: 'Full pipeline: PM/PA → UX → EM → SWE → QA → Doc' },
  { value: 'codebase', label: 'Codebase', icon: FolderGit2,   tone: 'text-blue-500',    blurb: 'Existing repo, agents work the code as context' },
  { value: 'ops',      label: 'Ops',      icon: Wrench,       tone: 'text-emerald-500', blurb: 'Day-to-day work, no formal pipeline' },
  { value: 'research', label: 'Research', icon: FlaskConical, tone: 'text-amber-500',   blurb: 'One-shot deliverables, single-deliverable focus' },
]

interface ProjectCreateWizardProps {
  open: boolean
  onClose: () => void
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-2 mb-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300",
            i < step ? "bg-primary" : "bg-muted"
          )}
        />
      ))}
    </div>
  )
}

// ── Main wizard ──────────────────────────────────────────────────────────────

export function ProjectCreateWizard({ open, onClose }: ProjectCreateWizardProps) {
  const setProjects = useProjectStore((s) => s.setProjects)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const navigate = useNavigate()

  // ── Wizard state ──
  const [step, setStep] = useState<1 | 2 | 3>(1)

  // Common fields
  const [kind, setKind]   = useState<ProjectKind>('ops')
  const [name, setName]   = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [description, setDescription] = useState('')

  // Source
  const [mode, setMode] = useState<ProjectWorkspaceMode | null>(null) // greenfield | brownfield | null=unbound

  // Greenfield fields
  const [parentPath, setParentPath]     = useState(DEFAULT_GREENFIELD_PARENT)
  const [parentEditing, setParentEditing] = useState(false) // collapsed by default
  const [initGit, setInitGit]           = useState(false)
  const [addRemoteUrl, setAddRemoteUrl] = useState('')

  // Brownfield fields
  const [workspacePath, setWorkspacePath] = useState('')
  const [pathValidation, setPathValidation] = useState<ValidatePathResult | null>(null)
  const [validating, setValidating] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function reset() {
    setStep(1)
    setKind('ops'); setName(''); setColor(COLORS[0]); setDescription('')
    setMode(null)
    setParentPath(DEFAULT_GREENFIELD_PARENT); setParentEditing(false)
    setInitGit(false); setAddRemoteUrl('')
    setWorkspacePath(''); setPathValidation(null); setValidating(false); setBranch(null)
    setSubmitting(false); setSubmitError(null)
  }
  function handleClose() { reset(); onClose() }

  // ── Debounced path validation (brownfield + greenfield parent) ──
  const validateTimer = useRef<number | null>(null)
  useEffect(() => {
    if (mode !== 'brownfield' || !workspacePath.trim()) {
      setPathValidation(null); setValidating(false); return
    }
    if (validateTimer.current) window.clearTimeout(validateTimer.current)
    validateTimer.current = window.setTimeout(async () => {
      setValidating(true)
      try {
        const res = await api.validateProjectPath({ path: workspacePath.trim(), mode: 'brownfield' })
        setPathValidation(res)
        // Pre-select current branch when valid + repo
        if (res.ok && res.repo?.currentBranch) setBranch(res.repo.currentBranch)
      } catch (e) {
        setPathValidation({ ok: false, error: (e as Error).message })
      } finally {
        setValidating(false)
      }
    }, 350)
    return () => { if (validateTimer.current) window.clearTimeout(validateTimer.current) }
  }, [mode, workspacePath])

  // ── Step gating ──
  const canStep1Next = !!name.trim() && !!kind
  const canStep2Next = (() => {
    if (mode === null) return true // unbound — go straight to review
    if (mode === 'greenfield') return !!parentPath.trim()
    if (mode === 'brownfield') {
      if (!workspacePath.trim()) return false
      if (!pathValidation?.ok) return false
      if (pathValidation.repo?.isDirty) return false
      if (pathValidation.repo?.isDetached) return false
      if (pathValidation.repo?.isSubmodule) return false
      if (pathValidation.pathBoundToOtherProject) return false
      // If it's a repo, branch must be selected
      if (pathValidation.repo?.isRepo && !branch) return false
      return true
    }
    return false
  })()

  // ── Submit ──
  async function handleCreate() {
    setSubmitting(true); setSubmitError(null)
    try {
      let project
      if (mode === null) {
        project = (await api.createProject({
          name: name.trim(), color, description: description.trim() || undefined,
        })).project
      } else if (mode === 'greenfield') {
        project = (await api.createProjectV2({
          name: name.trim(), color, description: description.trim() || undefined,
          kind,
          workspaceMode: 'greenfield',
          parentPath: parentPath.trim(),
          initGit: initGit || undefined,
          addRemoteUrl: initGit && addRemoteUrl.trim() ? addRemoteUrl.trim() : undefined,
        })).project
      } else {
        // brownfield
        project = (await api.createProjectV2({
          name: name.trim(), color, description: description.trim() || undefined,
          kind,
          workspaceMode: 'brownfield',
          workspacePath: workspacePath.trim(),
          branch: branch || undefined,
        })).project
      }
      // Refresh list + activate + navigate
      try {
        const fresh = await api.getProjects()
        setProjects(fresh.projects)
      } catch {}
      setActiveProject(project.id)
      handleClose()
      navigate(`/projects/${project.id}`)
    } catch (e) {
      setSubmitError((e as Error).message || 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──
  const stepTitle = step === 1 ? 'Create project' : step === 2 ? 'Workspace source' : 'Review & create'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <StepBar step={step} total={3} />
          <DialogTitle>{stepTitle}</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <Step1
            kind={kind} setKind={setKind}
            name={name} setName={setName}
            color={color} setColor={setColor}
            description={description} setDescription={setDescription}
          />
        )}

        {step === 2 && (
          <Step2
            mode={mode} setMode={setMode}
            parentPath={parentPath} setParentPath={setParentPath}
            parentEditing={parentEditing} setParentEditing={setParentEditing}
            name={name}
            initGit={initGit} setInitGit={setInitGit}
            addRemoteUrl={addRemoteUrl} setAddRemoteUrl={setAddRemoteUrl}
            workspacePath={workspacePath} setWorkspacePath={setWorkspacePath}
            pathValidation={pathValidation}
            validating={validating}
            branch={branch} setBranch={setBranch}
          />
        )}

        {step === 3 && (
          <Step3
            kind={kind} name={name} color={color} description={description}
            mode={mode}
            parentPath={parentPath} initGit={initGit} addRemoteUrl={addRemoteUrl}
            workspacePath={workspacePath} branch={branch}
            pathValidation={pathValidation}
            error={submitError}
          />
        )}

        <DialogFooter className="gap-2 mt-2">
          {step > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} className="h-8 text-xs mr-auto">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleClose} className="h-8 text-xs mr-auto">Cancel</Button>
          )}

          {step < 3 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
              disabled={step === 1 ? !canStep1Next : !canStep2Next}
              className="h-8 text-xs"
            >
              Next <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={submitting}
              className="h-8 text-xs"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              Create project
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Step 1 ───────────────────────────────────────────────────────────────────

function Step1({
  kind, setKind, name, setName, color, setColor, description, setDescription,
}: {
  kind: ProjectKind; setKind: (k: ProjectKind) => void
  name: string; setName: (s: string) => void
  color: string; setColor: (c: string) => void
  description: string; setDescription: (s: string) => void
}) {
  return (
    <div className="space-y-4 py-1">
      <div className="space-y-1.5">
        <Label htmlFor="proj-name">Name <span className="text-destructive">*</span></Label>
        <Input
          id="proj-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Customer onboarding redesign"
          className="h-9 text-sm"
        />
        {name.trim() && (
          <p className="text-[11px] text-muted-foreground">
            Folder name (auto): <code className="font-mono text-foreground/80">{slugify(name)}</code>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Kind <span className="text-destructive">*</span></Label>
        <div className="grid grid-cols-2 gap-2">
          {KIND_OPTIONS.map(({ value, label, icon: Icon, tone, blurb }) => {
            const selected = kind === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => setKind(value)}
                className={cn(
                  "flex items-start gap-2 p-2.5 rounded-lg border text-left transition-colors",
                  selected
                    ? "border-primary/60 bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-muted/30"
                )}
              >
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tone)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-[11px] text-muted-foreground leading-snug">{blurb}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex flex-wrap gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-all",
                color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="proj-desc">Description (optional)</Label>
        <textarea
          id="proj-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What this project is about — visible to agents and team members."
          className="flex w-full rounded-md px-3 py-2 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors resize-none"
        />
      </div>
    </div>
  )
}

// ── Step 2 ───────────────────────────────────────────────────────────────────

function Step2({
  mode, setMode,
  parentPath, setParentPath,
  parentEditing, setParentEditing, name,
  initGit, setInitGit, addRemoteUrl, setAddRemoteUrl,
  workspacePath, setWorkspacePath,
  pathValidation, validating,
  branch, setBranch,
}: {
  mode: ProjectWorkspaceMode | null; setMode: (m: ProjectWorkspaceMode | null) => void
  parentPath: string; setParentPath: (s: string) => void
  parentEditing: boolean; setParentEditing: (b: boolean) => void
  name: string
  initGit: boolean; setInitGit: (b: boolean) => void
  addRemoteUrl: string; setAddRemoteUrl: (s: string) => void
  workspacePath: string; setWorkspacePath: (s: string) => void
  pathValidation: ValidatePathResult | null
  validating: boolean
  branch: string | null; setBranch: (b: string) => void
}) {
  const [parentPickerOpen, setParentPickerOpen] = useState(false)
  const [bfPickerOpen, setBfPickerOpen]         = useState(false)
  const slug = name ? slugify(name) : ''

  return (
    <div className="space-y-3 py-1">
      <p className="text-xs text-muted-foreground">
        Bind this project to a folder on disk. Agents working on this project will run there
        and save deliverables inside it. You can also skip and bind later.
      </p>

      {/* Source picker */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <SourceCard
          icon={FolderTree}
          label="New project"
          blurb="AOC creates a fresh folder."
          selected={mode === 'greenfield'}
          onSelect={() => setMode('greenfield')}
          tone="text-emerald-500"
        />
        <SourceCard
          icon={FolderGit2}
          label="Existing project"
          blurb="Bind to a folder that already exists (with or without git)."
          selected={mode === 'brownfield'}
          onSelect={() => setMode('brownfield')}
          tone="text-blue-500"
        />
        <SourceCard
          icon={Folder}
          label="Skip"
          blurb="No workspace. Bind later from Settings."
          selected={mode === null}
          onSelect={() => setMode(null)}
          tone="text-muted-foreground"
        />
      </div>

      {mode === 'greenfield' && (
        <div className="space-y-3 pt-1 border-t border-border/40">
          {/* Collapsed view: shows default location + slug; "Change" reveals picker. */}
          {!parentEditing ? (
            <div className="flex items-start justify-between gap-2 p-2.5 rounded-md border border-border/40 bg-muted/30">
              <div className="min-w-0">
                <Label className="text-[11px] text-muted-foreground/80">Will create at</Label>
                <p className="font-mono text-xs text-foreground/90 truncate" title={`${parentPath.replace(/\/+$/,'')}/${slug || '<name>'}`}>
                  {parentPath.replace(/\/+$/,'')}/<span className="text-primary">{slug || '<name>'}</span>
                </p>
              </div>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs shrink-0"
                onClick={() => setParentEditing(true)}
              >
                Change location
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="parent-path">Parent directory</Label>
              <div className="flex gap-2">
                <Input
                  id="parent-path"
                  value={parentPath}
                  onChange={(e) => setParentPath(e.target.value)}
                  placeholder="~/projects"
                  className="h-9 font-mono text-xs flex-1"
                />
                <Button
                  size="sm" variant="outline" className="h-9 text-xs shrink-0"
                  onClick={() => setParentPickerOpen(true)}
                >
                  <FolderSearch className="h-3.5 w-3.5 mr-1" /> Browse
                </Button>
                <Button
                  size="sm" variant="ghost" className="h-9 text-xs shrink-0"
                  onClick={() => { setParentPath(DEFAULT_GREENFIELD_PARENT); setParentEditing(false) }}
                  title="Reset to default"
                >
                  Reset
                </Button>
              </div>
              {slug && (
                <p className="text-[11px] text-muted-foreground">
                  Folder: <code className="font-mono text-foreground/80">{parentPath.replace(/\/+$/,'')}/{slug}</code>
                </p>
              )}
            </div>
          )}

          <div className="flex items-start gap-2 p-2.5 rounded-md border border-border/40 bg-muted/30">
            <input
              id="init-git"
              type="checkbox"
              checked={initGit}
              onChange={(e) => setInitGit(e.target.checked)}
              className="mt-0.5"
            />
            <div className="flex-1">
              <label htmlFor="init-git" className="text-sm font-medium cursor-pointer">
                Initialize git repository
              </label>
              <p className="text-[11px] text-muted-foreground">
                Run <code className="font-mono">git init -b main</code> in the new folder.
              </p>
              {initGit && (
                <Input
                  value={addRemoteUrl}
                  onChange={(e) => setAddRemoteUrl(e.target.value)}
                  placeholder="git@github.com:org/repo.git (optional remote)"
                  className="mt-2 h-8 font-mono text-[11px]"
                />
              )}
            </div>
          </div>

          <DirectoryPicker
            open={parentPickerOpen}
            onClose={() => setParentPickerOpen(false)}
            onPick={(absPath, displayPath) => { setParentPath(displayPath || absPath) }}
            initialPath={parentPath || '~/projects'}
            title="Pick parent directory"
            allowPickCwd
          />
        </div>
      )}

      {mode === 'brownfield' && (
        <div className="space-y-3 pt-1 border-t border-border/40">
          <div className="space-y-1.5">
            <Label htmlFor="ws-path">Folder path <span className="text-destructive">*</span></Label>
            <div className="flex gap-2">
              <Input
                id="ws-path"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                placeholder="~/repos/my-project"
                className="h-9 font-mono text-xs flex-1"
              />
              <Button
                size="sm" variant="outline" className="h-9 text-xs shrink-0"
                onClick={() => setBfPickerOpen(true)}
              >
                <FolderSearch className="h-3.5 w-3.5 mr-1" /> Browse
              </Button>
            </div>
            <PathValidationStatus validation={pathValidation} validating={validating} />
          </div>

          {pathValidation?.ok && pathValidation.repo?.isRepo && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2 text-xs">
                <GitBranch className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-muted-foreground">Git repo detected</span>
                {pathValidation.repo.remotes?.[0] && (
                  <span className="text-[11px] text-muted-foreground/70 font-mono truncate">
                    · {pathValidation.repo.remotes[0].url}
                  </span>
                )}
              </div>
              <BranchPicker
                path={pathValidation.resolvedPath || workspacePath}
                value={branch}
                onChange={setBranch}
                autoFetch
              />
            </div>
          )}

          <DirectoryPicker
            open={bfPickerOpen}
            onClose={() => setBfPickerOpen(false)}
            onPick={(absPath, displayPath) => { setWorkspacePath(displayPath || absPath) }}
            initialPath={workspacePath || '~'}
            title="Pick existing folder"
            allowPickCwd
          />
        </div>
      )}

      {mode === null && (
        <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground flex gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            Project will be created without a workspace. Tasks will run in each agent's own
            workspace. You can bind a folder later from the project's Settings tab.
          </p>
        </div>
      )}
    </div>
  )
}

function SourceCard({
  icon: Icon, label, blurb, selected, onSelect, tone,
}: {
  icon: typeof Folder; label: string; blurb: string
  selected: boolean; onSelect: () => void; tone: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-1 p-2.5 rounded-lg border text-left transition-colors",
        selected
          ? "border-primary/60 bg-primary/5"
          : "border-border hover:border-border/80 hover:bg-muted/30"
      )}
    >
      <Icon className={cn("h-4 w-4", tone)} />
      <div className="text-sm font-medium">{label}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{blurb}</div>
    </button>
  )
}

function PathValidationStatus({ validation, validating }: { validation: ValidatePathResult | null; validating: boolean }) {
  if (validating) return (
    <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Checking path…
    </p>
  )
  if (!validation) return null
  if (!validation.ok) {
    return (
      <p className="text-[11px] text-destructive inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {validation.error || validation.reason || 'Invalid path'}
      </p>
    )
  }
  if (validation.pathBoundToOtherProject) {
    return (
      <p className="text-[11px] text-amber-500 inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Path already bound to project <span className="font-medium">{validation.pathBoundToOtherProject.name}</span>
      </p>
    )
  }
  if (validation.repo?.isSubmodule) {
    return (
      <p className="text-[11px] text-amber-500 inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Path is a git submodule — choose the superproject root instead.
      </p>
    )
  }
  if (validation.repo?.isDetached) {
    return (
      <p className="text-[11px] text-amber-500 inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Repo is in detached HEAD state — checkout a branch first.
      </p>
    )
  }
  if (validation.repo?.isDirty) {
    return (
      <p className="text-[11px] text-amber-500 inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Working tree has uncommitted changes ({validation.repo.uncommittedFiles?.length || '?'} files) — commit or stash first.
      </p>
    )
  }
  return (
    <p className="text-[11px] text-emerald-500 inline-flex items-center gap-1">
      <Check className="h-3 w-3" /> Path is valid{validation.repo?.isRepo ? ' (git repo)' : ''}.
    </p>
  )
}

// ── Step 3 ───────────────────────────────────────────────────────────────────

function Step3({
  kind, name, color, description,
  mode,
  parentPath, initGit, addRemoteUrl,
  workspacePath, branch, pathValidation,
  error,
}: {
  kind: ProjectKind; name: string; color: string; description: string
  mode: ProjectWorkspaceMode | null
  parentPath: string; initGit: boolean; addRemoteUrl: string
  workspacePath: string; branch: string | null
  pathValidation: ValidatePathResult | null
  error: string | null
}) {
  const targetPath = useMemo(() => {
    if (mode === 'greenfield' && parentPath && name) return `${parentPath.replace(/\/+$/,'')}/${slugify(name)}`
    if (mode === 'brownfield') return pathValidation?.resolvedPath || workspacePath
    return null
  }, [mode, parentPath, name, workspacePath, pathValidation])

  return (
    <div className="space-y-3 py-1">
      <div className="rounded-lg border border-border/50 p-3 bg-card">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <span className="font-medium">{name}</span>
          <span className="px-1.5 py-0.5 rounded-md bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
            {formatProjectKind(kind)}
          </span>
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>

      <div className="rounded-lg border border-border/50 p-3 bg-card space-y-2">
        <h4 className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Workspace</h4>
        {mode === null && (
          <p className="text-xs text-muted-foreground italic">No workspace bound. You can bind a folder later.</p>
        )}
        {mode === 'greenfield' && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Field label="Type" value="New project" />
            <Field label="Will create" value={targetPath || '—'} mono />
            <Field label="Init git" value={initGit ? 'Yes' : 'No'} />
            {initGit && addRemoteUrl && <Field label="Remote" value={addRemoteUrl} mono />}
          </dl>
        )}
        {mode === 'brownfield' && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <Field label="Type" value="Existing project" />
            <Field label="Path" value={targetPath || '—'} mono />
            {pathValidation?.repo?.isRepo
              ? <Field label="Branch" value={branch || pathValidation.repo.currentBranch || '—'} mono />
              : <Field label="Git" value="Not a repo (binds folder only)" />}
            {pathValidation?.repo?.remotes?.[0] && (
              <Field label="Remote" value={pathValidation.repo.remotes[0].url} mono />
            )}
          </dl>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** snake_case folder slug — lowercase, ASCII alphanum + underscore, no leading/trailing _. */
function slugify(s: string): string {
  return s.trim().toLowerCase()
    // Replace any run of non-allowed chars (including spaces, dashes, dots) with _
    .replace(/[^a-z0-9_]+/g, '_')
    // Collapse repeated underscores
    .replace(/_{2,}/g, '_')
    // Trim leading/trailing underscores
    .replace(/^_+|_+$/g, '')
    || 'project'
}

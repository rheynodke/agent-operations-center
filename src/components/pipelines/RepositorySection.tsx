// Repository config for a playbook — drives per-mission git worktree creation.
//
// When a playbook has a repo path set, every mission spawned from it will get
// a fresh worktree at ~/.openclaw/missions/{run_id}/worktree/ from the base
// branch (default: HEAD). Agents dispatched for that mission see the worktree
// as their working directory and can read/edit real project files.

import { useState } from "react"
import { GitBranch, Github, ChevronDown, ChevronRight, Folder, FolderGit, FolderSearch, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { FolderPicker } from "./FolderPicker"

export interface RepoConfigState {
  path: string
  url: string
  baseBranch: string
  autoBranch: boolean
}

interface RepositorySectionProps {
  value: RepoConfigState
  onChange: (next: RepoConfigState) => void
  readOnly?: boolean
}

export function RepositorySection({ value, onChange, readOnly }: RepositorySectionProps) {
  const [open, setOpen] = useState(!!value.path)
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <div className="max-w-2xl mx-auto pt-6 px-4">
      <div className="border border-border rounded-md bg-card overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Repository</span>
          {value.path ? (
            <span className="text-[11px] text-muted-foreground font-mono ml-auto truncate max-w-xs">
              {value.path}
              {value.baseBranch && <span className="text-muted-foreground/60"> · {value.baseBranch}</span>}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground italic ml-auto">optional — agents work without codebase context if empty</span>
          )}
        </button>

        {open && (
          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/60">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                Local repo path
              </label>
              {value.path ? (
                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-background">
                  <FolderGit className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-mono truncate flex-1">{value.path}</span>
                  {!readOnly && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => onChange({ ...value, path: "" })}
                        className="p-1 text-muted-foreground hover:text-red-400"
                        title="Clear"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={readOnly}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-dashed border-border bg-background text-sm text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors disabled:opacity-50"
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                  <span>Pick folder…</span>
                  <span className="ml-auto text-[10px]">or create new repo</span>
                </button>
              )}
              <div className="text-[10px] text-muted-foreground mt-1">
                Each mission will provision its own worktree from this repo so agents get codebase context.
              </div>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                Repo URL <span className="text-muted-foreground/60">(optional — display only)</span>
              </label>
              <div className="relative">
                <Github className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={value.url}
                  onChange={(e) => onChange({ ...value, url: e.target.value })}
                  disabled={readOnly}
                  placeholder="https://github.com/org/repo"
                  className="w-full pl-7 pr-2 py-1.5 rounded-md border border-border bg-background text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  Base branch
                </label>
                <input
                  type="text"
                  value={value.baseBranch}
                  onChange={(e) => onChange({ ...value, baseBranch: e.target.value })}
                  disabled={readOnly}
                  placeholder="main"
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm font-mono"
                />
                <div className="text-[10px] text-muted-foreground mt-1">
                  Worktree created from this branch. Empty = current HEAD.
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  Branch strategy
                </label>
                <label className={cn("flex items-center gap-2 text-xs py-1.5", readOnly && "opacity-60")}>
                  <input
                    type="checkbox"
                    checked={value.autoBranch}
                    onChange={(e) => onChange({ ...value, autoBranch: e.target.checked })}
                    disabled={readOnly}
                  />
                  Auto-create <span className="font-mono text-muted-foreground">mission/{"{MIS-xxx}"}</span>
                </label>
                <div className="text-[10px] text-muted-foreground">
                  Off = worktree stays on base branch (risk of conflicts).
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {pickerOpen && (
        <FolderPicker
          initialPath={value.path || undefined}
          onClose={() => setPickerOpen(false)}
          onPick={(picked) => {
            onChange({ ...value, path: picked })
            setPickerOpen(false)
          }}
        />
      )}
    </div>
  )
}

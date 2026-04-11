// src/components/board/ProjectSwitcher.tsx
import React, { useState } from "react"
import { ChevronDown, Plus, Trash2, Settings2 } from "lucide-react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { useProjectStore } from "@/stores/useProjectStore"

interface ProjectSwitcherProps {
  onSettingsOpen: () => void
  onNewProject: () => void
}

export function ProjectSwitcher({ onSettingsOpen, onNewProject }: ProjectSwitcherProps) {
  const { projects, activeProjectId, setActiveProject, deleteProject } = useProjectStore()
  const active = projects.find(p => p.id === activeProjectId) ?? { id: 'general', name: 'General', color: '#6366f1' }
  const [confirmProject, setConfirmProject] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleConfirmDelete = async () => {
    if (!confirmProject) return
    setDeleting(true)
    try {
      await deleteProject(confirmProject.id)
      if (activeProjectId === confirmProject.id) setActiveProject('general')
    } finally {
      setDeleting(false)
      setConfirmProject(null)
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 h-8 px-3 rounded-md border border-border/50 bg-card hover:bg-muted/50 transition-colors text-sm font-medium">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: active.color }} />
              <span className="max-w-[140px] truncate">{active.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-0.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {projects.map(p => (
              <DropdownMenuItem
                key={p.id}
                onClick={() => setActiveProject(p.id)}
                className="gap-2 pr-1"
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="truncate flex-1">{p.name}</span>
                {p.id === activeProjectId && <span className="text-xs text-muted-foreground mr-1">✓</span>}
                {p.id !== 'general' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmProject({ id: p.id, name: p.name }) }}
                    className="ml-auto h-5 w-5 flex items-center justify-center rounded shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete project"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onNewProject} className="gap-2 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              New Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={onSettingsOpen}
          className="h-8 w-8 flex items-center justify-center rounded-md border border-border/50 bg-card hover:bg-muted/50 transition-colors text-muted-foreground"
          title="Project settings"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {confirmProject && (
        <ConfirmDialog
          title="Delete Project"
          description={`"${confirmProject.name}" and all its data will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          loading={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmProject(null)}
        />
      )}
    </>
  )
}

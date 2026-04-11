// src/components/board/ProjectSettingsPanel.tsx
import React, { useEffect, useState } from "react"
import { X, Trash2, RefreshCw, Plus, AlertCircle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useProjectStore } from "@/stores/useProjectStore"
import { ProjectIntegration } from "@/types"

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16']

interface ProjectSettingsPanelProps {
  open: boolean
  onClose: () => void
  onAddIntegration: () => void
  onEditIntegration: (integration: ProjectIntegration) => void
}

function IntegrationCard({
  integration,
  onEdit,
  onDelete,
  onSync,
  syncing,
}: {
  integration: ProjectIntegration
  onEdit: () => void
  onDelete: () => void
  onSync: () => void
  syncing: boolean
}) {
  const intervalLabel = integration.syncIntervalMs
    ? integration.syncIntervalMs < 60_000
      ? `${integration.syncIntervalMs / 1000}s`
      : `${integration.syncIntervalMs / 60_000}m`
    : 'Manual'

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 flex-shrink-0 text-emerald-400">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        </div>
        <span className="text-sm font-medium flex-1">
          {integration.config?.sheetName || 'Google Sheets'}
        </span>
        <span className={cn("text-xs", integration.enabled ? "text-emerald-400" : "text-muted-foreground")}>
          {integration.enabled ? '● Active' : '○ Disabled'}
        </span>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {integration.lastSyncError ? (
          <span className="flex items-center gap-1 text-red-400 truncate">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            {integration.lastSyncError.slice(0, 60)}
          </span>
        ) : integration.lastSyncedAt ? (
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            Synced {new Date(integration.lastSyncedAt).toLocaleTimeString()}
          </span>
        ) : (
          <span>Never synced</span>
        )}
        <span className="ml-auto flex-shrink-0">{intervalLabel}</span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onSync} disabled={syncing}>
          <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 hover:text-red-300 ml-auto" onClick={onDelete}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

export function ProjectSettingsPanel({ open, onClose, onAddIntegration, onEditIntegration }: ProjectSettingsPanelProps) {
  const {
    projects, activeProjectId, integrations, syncingIds,
    updateProject, deleteProject, fetchIntegrations, deleteIntegration, syncNow,
  } = useProjectStore()

  const project = projects.find(p => p.id === activeProjectId)
  const [tab, setTab] = useState<'general' | 'integrations'>('general')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (project) { setName(project.name); setColor(project.color) }
  }, [project?.id])

  useEffect(() => {
    if (open && activeProjectId) fetchIntegrations(activeProjectId)
  }, [open, activeProjectId])

  if (!open || !project) return null

  async function handleSave() {
    setSaving(true)
    try { await updateProject(activeProjectId, { name, color }) } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm(`Delete project "${project?.name}"? Tasks will not be deleted.`)) return
    await deleteProject(activeProjectId)
    onClose()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-card border-l border-border shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">Project Settings</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5">
          {(['general', 'integrations'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "text-xs font-medium py-2.5 mr-4 border-b-2 capitalize transition-colors",
                tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'general' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Project Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Color</Label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className={cn("w-7 h-7 rounded-full border-2 transition-all", color === c ? "border-foreground scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <Button size="sm" className="h-8" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
              {activeProjectId !== 'general' && (
                <div className="pt-4 border-t border-border">
                  <Button size="sm" variant="outline" className="h-8 text-red-400 hover:text-red-300 border-red-500/30" onClick={handleDelete}>
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Delete Project
                  </Button>
                </div>
              )}
            </>
          )}

          {tab === 'integrations' && (
            <>
              {integrations.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">No integrations configured yet.</p>
              )}
              {integrations.map(integration => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  syncing={syncingIds.has(integration.id)}
                  onEdit={() => onEditIntegration(integration)}
                  onDelete={() => deleteIntegration(activeProjectId, integration.id)}
                  onSync={() => syncNow(activeProjectId, integration.id)}
                />
              ))}
              <Button size="sm" variant="outline" className="h-8 w-full gap-1.5 text-xs" onClick={onAddIntegration}>
                <Plus className="h-3.5 w-3.5" />
                Add Integration
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

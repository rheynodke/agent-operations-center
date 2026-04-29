import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { usePipelineStore } from "@/stores/usePipelineStore"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Workflow, Plus, Trash2, AlertCircle, Loader2 } from "lucide-react"
import { PIPELINE_TEMPLATES, getPipelineTemplate } from "@/data/pipeline-templates"

function fmtRelative(ts?: string): string {
  if (!ts) return "—"
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function PlaybooksGalleryPage() {
  const nav = useNavigate()
  const { pipelines, loading, error, fetchList, createPipeline, deletePipeline } = usePipelineStore()
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [templateId, setTemplateId] = useState<string>("blank")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setSubmitting(true)
    try {
      const tpl = getPipelineTemplate(templateId)
      const p = await createPipeline({
        name: newName.trim(),
        description: newDesc.trim() || (tpl && tpl.id !== "blank" ? tpl.description : undefined),
        // Pass the template's graph so server seeds the pipeline with it.
        ...(tpl && tpl.id !== "blank" ? { graph: tpl.graph } : {}),
      } as Parameters<typeof createPipeline>[0])
      setCreateOpen(false)
      setNewName("")
      setNewDesc("")
      setTemplateId("blank")
      nav(`/missions/playbooks/${p.id}`)
    } catch (err) {
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await deletePipeline(deleteTarget)
      setDeleteTarget(null)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Workflow className="h-6 w-6 text-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Playbooks</h1>
            <p className="text-xs text-muted-foreground">
              Reusable multi-agent recipes — each template orchestrates an ADLC flow
            </p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> New Playbook
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && pipelines.length === 0 && (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading playbooks…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {!loading && pipelines.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-20">
            <Workflow className="h-12 w-12 opacity-30 mb-3" />
            <div className="text-base font-medium mb-1">No playbooks yet</div>
            <div className="text-sm mb-4 max-w-md">
              Playbooks are reusable multi-agent recipes. Create one to orchestrate
              ADLC flows (PM → UX → EM → SWE → QA → Doc) that runs can spawn from.
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create Playbook
            </Button>
          </div>
        )}
        {pipelines.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {pipelines.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "group rounded-lg border border-border bg-card p-4 cursor-pointer",
                  "hover:border-primary/60 transition-colors",
                )}
                onClick={() => nav(`/missions/playbooks/${p.id}`)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Workflow className="h-4 w-4 text-primary shrink-0" />
                    <div className="font-semibold truncate">{p.name}</div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(p.id)
                    }}
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {p.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</div>
                )}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {p.graph?.nodes?.length ?? 0} nodes · {p.graph?.edges?.length ?? 0} edges
                  </span>
                  <span>{fmtRelative(p.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Playbook</DialogTitle>
            <DialogDescription>
              Start from a template or blank canvas. Templates use your agents' ADLC roles automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Template picker */}
            <div>
              <label className="text-xs font-medium mb-2 block">Start from</label>
              <div className="grid grid-cols-2 gap-2">
                {PIPELINE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "text-left p-3 rounded-md border transition-colors",
                      templateId === t.id
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card hover:border-primary/50",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{t.emoji}</span>
                      <span className="text-sm font-semibold">{t.name}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2">{t.description}</div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      {t.graph.nodes.length} nodes · {t.graph.edges.length} edges
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium mb-1 block">Name</label>
              <input
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. ADLC Linear Flow"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Description (optional)</label>
              <textarea
                className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm resize-none"
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What does this pipeline do?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete playbook?</DialogTitle>
            <DialogDescription>
              This also deletes all run history and artifacts for this pipeline. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

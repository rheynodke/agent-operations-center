import { useEffect, useState } from "react"
import {
  X, Loader2, Play, ChevronLeft, AlertCircle, CheckCircle2,
  FileText, Sparkles, Wrench, ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import type {
  RoleTemplateRecord, ApplyPreview, AgentFileAction, ApplyResult,
} from "@/types"

interface Props {
  template: RoleTemplateRecord
  onClose: () => void
  onApplied?: (r: ApplyResult) => void
}

type Step = "pick-agent" | "preview" | "applying" | "done"

type FileKey = "identity" | "soul" | "tools" | "agents"
const FILE_KEYS: FileKey[] = ["identity", "soul", "tools", "agents"]

// ─── UI helpers ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: AgentFileAction }) {
  const cfg = {
    noop:      { label: "—",         cls: "bg-muted/20 text-muted-foreground/60 border-muted/30" },
    keep:      { label: "keep",      cls: "bg-muted/20 text-muted-foreground/70 border-muted/30" },
    same:      { label: "same",      cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
    create:    { label: "create",    cls: "bg-sky-500/10 text-sky-400 border-sky-500/25" },
    overwrite: { label: "overwrite", cls: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
  }[action]
  return <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", cfg.cls)}>{cfg.label}</span>
}

// ─── Main modal ──────────────────────────────────────────────────────────────

export function ApplyToAgentModal({ template, onClose, onApplied }: Props) {
  const agents = useAgentStore(s => s.agents)
  const [step, setStep] = useState<Step>("pick-agent")
  const [agentId, setAgentId] = useState<string>("")
  const [preview, setPreview] = useState<ApplyPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-file selection (checkboxes)
  const [selected, setSelected] = useState<Record<FileKey, boolean>>({
    identity: false, soul: false, tools: false, agents: false,
  })
  const [installSkills, setInstallSkills] = useState(true)
  const [installScripts, setInstallScripts] = useState(true)
  const [overwriteConflictingScripts, setOverwriteConflictingScripts] = useState(false)

  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [applying, setApplying] = useState(false)

  async function doPreview(aid: string) {
    setStep("preview"); setAgentId(aid)
    setPreviewLoading(true); setError(null); setPreview(null)
    try {
      const r = await api.previewRoleTemplateApply(template.id, aid)
      setPreview(r.preview)
      // Default: pre-check `create` and `overwrite` actions, skip `same`/`keep`/`noop`
      const next: Record<FileKey, boolean> = { identity: false, soul: false, tools: false, agents: false }
      for (const k of FILE_KEYS) {
        const a = r.preview.files[k]?.action
        next[k] = a === "create" || a === "overwrite"
      }
      setSelected(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function doApply() {
    if (!preview) return
    setApplying(true); setStep("applying"); setError(null)
    try {
      const overwriteFiles = FILE_KEYS.filter(k => selected[k])
      const result = await api.applyRoleTemplateToAgent(agentId, {
        templateId: template.id,
        overwriteFiles,
        installSkills,
        installScripts,
        overwriteConflictingScripts,
      })
      setApplyResult(result)
      setStep("done")
      onApplied?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep("preview")
    } finally {
      setApplying(false)
    }
  }

  // Count summary
  const selectedCount = Object.values(selected).filter(Boolean).length
  const skillsChangeCount = preview
    ? preview.skills.toAdd.length + preview.skills.toInstall.length
    : 0
  const scriptsChangeCount = preview
    ? preview.scripts.toInstall.length +
      (overwriteConflictingScripts ? preview.scripts.conflicting.length : 0)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!applying ? onClose : undefined} />
      <div className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
              style={{ backgroundColor: (template.color || "#6366f1") + "20", border: `1px solid ${(template.color || "#6366f1")}55` }}
            >
              {template.emoji || "🧩"}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Apply role template</h2>
              <p className="text-[11px] text-muted-foreground">
                <span className="font-mono">{template.id}</span> — {template.role}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === "pick-agent" && (
            <AgentPicker
              agents={agents}
              selectedTemplateId={template.id}
              onPick={doPreview}
            />
          )}

          {(step === "preview" || step === "applying") && (
            <>
              {previewLoading && (
                <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Computing diff…
                </div>
              )}
              {error && !previewLoading && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive mb-3 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {preview && !previewLoading && (
                <div className="flex flex-col gap-4">
                  {/* Target agent banner */}
                  <div className="rounded-xl border border-border bg-surface-high px-4 py-3 flex items-center gap-3">
                    <span className="text-[11px] text-muted-foreground">Target agent</span>
                    <span className="text-sm font-semibold text-foreground">{preview.agent.name}</span>
                    <code className="text-[10px] text-muted-foreground/60 font-mono">{preview.agent.id}</code>
                    <div className="flex-1" />
                    <code className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[220px]">
                      {preview.agent.workspace.replace(/^\/Users\/[^/]+/, "~")}
                    </code>
                  </div>

                  {/* Agent files checklist */}
                  <section>
                    <header className="flex items-center gap-1.5 mb-2">
                      <FileText className="w-3 h-3 text-muted-foreground" />
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Agent files ({selectedCount} selected)
                      </h3>
                    </header>
                    <div className="rounded-xl border border-border divide-y divide-border">
                      {FILE_KEYS.map(k => {
                        const file = preview.files[k]
                        const canSelect = file.action === "create" || file.action === "overwrite"
                        return (
                          <label
                            key={k}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2.5",
                              canSelect ? "cursor-pointer hover:bg-foreground/3" : "opacity-60 cursor-not-allowed",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected[k]}
                              onChange={e => canSelect && setSelected(s => ({ ...s, [k]: e.target.checked }))}
                              disabled={!canSelect}
                              className="w-3.5 h-3.5 accent-primary shrink-0"
                            />
                            <code className="text-[12px] font-mono text-foreground/90 min-w-[90px]">{file.filename}</code>
                            <ActionBadge action={file.action} />
                            <div className="flex-1 min-w-0" />
                            <span className="text-[10px] text-muted-foreground/60 font-mono">
                              {file.currentLines}L <ArrowRight className="w-2.5 h-2.5 inline opacity-40" /> {file.templateLines}L
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    {Object.values(selected).some(Boolean) && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                        Previous file contents are snapshotted to version history before overwrite.
                      </p>
                    )}
                  </section>

                  {/* Skills */}
                  <section>
                    <header className="flex items-center gap-1.5 mb-2">
                      <Sparkles className="w-3 h-3 text-muted-foreground" />
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Skills
                      </h3>
                    </header>
                    <div className="rounded-xl border border-border p-3 flex flex-col gap-2">
                      <SkillRow label="Already in agent allowlist" items={preview.skills.existing} tone="muted" />
                      <SkillRow label="Will be added to allowlist" items={preview.skills.toAdd} tone="sky" />
                      <SkillRow label="Will be installed globally + added" items={preview.skills.toInstall} tone="emerald" />
                      {preview.skills.missing.length > 0 && (
                        <SkillRow label="Missing (skipped — not installed, not bundled)" items={preview.skills.missing} tone="amber" />
                      )}
                      {skillsChangeCount > 0 && (
                        <label className="flex items-center gap-2 mt-1 pt-2 border-t border-border cursor-pointer">
                          <input
                            type="checkbox"
                            checked={installSkills}
                            onChange={e => setInstallSkills(e.target.checked)}
                            className="w-3.5 h-3.5 accent-primary"
                          />
                          <span className="text-[12px] text-foreground/90">
                            Install bundled skills and update allowlist ({skillsChangeCount} change{skillsChangeCount === 1 ? "" : "s"})
                          </span>
                        </label>
                      )}
                    </div>
                  </section>

                  {/* Scripts */}
                  <section>
                    <header className="flex items-center gap-1.5 mb-2">
                      <Wrench className="w-3 h-3 text-muted-foreground" />
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Scripts
                      </h3>
                    </header>
                    <div className="rounded-xl border border-border p-3 flex flex-col gap-2">
                      <SkillRow label="Already present (identical)" items={preview.scripts.same} tone="muted" />
                      <SkillRow label="Will be installed" items={preview.scripts.toInstall} tone="sky" />
                      <SkillRow label="Conflicting (different content on disk)" items={preview.scripts.conflicting} tone="amber" />
                      {(preview.scripts.toInstall.length > 0 || preview.scripts.conflicting.length > 0) && (
                        <div className="flex flex-col gap-1.5 mt-1 pt-2 border-t border-border">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={installScripts}
                              onChange={e => setInstallScripts(e.target.checked)}
                              className="w-3.5 h-3.5 accent-primary"
                            />
                            <span className="text-[12px] text-foreground/90">
                              Install new scripts ({preview.scripts.toInstall.length})
                            </span>
                          </label>
                          {preview.scripts.conflicting.length > 0 && (
                            <label className="flex items-center gap-2 cursor-pointer pl-5">
                              <input
                                type="checkbox"
                                checked={overwriteConflictingScripts}
                                onChange={e => setOverwriteConflictingScripts(e.target.checked)}
                                disabled={!installScripts}
                                className="w-3.5 h-3.5 accent-amber-400 disabled:opacity-40"
                              />
                              <span className={cn("text-[12px]", installScripts ? "text-amber-300/90" : "text-muted-foreground/40")}>
                                Overwrite {preview.scripts.conflicting.length} conflicting script{preview.scripts.conflicting.length === 1 ? "" : "s"} (snapshot first)
                              </span>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Summary */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                    <p className="text-[11px] text-foreground/90">
                      <strong>{selectedCount}</strong> agent file{selectedCount === 1 ? "" : "s"},{" "}
                      <strong>{installSkills ? skillsChangeCount : 0}</strong> skill change{skillsChangeCount === 1 ? "" : "s"},{" "}
                      <strong>{installScripts ? (preview.scripts.toInstall.length + (overwriteConflictingScripts ? preview.scripts.conflicting.length : 0)) : 0}</strong> script write{scriptsChangeCount === 1 ? "" : "s"}
                      {" "} — will update <code className="font-mono">{preview.agent.id}</code>'s role to <code className="font-mono">{template.id}</code>.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {step === "done" && applyResult && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-4 flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Role "{template.role}" applied to {applyResult.agentId}
                  </p>
                  <div className="text-[11px] text-muted-foreground mt-2 flex flex-col gap-1">
                    {applyResult.applied.files.length > 0 && (
                      <span>• Wrote {applyResult.applied.files.length} file{applyResult.applied.files.length === 1 ? "" : "s"}: <code className="font-mono">{applyResult.applied.files.join(", ")}</code></span>
                    )}
                    {applyResult.applied.skillsInstalledGlobal.length > 0 && (
                      <span>• Installed globally: <code className="font-mono">{applyResult.applied.skillsInstalledGlobal.join(", ")}</code></span>
                    )}
                    {applyResult.applied.skillsAddedToAllowlist.length > 0 && (
                      <span>• Added to allowlist: <code className="font-mono">{applyResult.applied.skillsAddedToAllowlist.join(", ")}</code></span>
                    )}
                    {applyResult.applied.scriptsWritten.length > 0 && (
                      <span>• Wrote scripts: <code className="font-mono">{applyResult.applied.scriptsWritten.join(", ")}</code></span>
                    )}
                    {applyResult.applied.scriptsSkipped.length > 0 && (
                      <span className="text-muted-foreground/60">• Skipped scripts: <code className="font-mono">{applyResult.applied.scriptsSkipped.join(", ")}</code></span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-border flex items-center justify-between gap-2 bg-surface-high/30">
          {step === "preview" && !applying ? (
            <button
              type="button"
              onClick={() => { setStep("pick-agent"); setPreview(null); setError(null) }}
              className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Pick different agent
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 disabled:opacity-40 transition-colors"
            >
              {step === "done" ? "Close" : "Cancel"}
            </button>
            {(step === "preview" || step === "applying") && (
              <button
                type="button"
                onClick={doApply}
                disabled={applying || previewLoading || !preview || selectedCount + skillsChangeCount + scriptsChangeCount === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors"
              >
                {applying ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</> : <><Play className="w-3.5 h-3.5" /> Apply</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AgentPicker({
  agents, selectedTemplateId, onPick,
}: { agents: Array<{ id: string; name?: string; emoji?: string }>; selectedTemplateId: string; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  if (agents.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground/60">
        <p className="text-sm">No agents available.</p>
        <p className="text-[11px] mt-1">Provision an agent first.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground px-1 mb-1">
        Pick an agent to apply <code className="font-mono">{selectedTemplateId}</code> to:
      </p>
      <div className="grid grid-cols-2 gap-2">
        {agents.map(a => (
          <button
            key={a.id}
            onClick={() => onPick(a.id)}
            onMouseEnter={() => setHover(a.id)}
            onMouseLeave={() => setHover(null)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all",
              hover === a.id
                ? "border-primary/40 bg-primary/8"
                : "border-border bg-card hover:bg-foreground/3",
            )}
          >
            <span className="text-lg">{a.emoji || "🤖"}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground truncate">{a.name || a.id}</p>
              <code className="text-[10px] text-muted-foreground/60 font-mono truncate block">{a.id}</code>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40" />
          </button>
        ))}
      </div>
    </div>
  )
}

function SkillRow({
  label, items, tone,
}: { label: string; items: string[]; tone: "muted" | "sky" | "emerald" | "amber" }) {
  if (items.length === 0) return null
  const cls = {
    muted:   "text-muted-foreground/60",
    sky:     "text-sky-400",
    emerald: "text-emerald-400",
    amber:   "text-amber-400",
  }[tone]
  return (
    <div>
      <p className={cn("text-[10px] font-semibold uppercase tracking-wider mb-1", cls)}>{label} ({items.length})</p>
      <div className="flex flex-wrap gap-1">
        {items.map(i => (
          <code key={i} className="text-[10px] font-mono bg-muted/20 text-muted-foreground px-1.5 py-0.5 rounded border border-border">
            {i}
          </code>
        ))}
      </div>
    </div>
  )
}

import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, AlertCircle, Loader2, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useProjectStore } from "@/stores/useProjectStore"
import { IntegrationColumnMapping } from "@/types"
import { CredentialGuide } from "@/components/board/CredentialGuide"

// ── Constants ──────────────────────────────────────────────────────────────────

const COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]

const SYNC_INTERVALS = [
  { value: 'manual', label: 'Manual only' },
  { value: '300000',  label: 'Every 5 minutes' },
  { value: '900000',  label: 'Every 15 minutes' },
  { value: '1800000', label: 'Every 30 minutes' },
  { value: '3600000', label: 'Every hour' },
]

const INTERNAL_FIELDS: { key: keyof IntegrationColumnMapping; label: string; required: boolean }[] = [
  { key: 'external_id', label: 'ID (unique key)',   required: true },
  { key: 'title',       label: 'Title',             required: true },
  { key: 'description', label: 'Description',       required: false },
  { key: 'priority',    label: 'Priority',           required: false },
  { key: 'status',      label: 'Status',             required: false },
  { key: 'tags',        label: 'Tags (comma-sep)',   required: false },
  { key: 'request_from', label: 'Request From',     required: false },
  { key: 'attachments',  label: 'Attachment URL',    required: false },
]

// ── Props ──────────────────────────────────────────────────────────────────────

interface ProjectCreateWizardProps {
  open: boolean
  onClose: () => void
}

// ── Step indicator ─────────────────────────────────────────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────────

export function ProjectCreateWizard({ open, onClose }: ProjectCreateWizardProps) {
  const { createProject, fetchIntegrations, setActiveProject } = useProjectStore()

  // Step 1 — Project info
  const [name, setName]         = useState("")
  const [color, setColor]       = useState("#6366f1")
  const [description, setDesc]  = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState("")

  // Created project id (set after step 1)
  const [projectId, setProjectId] = useState<string | null>(null)

  // Step tracker: 1 = project info, 2 = integration (optional)
  const [step, setStep] = useState(1)

  // Step 2 — Integration
  const [intType, setIntType]               = useState("google_sheets")
  const [credentials, setCredentials]       = useState("")
  const [spreadsheetId, setSpreadsheetId]   = useState("")
  const [syncIntervalMs, setSyncIntervalMs] = useState("manual")
  const [testing, setTesting]               = useState(false)
  const [testResult, setTestResult]         = useState<{ ok: boolean; error?: string; sheets?: string[] } | null>(null)
  const [intStep, setIntStep]               = useState(1) // 1=connect, 2=sheet, 3=map
  const [selectedSheet, setSelectedSheet]   = useState("")
  const [headers, setHeaders]               = useState<string[]>([])
  const [loadingHeaders, setLoadingHeaders] = useState(false)
  const [mapping, setMapping]               = useState<Partial<IntegrationColumnMapping>>({})
  const [syncFromRow, setSyncFromRow]       = useState("")
  const [syncLimit, setSyncLimit]           = useState("500")
  const [saving, setSaving]                 = useState(false)
  const [intError, setIntError]             = useState("")

  function resetAll() {
    setName(""); setColor("#6366f1"); setDesc(""); setCreating(false); setCreateError("")
    setProjectId(null); setStep(1)
    setIntType("google_sheets"); setCredentials(""); setSpreadsheetId("")
    setSyncIntervalMs("manual"); setTesting(false); setTestResult(null)
    setIntStep(1); setSelectedSheet(""); setHeaders([]); setLoadingHeaders(false)
    setMapping({}); setSyncFromRow(""); setSyncLimit("500"); setSaving(false); setIntError("")
  }

  function handleClose() { resetAll(); onClose() }

  // ── Step 1: Create project ──────────────────────────────────────────────────

  async function handleCreateProject(goToIntegration: boolean) {
    if (!name.trim()) { setCreateError("Project name is required"); return }
    setCreating(true); setCreateError("")
    try {
      const project = await createProject({ name: name.trim(), color, description: description.trim() || undefined })
      setProjectId(project.id)
      setActiveProject(project.id)
      if (goToIntegration) {
        setStep(2)
      } else {
        handleClose()
      }
    } catch (e: unknown) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ── Step 2: Integration ─────────────────────────────────────────────────────

  async function handleTest() {
    setTesting(true); setTestResult(null); setIntError("")
    try {
      const result = await api.testIntegrationConnection(projectId!, { type: intType, credentials, spreadsheetId })
      setTestResult(result)
    } catch (e: unknown) {
      setTestResult({ ok: false, error: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSelectSheet(sheetName: string) {
    setSelectedSheet(sheetName); setHeaders([]); setLoadingHeaders(true); setIntError("")
    try {
      const res = await api.getIntegrationHeaders(projectId!, { credentials, spreadsheetId, sheetName })
      setHeaders(res.headers)
    } catch (e: unknown) {
      setIntError((e as Error).message)
    } finally {
      setLoadingHeaders(false)
    }
  }

  async function handleSaveIntegration() {
    setSaving(true); setIntError("")
    try {
      await api.createIntegration(projectId!, {
        type: intType,
        credentials,
        spreadsheetId,
        sheetName: selectedSheet,
        mapping,
        syncIntervalMs: syncIntervalMs !== 'manual' ? Number(syncIntervalMs) : null,
        syncFromRow: syncFromRow ? Number(syncFromRow) : undefined,
        syncLimit: syncLimit ? Number(syncLimit) : 500,
        enabled: true,
      })
      await fetchIntegrations(projectId!)
      handleClose()
    } catch (e: unknown) {
      setIntError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const canTest      = !!credentials && !!spreadsheetId
  const canNextSheet = testResult?.ok === true
  const canNextMap   = !!selectedSheet && headers.length > 0
  const canSave      = !!mapping.external_id && !!mapping.title

  // ── Render ──────────────────────────────────────────────────────────────────

  const totalSteps = step === 1 ? 1 : 4 // shown as progress within step 2

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1
              ? "New Project"
              : intStep === 1
                ? "Connect Integration"
                : intStep === 2
                  ? "Select Sheet"
                  : "Map Columns"
            }
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        {step === 1 ? (
          <StepBar step={1} total={1} />
        ) : (
          <StepBar step={intStep} total={3} />
        )}

        {/* ── STEP 1: Project Info ── */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Project Name <span className="text-red-400">*</span></Label>
              <Input
                value={name}
                onChange={e => { setName(e.target.value); setCreateError("") }}
                placeholder="My Project"
                className="h-9"
                autoFocus
                onKeyDown={e => e.key === "Enter" && handleCreateProject(false)}
              />
              {createError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {createError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Color</Label>
              <div className="flex gap-2 flex-wrap">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      "w-7 h-7 rounded-full border-2 transition-all",
                      color === c ? "border-foreground scale-110 shadow-sm" : "border-transparent hover:scale-105"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <textarea
                value={description}
                onChange={e => setDesc(e.target.value)}
                placeholder="What is this project about?"
                rows={2}
                className="flex w-full rounded-md px-3 py-2 text-sm bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors resize-none"
              />
            </div>

            {/* Preview dot */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              <span className="font-medium text-foreground">{name || "Project Name"}</span>
            </div>
          </div>
        )}

        {/* ── STEP 2a: Connect ── */}
        {step === 2 && intStep === 1 && (
          <div className="space-y-3 py-1">
            {intError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2.5 py-1.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {intError}
              </div>
            )}

            {/* Integration type + sync interval */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Integration</Label>
                <div className="h-8 flex items-center gap-2 px-2.5 rounded-md border border-border/50 bg-input text-xs">
                  <img src="/sheets.png" alt="Google Sheets" className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Google Sheets</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Auto-sync</Label>
                <Select value={syncIntervalMs} onValueChange={setSyncIntervalMs}>
                  <SelectTrigger className="h-8 text-xs border-border/50"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SYNC_INTERVALS.map(i => (
                      <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Sync cutoff options */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start from row</Label>
                <input
                  type="number"
                  min="2"
                  value={syncFromRow}
                  onChange={e => setSyncFromRow(e.target.value)}
                  placeholder="e.g. 950 (skip history)"
                  className="flex h-8 w-full rounded-md px-3 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors"
                />
                <p className="text-[10px] text-muted-foreground/50">Sheet row number (row 1 = header). Leave blank to sync all.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max rows per sync</Label>
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={syncLimit}
                  onChange={e => setSyncLimit(e.target.value)}
                  placeholder="500"
                  className="flex h-8 w-full rounded-md px-3 text-xs bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors"
                />
                <p className="text-[10px] text-muted-foreground/50">Latest N rows. Default: 500.</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Spreadsheet ID</Label>
              <input
                value={spreadsheetId}
                onChange={e => setSpreadsheetId(e.target.value)}
                placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                className="flex h-8 w-full rounded-md px-3 text-xs font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors"
              />
              <p className="text-[10px] text-muted-foreground/60">
                URL: …/spreadsheets/d/<span className="text-primary/70 font-mono">ID</span>/edit
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Service Account JSON</Label>
              <textarea
                value={credentials}
                onChange={e => setCredentials(e.target.value)}
                placeholder={'{"type":"service_account","project_id":"...","private_key":"..."}'}
                rows={4}
                className="flex w-full rounded-md px-3 py-2 text-[11px] font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 transition-colors resize-none"
              />
            </div>

            <CredentialGuide />

            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1.5 px-3"
                onClick={handleTest} disabled={testing || !canTest}
              >
                {testing && <Loader2 className="h-3 w-3 animate-spin" />}
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            {testResult && (
              <span className={cn(
                "text-xs flex items-center gap-1",
                testResult.ok ? "text-emerald-400" : "text-red-400"
              )}>
                {testResult.ok
                  ? <><CheckCircle2 className="h-3.5 w-3.5" /> {testResult.sheets?.length} sheet(s)</>
                  : <><AlertCircle className="h-3.5 w-3.5" /> {testResult.error?.slice(0, 35)}</>}
              </span>
            )}
            </div>
          </div>
        )}

        {/* ── STEP 2b: Select Sheet ── */}
        {step === 2 && intStep === 2 && (
          <div className="space-y-4 py-2">
            {intError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {intError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Sheet / Tab</Label>
              <Select value={selectedSheet || "__none__"} onValueChange={v => v !== "__none__" && handleSelectSheet(v)}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Choose a sheet…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Choose a sheet…</SelectItem>
                  {(testResult?.sheets || []).map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {loadingHeaders && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading column headers…
              </div>
            )}
            {headers.length > 0 && (
              <div className="text-xs text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {headers.length} columns: {headers.slice(0, 4).join(", ")}{headers.length > 4 ? "…" : ""}
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2c: Map Columns ── */}
        {step === 2 && intStep === 3 && (
          <div className="space-y-3 py-2">
            {intError && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {intError}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Map each internal field to a column in your sheet.</p>
            <div className="space-y-2">
              {INTERNAL_FIELDS.map(field => (
                <div key={field.key} className="grid grid-cols-2 gap-3 items-center">
                  <Label className="text-xs">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </Label>
                  <Select
                    value={mapping[field.key] || "__none__"}
                    onValueChange={v => setMapping(m => ({ ...m, [field.key]: v === "__none__" ? undefined : v }))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="— skip —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— skip —</SelectItem>
                      {headers.map(h => (
                        <SelectItem key={h} value={h}>{h}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <DialogFooter className="gap-2 pt-2">
          <Button size="sm" variant="outline" className="h-8 mr-auto" onClick={handleClose}>
            Cancel
          </Button>

          {/* Step 1 footer */}
          {step === 1 && (
            <>
              <Button
                size="sm" variant="outline" className="h-8"
                onClick={() => handleCreateProject(false)}
                disabled={creating || !name.trim()}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Create Project
              </Button>
              <Button
                size="sm" className="h-8 gap-1.5"
                onClick={() => handleCreateProject(true)}
                disabled={creating || !name.trim()}
              >
                Next: Add Integration
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {/* Step 2 footer */}
          {step === 2 && (
            <>
              {intStep > 1 && (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setIntStep(s => s - 1)}>
                  Back
                </Button>
              )}
              {intStep === 1 && (
                <Button size="sm" variant="outline" className="h-8" onClick={handleClose}>
                  Skip
                </Button>
              )}
              {intStep === 1 && (
                <Button size="sm" className="h-8" onClick={() => setIntStep(2)} disabled={!canNextSheet}>
                  Next
                </Button>
              )}
              {intStep === 2 && (
                <Button size="sm" className="h-8" onClick={() => setIntStep(3)} disabled={!canNextMap}>
                  Next
                </Button>
              )}
              {intStep === 3 && (
                <Button size="sm" className="h-8" onClick={handleSaveIntegration} disabled={!canSave || saving}>
                  {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</> : "Save Integration"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

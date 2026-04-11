// src/components/board/IntegrationWizard.tsx
import React, { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"
import { api } from "@/lib/api"
import { useProjectStore } from "@/stores/useProjectStore"
import { IntegrationColumnMapping } from "@/types"
import { CredentialGuide } from "@/components/board/CredentialGuide"

const INTEGRATION_TYPES = [
  { value: 'google_sheets', label: 'Google Sheets' },
]

const SYNC_INTERVALS = [
  { value: 'manual', label: 'Manual only' },
  { value: '300000', label: 'Every 5 minutes' },
  { value: '900000', label: 'Every 15 minutes' },
  { value: '1800000', label: 'Every 30 minutes' },
  { value: '3600000', label: 'Every hour' },
]

const INTERNAL_FIELDS: { key: keyof IntegrationColumnMapping; label: string; required: boolean }[] = [
  { key: 'external_id', label: 'ID (unique key)',  required: true },
  { key: 'title',       label: 'Title',            required: true },
  { key: 'description', label: 'Description',      required: false },
  { key: 'priority',    label: 'Priority',          required: false },
  { key: 'status',      label: 'Status',            required: false },
  { key: 'tags',        label: 'Tags (comma-sep)',  required: false },
]

interface IntegrationWizardProps {
  open: boolean
  onClose: () => void
}

export function IntegrationWizard({ open, onClose }: IntegrationWizardProps) {
  const { activeProjectId, fetchIntegrations } = useProjectStore()

  const [step, setStep] = useState(1)
  const [type, setType] = useState('google_sheets')
  const [credentials, setCredentials] = useState('')
  const [spreadsheetId, setSpreadsheetId] = useState('')
  const [syncIntervalMs, setSyncIntervalMs] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; sheets?: string[] } | null>(null)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [loadingHeaders, setLoadingHeaders] = useState(false)
  const [mapping, setMapping] = useState<Partial<IntegrationColumnMapping>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setStep(1); setType('google_sheets'); setCredentials(''); setSpreadsheetId('')
    setSyncIntervalMs(''); setTesting(false); setTestResult(null); setSelectedSheet('')
    setHeaders([]); setLoadingHeaders(false); setMapping({}); setSaving(false); setError('')
  }

  function handleClose() { reset(); onClose() }

  async function handleTest() {
    setTesting(true); setTestResult(null); setError('')
    try {
      const result = await api.testIntegrationConnection(activeProjectId, { type, credentials, spreadsheetId })
      setTestResult(result)
    } catch (e: unknown) {
      setTestResult({ ok: false, error: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSelectSheet(sheetName: string) {
    setSelectedSheet(sheetName)
    setHeaders([])
    setLoadingHeaders(true)
    try {
      const res = await api.getIntegrationHeaders(activeProjectId, { credentials, spreadsheetId, sheetName })
      setHeaders(res.headers)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoadingHeaders(false)
    }
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api.createIntegration(activeProjectId, {
        type,
        credentials,
        spreadsheetId,
        sheetName: selectedSheet,
        mapping,
        syncIntervalMs: syncIntervalMs && syncIntervalMs !== 'manual' ? Number(syncIntervalMs) : null,
        enabled: true,
      })
      await fetchIntegrations(activeProjectId)
      handleClose()
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const canProceedStep1 = testResult?.ok === true && !!credentials && !!spreadsheetId
  const canProceedStep2 = !!selectedSheet && headers.length > 0
  const canSave = !!mapping.external_id && !!mapping.title

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-base">
            {step === 1 ? 'Connect Google Sheets' : step === 2 ? 'Select Sheet' : 'Map Columns'}
          </DialogTitle>
        </DialogHeader>

        {/* Step bar */}
        <div className="flex gap-1.5 shrink-0">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-0.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto min-h-0">

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2.5 py-1.5 mb-3">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Connect */}
        {step === 1 && (
          <div className="space-y-3 py-1">
            {/* Integration type — static display with icon + sync interval */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                {/* Static — only Google Sheets for now */}
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

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Spreadsheet ID</Label>
              <input
                value={spreadsheetId}
                onChange={e => setSpreadsheetId(e.target.value)}
                placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                className="flex h-8 w-full rounded-md px-3 text-xs font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors"
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
                className="flex w-full rounded-md px-3 py-2 text-[11px] font-mono bg-input text-foreground placeholder:text-muted-foreground border border-border/50 outline-none focus:border-primary/60 focus:ring-0 transition-colors resize-none"
              />
            </div>

            {/* Compact guide below credentials */}
            <CredentialGuide />

            <div className="flex items-center gap-2">
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1.5 px-3"
                onClick={handleTest} disabled={testing || !credentials || !spreadsheetId}
              >
                {testing
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                }
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
              {testResult && (
                <span className={`text-xs flex items-center gap-1 ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResult.ok
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> {testResult.sheets?.length} sheet(s) found</>
                    : <><AlertCircle className="h-3.5 w-3.5" /> {testResult.error?.slice(0, 40)}</>
                  }
                </span>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Select Sheet */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Select Sheet / Tab</Label>
              <Select value={selectedSheet} onValueChange={handleSelectSheet}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Choose a sheet…" />
                </SelectTrigger>
                <SelectContent>
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
                {headers.length} columns detected: {headers.slice(0, 4).join(', ')}{headers.length > 4 ? '…' : ''}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Map Columns */}
        {step === 3 && (
          <div className="space-y-2 py-1">
            <p className="text-[11px] text-muted-foreground">Map kolom sheet ke field internal dashboard.</p>
            <div className="space-y-1.5">
              {INTERNAL_FIELDS.map(field => (
                <div key={field.key} className="grid grid-cols-2 gap-2 items-center">
                  <Label className="text-xs text-muted-foreground">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </Label>
                  <Select
                    value={mapping[field.key] || '__none__'}
                    onValueChange={v => setMapping(m => ({ ...m, [field.key]: v === '__none__' ? undefined : v }))}
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

        </div>{/* end scrollable */}

        <DialogFooter className="gap-2 pt-2 border-t border-border/40 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs mr-auto" onClick={handleClose}>Cancel</Button>
          {step > 1 && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStep(s => s - 1)}>
              Back
            </Button>
          )}
          {step < 3 && (
            <Button
              size="sm" className="h-7 text-xs"
              onClick={() => setStep(s => s + 1)}
              disabled={step === 1 ? !canProceedStep1 : !canProceedStep2}
            >
              Next
            </Button>
          )}
          {step === 3 && (
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</> : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

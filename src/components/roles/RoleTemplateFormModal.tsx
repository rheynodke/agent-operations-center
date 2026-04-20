import { useEffect, useState } from "react"
import { X, Loader2, Sparkles, Package, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import type { RoleTemplateRecord } from "@/types"

export type FormMode =
  | { kind: "create" }
  | { kind: "fork";   source: RoleTemplateRecord }
  | { kind: "edit";   source: RoleTemplateRecord }

interface Props {
  mode: FormMode
  onClose: () => void
  onSaved: (template: RoleTemplateRecord) => void
}

const DEFAULT_COLOR = "#6366f1"
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/

function slugifyId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
}

export function RoleTemplateFormModal({ mode, onClose, onSaved }: Props) {
  const isEdit   = mode.kind === "edit"
  const isFork   = mode.kind === "fork"
  const isCreate = mode.kind === "create"

  const src = !isCreate ? (mode as Exclude<FormMode, { kind: "create" }>).source : null

  // Form state
  const [id, setId]               = useState(isEdit ? src!.id : isFork ? `${src!.id}-copy` : "")
  const [idTouched, setIdTouched] = useState(false)
  const [role, setRole]           = useState(src?.role || "")
  const [emoji, setEmoji]         = useState(src?.emoji || "")
  const [color, setColor]         = useState(src?.color || DEFAULT_COLOR)
  const [description, setDescription] = useState(src?.description || "")
  const [model, setModel]         = useState(src?.modelRecommendation || "")
  const [adlcNum, setAdlcNum]     = useState<string>(
    src?.adlcAgentNumber != null && !isFork /* forks drop adlc # by default */ ? String(src.adlcAgentNumber) : ""
  )
  const [tagsRaw, setTagsRaw]     = useState(src?.tags?.join(", ") || "")
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Auto-fill ID from role in create/fork mode until user types ID manually
  useEffect(() => {
    if (isEdit || idTouched) return
    if (isCreate) {
      setId(role.trim() ? slugifyId(role) : "")
    }
    // fork: keep the "-copy" suffix default, don't track role
  }, [role, idTouched, isCreate, isEdit])

  const idValid = ID_PATTERN.test(id)
  const roleValid = role.trim().length > 0
  const adlcValid = !adlcNum || (/^\d+$/.test(adlcNum) && +adlcNum >= 1 && +adlcNum <= 99)
  const colorValid = /^#[0-9a-fA-F]{3,8}$/.test(color)
  const canSubmit = (isEdit || idValid) && roleValid && adlcValid && colorValid && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true); setError(null)

    const payload: Partial<RoleTemplateRecord> = {
      role: role.trim(),
      emoji: emoji.trim() || null,
      color,
      description: description.trim(),
      modelRecommendation: model.trim() || null,
      adlcAgentNumber: adlcNum ? parseInt(adlcNum, 10) : null,
      tags: tagsRaw.split(",").map(s => s.trim()).filter(Boolean),
    }

    try {
      let saved: RoleTemplateRecord
      if (isEdit) {
        const r = await api.updateRoleTemplate(src!.id, payload)
        saved = r.template
      } else if (isFork) {
        const r = await api.forkRoleTemplate(src!.id, id, payload)
        saved = r.template
      } else {
        const r = await api.createRoleTemplate({ ...payload, id })
        saved = r.template
      }
      onSaved(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const title = isEdit
    ? `Edit ${src!.role}`
    : isFork
    ? `Fork ${src!.role}`
    : "New Role Template"

  const Icon = isFork ? Copy : isEdit ? Sparkles : Package

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              {isFork && (
                <p className="text-[11px] text-muted-foreground">Creates a new custom template from <code className="font-mono">{src!.id}</code></p>
              )}
              {isCreate && (
                <p className="text-[11px] text-muted-foreground">Blank template — add skills &amp; scripts after saving</p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {!isEdit && (
            <Field label="Template ID" required hint="Lowercase letters, digits, hyphens (2-64 chars)">
              <input
                type="text"
                value={id}
                onChange={e => { setId(slugifyId(e.target.value)); setIdTouched(true) }}
                placeholder="my-custom-role"
                className={cn(
                  "w-full bg-input border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1",
                  id && !idValid ? "border-red-500/40 focus:ring-red-500" : "border-border focus:ring-primary",
                )}
              />
              {id && !idValid && (
                <p className="text-[11px] text-red-400 mt-1">Invalid format</p>
              )}
            </Field>
          )}
          {isEdit && (
            <Field label="Template ID" hint="Cannot be changed after creation">
              <input
                type="text"
                value={id}
                disabled
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-muted-foreground font-mono cursor-not-allowed"
              />
            </Field>
          )}

          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <Field label="Role name" required>
              <input
                type="text"
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="PM & Product Analyst"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <Field label="Emoji">
              <input
                type="text"
                value={emoji}
                onChange={e => setEmoji(e.target.value.slice(0, 4))}
                placeholder="🧩"
                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-center text-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
          </div>

          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field label="Color" hint="Hex">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="w-8 h-8 rounded border border-border bg-transparent cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className={cn(
                    "flex-1 min-w-0 bg-input border rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-1",
                    colorValid ? "border-border focus:ring-primary" : "border-red-500/40 focus:ring-red-500",
                  )}
                />
              </div>
            </Field>
            <Field label="ADLC #" hint="1-99, optional">
              <input
                type="number"
                value={adlcNum}
                onChange={e => setAdlcNum(e.target.value)}
                min={1}
                max={99}
                placeholder="—"
                className={cn(
                  "w-full bg-input border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1",
                  adlcValid ? "border-border focus:ring-primary" : "border-red-500/40 focus:ring-red-500",
                )}
              />
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="What does this role do?"
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </Field>

          <Field label="Model recommendation" hint="Free text, e.g. 'Claude Opus 4.6' or 'sonnet'">
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="e.g. sonnet"
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          <Field label="Tags" hint="Comma-separated">
            <input
              type="text"
              value={tagsRaw}
              onChange={e => setTagsRaw(e.target.value)}
              placeholder="discovery, research, prd"
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>

          {isFork && (
            <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-[11px] text-sky-300/90">
              Skills, scripts, and agent files are copied from <code className="font-mono">{src!.id}</code>.
              Edit them after saving.
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-border flex items-center justify-end gap-2 bg-surface-high/30">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
              "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25",
              "disabled:opacity-40 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> :
             isEdit ? "Save changes" :
             isFork ? "Fork template" : "Create template"}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
        {required && <span className="text-[10px] text-red-400">*</span>}
      </div>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
    </div>
  )
}

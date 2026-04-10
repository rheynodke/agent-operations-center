import React, { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { X, ChevronDown, ChevronRight, LayoutTemplate, Search } from "lucide-react"
import {
  SKILL_TEMPLATES, SUPERPOWERS_SKILL_TEMPLATES, SCRIPT_TEMPLATES,
  SKILL_CATEGORIES, SCRIPT_CATEGORIES,
  type SkillTemplate, type ScriptTemplate,
} from "@/data/adlcTemplates"

// ─── Types ────────────────────────────────────────────────────────────────────

interface TemplatePickerProps {
  mode: "skill" | "script"
  onSelect: (content: string, name: string) => void
  onClose: () => void
}

// ─── TemplatePicker ───────────────────────────────────────────────────────────

export function TemplatePicker({ mode, onSelect, onClose }: TemplatePickerProps) {
  const [search, setSearch] = useState("")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  const templates = mode === "skill" ? [...SUPERPOWERS_SKILL_TEMPLATES, ...SKILL_TEMPLATES] : SCRIPT_TEMPLATES
  const categories = mode === "skill" ? SKILL_CATEGORIES : SCRIPT_CATEGORIES

  // Filter by search
  const filtered = search.trim()
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.tags.some(tag => tag.includes(search.toLowerCase()))
      )
    : templates

  // Auto-select first template on initial load or after search changes
  useEffect(() => {
    if (filtered.length > 0) {
      const stillValid = selectedId && filtered.some(t => t.id === selectedId)
      if (!stillValid) setSelectedId(filtered[0].id)
    } else {
      setSelectedId(null)
    }
  }, [filtered.length, search])

  // Group by category
  const grouped = new Map<string, typeof filtered>()
  for (const t of filtered) {
    const cat = mode === "skill"
      ? (t as SkillTemplate).category
      : (t as ScriptTemplate).category
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(t)
  }

  function toggleCategory(cat: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(cat) ? next.delete(cat) : next.add(cat)
      return next
    })
  }

  function getCategoryConfig(catId: string) {
    return categories.find(c => c.id === catId) ?? {
      id: catId, emoji: '📁', color: 'text-muted-foreground',
      bg: 'bg-foreground/5', border: 'border-border',
    }
  }

  const selectedTemplate = selectedId
    ? templates.find(t => t.id === selectedId)
    : null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: "85vh" }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <LayoutTemplate className="w-5 h-5 text-violet-400" />
          <div>
            <h2 className="text-[14px] font-bold text-foreground">
              {mode === "skill" ? "Skill Templates" : "Custom Tool Scripts"}
            </h2>
            <p className="text-[11px] text-muted-foreground/60">
              {mode === "skill"
                ? "Template SKILL.md — Agent Superpowers, ADLC Pipeline, Odoo Tools"
                : "Script executable untuk Custom Tools (~/.openclaw/scripts/ atau agent workspace/scripts/)"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-foreground/5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={mode === "skill" ? "Cari skill template…" : "Cari custom tool script…"}
              className="w-full pl-9 pr-4 py-2 bg-foreground/3 border border-border rounded-lg text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500/40 transition-colors"
            />
          </div>
        </div>

        {/* Body — two-panel layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* Left: Template list */}
          <div className="w-72 shrink-0 border-r border-border overflow-y-auto">
            {grouped.size === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-center px-4">
                <p className="text-[12px] text-muted-foreground/50">Tidak ada template yang cocok</p>
              </div>
            ) : (
              Array.from(grouped.entries()).map(([cat, items]) => {
                const config = getCategoryConfig(cat)
                const isCollapsed = collapsed.has(cat)
                return (
                  <div key={cat} className="border-b border-border/50 last:border-0">
                    {/* Category header */}
                    <button
                      onClick={() => toggleCategory(cat)}
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-foreground/3 transition-colors"
                    >
                      <span className="text-sm">{config.emoji}</span>
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider flex-1 text-left", config.color)}>
                        {cat}
                      </span>
                      <span className="text-[9px] text-muted-foreground/40 mr-1">{items.length}</span>
                      {isCollapsed
                        ? <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                        : <ChevronDown className="w-3 h-3 text-muted-foreground/30" />
                      }
                    </button>

                    {/* Templates in category */}
                    {!isCollapsed && items.map(template => {
                      const isSelected = selectedId === template.id
                      const name = template.name
                      const desc = template.description
                      const agentLabel = mode === "skill"
                        ? (template as SkillTemplate).agentEmoji
                        : (template as ScriptTemplate).categoryEmoji

                      return (
                        <button
                          key={template.id}
                          onClick={() => setSelectedId(template.id)}
                          className={cn(
                            "w-full flex items-start gap-2.5 px-4 py-2.5 text-left transition-colors border-l-2",
                            isSelected
                              ? "bg-violet-500/10 border-l-violet-400 text-foreground"
                              : "border-l-transparent hover:bg-foreground/3 hover:border-l-foreground/10"
                          )}
                        >
                          <span className="text-base leading-none mt-0.5 shrink-0">{agentLabel}</span>
                          <div className="min-w-0 flex-1">
                            <span className={cn(
                              "text-[12px] font-semibold block truncate",
                              isSelected ? "text-violet-300" : "text-foreground/80"
                            )}>
                              {name}
                            </span>
                            <span className="text-[10px] text-muted-foreground/50 block leading-tight line-clamp-2">
                              {desc}
                            </span>
                            {mode === "script" && (
                              <span className="text-[9px] font-mono text-muted-foreground/30 mt-0.5 block">
                                {(template as ScriptTemplate).filename}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>

          {/* Right: Preview */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-foreground/1">
            {selectedTemplate ? (
              <>
                {/* Preview header — sticky */}
                <div className="shrink-0 px-5 py-3 border-b border-border bg-foreground/2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-bold text-foreground truncate">{selectedTemplate.name}</h3>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5 line-clamp-2">{selectedTemplate.description}</p>
                    </div>
                    <button
                      onClick={() => onSelect(selectedTemplate.content, selectedTemplate.name)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-[11px] text-violet-300 font-bold hover:bg-violet-500/30 transition-colors"
                    >
                      <LayoutTemplate className="w-3 h-3" />
                      Use Template
                    </button>
                  </div>
                  {/* Tags */}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedTemplate.tags.map(tag => (
                      <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/8 text-muted-foreground/50 font-mono">
                        {tag}
                      </span>
                    ))}
                    {mode === "skill" && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400/70 font-semibold">
                        {(selectedTemplate as SkillTemplate).agent}
                      </span>
                    )}
                  </div>
                </div>

                {/* Content preview — scrollable independently */}
                <div className="flex-1 overflow-y-auto">
                  <pre className="p-5 text-[11px] font-mono text-foreground/60 leading-relaxed whitespace-pre-wrap">
                    {selectedTemplate.content}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <LayoutTemplate className="w-10 h-10 text-foreground/8 mb-3" />
                <p className="text-[13px] font-semibold text-muted-foreground/40">Pilih template untuk preview</p>
                <p className="text-[11px] text-muted-foreground/30 mt-1">
                  Klik template di kiri untuk melihat isi
                </p>
                <div className="mt-4 text-[10px] text-muted-foreground/25 space-y-1">
                  <p>{SUPERPOWERS_SKILL_TEMPLATES.length + SKILL_TEMPLATES.length} skill templates · {SCRIPT_TEMPLATES.length} script templates</p>
                  <p>Agent Superpowers + ADLC Platform v1.0</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-2.5 border-t border-border bg-foreground/1 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground/30">
            {mode === "skill"
              ? "Skill = SKILL.md yang di-inject ke agent context · Cross-skill reference via ../skill-name/SKILL.md"
              : "Custom Tool Scripts = script executable di ~/.openclaw/scripts/ atau agent workspace/scripts/"}
          </p>
          <p className="text-[10px] text-muted-foreground/30">
            Pilih template → edit dengan AI Assist untuk kustomisasi
          </p>
        </div>
      </div>
    </div>
  )
}

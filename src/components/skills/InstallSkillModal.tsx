import { useState, useEffect, useCallback, Component } from "react"
import type { ReactNode } from "react"

// process.env is Node-only — use this helper in browser components
function shortenPath(p: string) {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")
}
import {
  X, Search, ShieldCheck, ShieldAlert, ShieldX, Download,
  ChevronDown, FileText, CheckCircle2, Loader2, ExternalLink,
  Package, Star, Key, Trash2, AlertTriangle, Github,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useAgentStore } from "@/stores"
import type {
  ClawHubSkillPreview, ClawHubInstallTarget,
  SkillsmpSkill, SkillsmpKeyStatus,
} from "@/types"

// ─── Error Boundary ───────────────────────────────────────────────────────────

class SkillErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { error: string | null }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  componentDidCatch(err: unknown) {
    console.error("[InstallSkillModal] render error:", err)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col gap-3 p-4 rounded-xl border border-destructive/30 bg-destructive/5">
          <p className="text-sm font-medium text-destructive">Render error</p>
          <p className="text-xs text-muted-foreground font-mono break-all">{this.state.error}</p>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onReset() }}
            className="text-xs text-primary hover:underline w-fit"
          >
            ← Back to results
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Safe field accessor — never returns an object ────────────────────────────
function s(val: unknown): string {
  if (val === null || val === undefined) return ""
  if (typeof val === "string") return val
  if (typeof val === "number") return String(val)
  if (typeof val === "boolean") return String(val)
  // object/array — don't render it
  return ""
}

function safeNum(val: unknown): number {
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function SecurityBadge({ rating }: { rating: ClawHubSkillPreview["security"]["rating"] }) {
  const cfg = {
    clean:  { icon: ShieldCheck, color: "text-green-400",  bg: "bg-green-400/10",  label: "Clean" },
    info:   { icon: ShieldCheck, color: "text-sky-400",    bg: "bg-sky-400/10",    label: "Minor notes" },
    warn:   { icon: ShieldAlert, color: "text-amber-400",  bg: "bg-amber-400/10",  label: "Review needed" },
    danger: { icon: ShieldX,     color: "text-red-400",    bg: "bg-red-400/10",    label: "Dangerous" },
  }[rating]
  const Icon = cfg.icon
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium", cfg.bg, cfg.color)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  )
}

const TARGET_ICONS: Record<string, string> = {
  global: "🌐", personal: "👤", project: "📁", workspace: "🖥️", agent: "🤖",
}

function TargetPicker({ targets, value, onChange, agentId, onAgentChange }: {
  targets: ClawHubInstallTarget[]
  value: string
  onChange: (v: string) => void
  agentId: string
  onAgentChange: (v: string) => void
}) {
  const agents = useAgentStore(s => s.agents)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {targets.map(t => (
          <button key={t.value} type="button" onClick={() => onChange(t.value)}
            className={cn(
              "flex flex-col items-start gap-0.5 px-3 py-2 rounded-xl border text-left transition-all",
              value === t.value
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border bg-card/60 text-muted-foreground hover:text-foreground hover:bg-card"
            )}>
            <span className="text-base">{TARGET_ICONS[t.value]}</span>
            <span className="text-[11px] font-medium leading-tight">{t.label}</span>
            {t.path && (
              <span className="text-[9px] text-muted-foreground/60 font-mono truncate w-full mt-0.5">
                {shortenPath(t.path).slice(0, 35)}
              </span>
            )}
          </button>
        ))}
      </div>
      {value === "agent" && agents.length > 0 && (
        <div className="relative">
          <select value={agentId} onChange={e => onAgentChange(e.target.value)}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="">Select agent…</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        </div>
      )}
    </div>
  )
}

// ─── SkillsMP: API key setup ──────────────────────────────────────────────────

function SkillsmpKeySetup({ onConfigured }: { onConfigured: () => void }) {
  const [key, setKey]     = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError]  = useState<string | null>(null)

  async function handleSave() {
    if (!key.trim()) return
    setSaving(true); setError(null)
    try {
      await api.skillsmpSetKey(key.trim())
      onConfigured()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 flex items-start gap-3">
        <Key className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">SkillsMP API Key required</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Get your free API key at{" "}
            <a href="https://skillsmp.com" target="_blank" rel="noopener noreferrer"
              className="text-primary underline underline-offset-2">skillsmp.com</a>
            {" "}→ sign up → copy your <span className="font-mono text-foreground/80">sk_live_...</span> key.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">API Key</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="sk_live_…"
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button onClick={handleSave} disabled={!key.trim() || saving}
            className="px-4 py-2 rounded-lg bg-primary/15 border border-primary/25 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : "Save"}
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}

// ─── SkillsMP: search tab ─────────────────────────────────────────────────────

// ─── SkillsMP: skill detail panel ────────────────────────────────────────────

function SkillDetailInner({ skill, targets, onBack }: {
  skill: SkillsmpSkill
  targets: ClawHubInstallTarget[]
  onBack: () => void
}) {
  // Normalize all fields to primitives up-front — prevents React "objects are not valid children"
  const name        = s(skill.name) || s(skill.slug) || "Unknown skill"
  const desc        = s(skill.description)
  const version     = s(skill.version)
  const license     = s(skill.license)
  const author      = s(skill.author)
  const githubUrl   = s(skill.githubUrl)
  const stars       = safeNum(skill.stars)
  const tags        = Array.isArray(skill.tags)
    ? skill.tags.map(t => s(t)).filter(Boolean)
    : []

  const [previewState, setPreviewState] = useState<"loading" | "done" | "error">("loading")
  const [skillMd, setSkillMd]           = useState<string | null>(null)
  const [security, setSecurity]         = useState<import("@/types").ClawHubSecurityResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [showSkillMd, setShowSkillMd]   = useState(true) // auto-open
  const [target, setTarget]             = useState("global")
  const [agentId, setAgentId]           = useState("")
  const [installState, setInstallState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [installError, setInstallError] = useState<string | null>(null)
  const [installedPath, setInstalledPath] = useState<string | null>(null)

  const skillSlug = s(skill.slug) || s(skill.id)

  useEffect(() => {
    let cancelled = false
    setPreviewState("loading"); setSkillMd(null); setSecurity(null)
    api.skillsmpPreview(skill)
      .then(res => {
        if (cancelled) return
        setSkillMd(typeof res.content === "string" ? res.content : "")
        setSecurity(res.security)
        setPreviewState("done")
      })
      .catch(e => {
        if (cancelled) return
        setPreviewError(e instanceof Error ? e.message : String(e))
        setPreviewState("error")
      })
    return () => { cancelled = true }
  }, [skillSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleInstall() {
    if (target === "agent" && !agentId) return
    setInstallState("loading"); setInstallError(null)
    try {
      const res = await api.skillsmpInstall(skill, target, target === "agent" ? agentId : undefined)
      setInstalledPath(typeof res.path === "string" ? res.path : "")
      setInstallState("done")
    } catch (e: unknown) {
      setInstallError(e instanceof Error ? e.message : String(e))
      setInstallState("error")
    }
  }

  if (installState === "done") {
    return (
      <div className="flex flex-col gap-4">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className="w-3.5 h-3.5 rotate-90" /> Back to results
        </button>
        <div className="rounded-xl border border-green-500/20 bg-green-500/8 px-4 py-5 flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">"{name}" installed successfully!</p>
            {installedPath && (
              <p className="text-[11px] text-muted-foreground font-mono mt-1 break-all">{shortenPath(installedPath)}</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Back */}
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors w-fit">
        <ChevronDown className="w-3.5 h-3.5 rotate-90" /> Back to results
      </button>

      {/* Header */}
      <div className="rounded-xl border border-border bg-surface-high p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-foreground">{name}</h3>
              {version && <span className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-1.5 py-0.5 rounded">v{version}</span>}
              {license && <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/20">{license}</span>}
            </div>
            {desc && <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{desc}</p>}
          </div>
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-card transition-colors">
              <Github className="w-3.5 h-3.5" /> GitHub
            </a>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          {author && (
            <span className="text-[12px] text-muted-foreground">
              <span className="text-muted-foreground/50">by</span> @{author}
            </span>
          )}
          {stars > 0 && (
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <Star className="w-3 h-3 text-amber-400" />{stars.toLocaleString()} stars
            </span>
          )}
          {tags.length > 0 && tags.slice(0, 4).map((tag, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/20 text-muted-foreground">{tag}</span>
          ))}
        </div>
        {!githubUrl && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-500/8 border border-amber-500/20 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <p className="text-[12px] text-amber-400">No GitHub source URL — install may fail</p>
          </div>
        )}
      </div>

      {/* SKILL.md preview */}
      <div className="rounded-xl border border-border overflow-hidden">
        <button onClick={() => setShowSkillMd(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-surface-high hover:bg-card transition-colors">
          <div className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">SKILL.md</span>
            {previewState === "loading" && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {previewState === "done" && skillMd && <span className="text-[10px] text-muted-foreground">{skillMd.split("\n").length} lines</span>}
            {previewState === "error" && <span className="text-[10px] text-destructive">unavailable</span>}
          </div>
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", showSkillMd && "rotate-180")} />
        </button>
        {showSkillMd && (
          <div className="border-t border-border">
            {previewState === "loading" && (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Fetching from GitHub…</span>
              </div>
            )}
            {previewState === "error" && (
              <div className="px-4 py-3 text-sm text-destructive">{previewError || "Could not fetch SKILL.md"}</div>
            )}
            {previewState === "done" && skillMd && (
              <div className="max-h-60 overflow-y-auto bg-muted/10">
                <pre className="px-4 py-3 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">{skillMd}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Security */}
      {previewState === "done" && security && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex flex-col gap-2",
          security.rating === "clean"  ? "border-green-500/20 bg-green-500/5" :
          security.rating === "info"   ? "border-sky-500/20 bg-sky-500/5" :
          security.rating === "warn"   ? "border-amber-500/20 bg-amber-500/5" :
          "border-red-500/20 bg-red-500/5"
        )}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Security Scan</span>
            <SecurityBadge rating={security.rating} />
          </div>
          <p className="text-[13px] text-foreground/80">{s(security.summary)}</p>
          {Array.isArray(security.issues) && security.issues.map((issue, i) => (
            <div key={i} className={cn("text-[12px] flex items-center gap-1.5", issue.level === "danger" ? "text-red-400" : "text-amber-400")}>
              <span className="w-1 h-1 rounded-full bg-current shrink-0" />
              <span className="font-mono text-[10px] text-muted-foreground">{s(issue.file)}</span>
              <span>{s(issue.label)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Install location */}
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Install location</p>
        <TargetPicker targets={targets} value={target} onChange={setTarget} agentId={agentId} onAgentChange={setAgentId} />
      </div>

      {installError && <p className="text-sm text-destructive">{installError}</p>}

      <button onClick={handleInstall}
        disabled={(installState as string) === "loading" || (target === "agent" && !agentId) || security?.rating === "danger"}
        className={cn(
          "flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40",
          security?.rating === "danger"
            ? "bg-red-500/10 text-red-400 border border-red-500/20 cursor-not-allowed"
            : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
        )}>
        {(installState as string) === "loading" ? <><Loader2 className="w-4 h-4 animate-spin" /> Installing…</> :
         security?.rating === "danger"           ? <><ShieldX className="w-4 h-4" /> Blocked</> :
         <><Download className="w-4 h-4" /> Install "{name}"</>}
      </button>
    </div>
  )
}

// SkillDetail wraps SkillDetailInner in an error boundary
function SkillDetail(props: { skill: SkillsmpSkill; targets: ClawHubInstallTarget[]; onBack: () => void }) {
  return (
    <SkillErrorBoundary onReset={props.onBack}>
      <SkillDetailInner {...props} />
    </SkillErrorBoundary>
  )
}

// ─── SkillsMP: search tab ─────────────────────────────────────────────────────

function SkillsmpTab({ targets }: { targets: ClawHubInstallTarget[] }) {
  const [keyStatus, setKeyStatus]     = useState<SkillsmpKeyStatus | null>(null)
  const [query, setQuery]             = useState("")
  const [searching, setSearching]     = useState(false)
  const [results, setResults]         = useState<SkillsmpSkill[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected]       = useState<SkillsmpSkill | null>(null)

  const loadKeyStatus = useCallback(async () => {
    try { setKeyStatus(await api.skillsmpKeyStatus()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadKeyStatus() }, [loadKeyStatus])

  async function handleSearch() {
    if (!query.trim()) return
    setSearching(true); setSearchError(null); setResults([]); setSelected(null)
    try {
      setResults((await api.skillsmpSearch(query.trim())).skills)
    } catch (e: unknown) {
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  async function handleDeleteKey() {
    await api.skillsmpDeleteKey()
    setKeyStatus({ configured: false, preview: null })
    setResults([]); setSelected(null)
  }

  if (!keyStatus) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }
  if (!keyStatus.configured) {
    return <SkillsmpKeySetup onConfigured={loadKeyStatus} />
  }

  // Detail view
  if (selected) {
    return <SkillDetail skill={selected} targets={targets} onBack={() => setSelected(null)} />
  }

  // Search list view
  return (
    <div className="flex flex-col gap-4">
      {/* Key status bar */}
      <div className="flex items-center justify-between rounded-lg bg-green-500/8 border border-green-500/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
          <span className="text-[12px] text-green-400 font-medium">API Key configured</span>
          {keyStatus.preview && <span className="text-[11px] font-mono text-muted-foreground">{keyStatus.preview}</span>}
        </div>
        <button onClick={handleDeleteKey} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded" title="Remove API key">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search 700k+ skills…"
            className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button onClick={handleSearch} disabled={!query.trim() || searching}
          className="px-4 py-2 rounded-lg bg-primary/15 border border-primary/25 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0">
          {searching ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…</> : "Search"}
        </button>
      </div>

      {searchError && <p className="text-sm text-destructive">{searchError}</p>}

      {/* Results list */}
      {results.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-muted-foreground">{results.length} results — click to preview</p>
          <div className="flex flex-col gap-1 max-h-[340px] overflow-y-auto">
            {results.map(skill => (
              <button key={String(skill.id)} type="button"
                onClick={() => setSelected(skill)}
                className="flex items-start gap-3 px-3 py-3 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/30 text-left transition-all group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground truncate">{String(skill.name)}</span>
                    {skill.version && <span className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-1 py-0.5 rounded">v{String(skill.version)}</span>}
                    {skill.license && <span className="text-[10px] text-muted-foreground px-1 py-0.5 rounded bg-muted/20">{String(skill.license)}</span>}
                  </div>
                  {skill.description && <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{String(skill.description)}</p>}
                  <div className="flex items-center gap-3 mt-1.5">
                    {skill.author && <span className="text-[11px] text-muted-foreground/70">@{String(skill.author)}</span>}
                    {skill.stars > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/70">
                        <Star className="w-3 h-3 text-amber-400/70" />{skill.stars.toLocaleString()}
                      </span>
                    )}
                    {skill.githubUrl && (
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/50">
                        <Github className="w-3 h-3" />GitHub
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary -rotate-90 shrink-0 mt-1 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && !searching && query && !searchError && (
        <div className="flex flex-col items-center py-8 gap-2 text-muted-foreground">
          <Search className="w-8 h-8 opacity-30" />
          <p className="text-sm">No results for "{query}"</p>
        </div>
      )}

      {results.length === 0 && !query && (
        <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground/50">
          <span className="text-3xl">⚡</span>
          <p className="text-sm">Search the SkillsMP marketplace</p>
          <p className="text-[12px]">700,000+ skills from GitHub</p>
        </div>
      )}
    </div>
  )
}

// ─── ClawHub tab ──────────────────────────────────────────────────────────────

function ClawHubTab({ targets }: { targets: ClawHubInstallTarget[] }) {
  const [url, setUrl]                     = useState("")
  const [fetchState, setFetchState]       = useState<"idle" | "loading" | "done" | "error">("idle")
  const [preview, setPreview]             = useState<ClawHubSkillPreview | null>(null)
  const [fetchError, setFetchError]       = useState<string | null>(null)
  const [target, setTarget]               = useState("global")
  const [agentId, setAgentId]             = useState("")
  const [installState, setInstallState]   = useState<"idle" | "loading" | "done" | "error">("idle")
  const [installError, setInstallError]   = useState<string | null>(null)
  const [installedPath, setInstalledPath] = useState<string | null>(null)
  const [showFiles, setShowFiles]         = useState(false)
  const [showSkillMd, setShowSkillMd]     = useState(false)

  async function handleFetch() {
    if (!url.trim()) return
    setFetchState("loading"); setPreview(null); setFetchError(null)
    setInstallState("idle"); setInstallError(null)
    try {
      setPreview(await api.clawHubPreview(url.trim()))
      setFetchState("done")
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : String(e))
      setFetchState("error")
    }
  }

  async function handleInstall() {
    if (!preview) return
    if (target === "agent" && !agentId) return
    setInstallState("loading"); setInstallError(null)
    try {
      const res = await api.clawHubInstall(url.trim(), target, target === "agent" ? agentId : undefined, preview._bufferB64)
      setInstalledPath(res.path)
      setInstallState("done")
    } catch (e: unknown) {
      setInstallError(e instanceof Error ? e.message : String(e))
      setInstallState("error")
    }
  }

  const canInstall = preview && (installState as string) === "idle" &&
    preview.security.rating !== "danger" && (target !== "agent" || !!agentId)

  return (
    <div className="flex flex-col gap-4">
      {/* URL input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleFetch()}
            placeholder="https://clawhub.ai/author/skill-name"
            className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button onClick={handleFetch} disabled={!url.trim() || fetchState === "loading"}
          className="px-4 py-2 rounded-lg bg-primary/15 border border-primary/25 text-sm text-primary font-medium hover:bg-primary/25 disabled:opacity-40 transition-colors flex items-center gap-1.5 shrink-0">
          {fetchState === "loading" ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching…</> : "Fetch"}
        </button>
      </div>

      {fetchState === "error" && fetchError && <p className="text-sm text-destructive">{fetchError}</p>}

      {/* Preview card */}
      {preview && (
        <div className="rounded-xl border border-border bg-surface-high flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            {preview.emoji && <span className="text-2xl shrink-0 mt-0.5">{preview.emoji}</span>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">{preview.name}</h3>
                {preview.version && <span className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-1.5 py-0.5 rounded">v{preview.version}</span>}
                {preview.license && <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted/20">{preview.license}</span>}
              </div>
              {preview.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{preview.description}</p>}
              {preview.author && <p className="text-[10px] text-muted-foreground/60 mt-1">by @{preview.author}</p>}
            </div>
            <a href={`https://clawhub.ai/${preview.author ? preview.author + "/" : ""}${preview.slug}`}
              target="_blank" rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Security scan */}
          <div className={cn(
            "rounded-lg border px-3 py-2.5 flex flex-col gap-1.5",
            preview.security.rating === "clean"  && "border-green-500/20 bg-green-500/5",
            preview.security.rating === "info"   && "border-sky-500/20 bg-sky-500/5",
            preview.security.rating === "warn"   && "border-amber-500/20 bg-amber-500/5",
            preview.security.rating === "danger" && "border-red-500/20 bg-red-500/5",
          )}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Security Scan</span>
              <SecurityBadge rating={preview.security.rating} />
            </div>
            <p className="text-xs text-foreground/80">{preview.security.summary}</p>
            {preview.security.issues.length > 0 && (
              <ul className="flex flex-col gap-0.5 mt-0.5">
                {preview.security.issues.slice(0, 5).map((issue, i) => (
                  <li key={i} className={cn("text-[11px] flex items-center gap-1.5", issue.level === "danger" ? "text-red-400" : "text-amber-400")}>
                    <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                    <span className="font-mono text-[10px] text-muted-foreground">{issue.file}</span>
                    <span>{issue.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* File list + SKILL.md toggles */}
          <div className="flex gap-2">
            <button onClick={() => setShowFiles(v => !v)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <ChevronDown className={cn("w-3 h-3 transition-transform", showFiles && "rotate-180")} />
              {preview.fileList.length} files
            </button>
            <button onClick={() => setShowSkillMd(v => !v)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-2">
              <FileText className="w-3 h-3" /> SKILL.md
            </button>
          </div>

          {showFiles && (
            <div className="rounded-lg bg-muted/20 border border-border p-2 max-h-28 overflow-y-auto">
              {preview.fileList.map(f => <div key={f} className="text-[10px] font-mono text-muted-foreground py-0.5">{f}</div>)}
            </div>
          )}
          {showSkillMd && (
            <div className="rounded-lg bg-muted/20 border border-border p-3 max-h-40 overflow-y-auto">
              <pre className="text-[10px] font-mono text-muted-foreground whitespace-pre-wrap leading-relaxed">{preview.skillMdContent}</pre>
            </div>
          )}
        </div>
      )}

      {/* Install location */}
      {preview && (installState as string) !== "done" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Install location</p>
          {targets.length > 0
            ? <TargetPicker targets={targets} value={target} onChange={setTarget} agentId={agentId} onAgentChange={setAgentId} />
            : <div className="text-xs text-muted-foreground">Loading targets…</div>
          }
        </div>
      )}

      {installState === "error" && installError && <p className="text-sm text-destructive">{installError}</p>}

      {installState === "done" && (
        <div className="rounded-xl border border-green-500/20 bg-green-500/8 px-4 py-3 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-foreground">"{preview?.name}" installed!</p>
            {installedPath && <p className="text-[11px] text-muted-foreground font-mono mt-0.5 break-all">{shortenPath(installedPath)}</p>}
          </div>
        </div>
      )}

      {/* Footer action */}
      {preview && (installState as string) !== "done" && (
        <button onClick={handleInstall} disabled={!canInstall || (installState as string) === "loading"}
          className={cn(
            "flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40",
            preview.security.rating === "danger"
              ? "bg-red-500/10 text-red-400 border border-red-500/20 cursor-not-allowed"
              : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25"
          )}>
          {(installState as string) === "loading"
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Installing…</>
            : preview.security.rating === "danger"
            ? <><ShieldX className="w-3.5 h-3.5" /> Blocked (dangerous)</>
            : <><Download className="w-3.5 h-3.5" /> Install</>
          }
        </button>
      )}
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

type TabId = "clawhub" | "skillsmp"

interface Props {
  onClose: () => void
  onInstalled: (slug: string) => void
}

export function InstallSkillModal({ onClose, onInstalled: _ }: Props) {
  const [tab, setTab]       = useState<TabId>("clawhub")
  const [targets, setTargets] = useState<ClawHubInstallTarget[]>([])

  useEffect(() => {
    api.clawHubTargets().then(d => setTargets(d.targets)).catch(() => {})
  }, [])

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "clawhub",  label: "ClawHub",  icon: "🦞" },
    { id: "skillsmp", label: "SkillsMP", icon: "⚡" },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
              <Package className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Install Skill</h2>
              <p className="text-[11px] text-muted-foreground">From ClawHub or SkillsMP marketplace</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border px-5 shrink-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
          <div className="flex-1 flex items-center justify-end gap-3 pb-1 pt-1">
            <a href={tab === "clawhub" ? "https://clawhub.ai" : "https://skillsmp.com"}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="w-3 h-3" />
              Browse {tab === "clawhub" ? "ClawHub" : "SkillsMP"}
            </a>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "clawhub"
            ? <ClawHubTab targets={targets} />
            : <SkillsmpTab targets={targets} />
          }
        </div>
      </div>
    </div>
  )
}

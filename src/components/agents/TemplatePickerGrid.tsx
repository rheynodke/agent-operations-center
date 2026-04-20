import { useEffect, useState } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"
import { useRoleTemplateStore } from "@/stores"
import type { AgentRoleTemplate, RoleTemplateSummary } from "@/types"
import { ADLC_ROLE_TEMPLATES } from "@/data/agentRoleTemplates"

interface Props {
  onSelect: (template: AgentRoleTemplate) => void
}

/**
 * Phase 1: source templates from the API (`/api/role-templates`), with a
 * static-import fallback so an older server still works. Click fetches the
 * full detail record and hands it to the wizard.
 */
export function TemplatePickerGrid({ onSelect }: Props) {
  const { templates, loading, error, refresh } = useRoleTemplateStore()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [clickError, setClickError] = useState<string | null>(null)

  useEffect(() => { refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback to bundled static templates if the API call failed.
  const usingFallback = !loading && error != null && templates.length === 0
  const source: Array<RoleTemplateSummary | AgentRoleTemplate> = usingFallback
    ? ADLC_ROLE_TEMPLATES
    : templates

  async function handleClick(item: RoleTemplateSummary | AgentRoleTemplate) {
    setClickError(null)
    // Static fallback already has the full record — skip the fetch
    if (usingFallback) {
      onSelect(item as AgentRoleTemplate)
      return
    }
    setLoadingId(item.id)
    try {
      const { template } = await api.getRoleTemplate(item.id)
      onSelect(template as unknown as AgentRoleTemplate)
    } catch (e) {
      setClickError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingId(null)
    }
  }

  if (loading && templates.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading templates…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {usingFallback && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-300/90">
            Showing bundled templates — couldn't reach <code className="font-mono">/api/role-templates</code>
            {error ? ` (${error})` : ""}.
          </p>
        </div>
      )}
      {clickError && (
        <div className="mx-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          {clickError}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 p-4">
        {source.map(item => {
          const adlcNum = "adlcAgentNumber" in item ? item.adlcAgentNumber : null
          const skillCount = "skillCount" in item
            ? item.skillCount
            : (item as AgentRoleTemplate).skillSlugs.length
          const scriptCount = "scriptCount" in item
            ? item.scriptCount
            : (item as AgentRoleTemplate).scriptTemplates.length
          const isLoading = loadingId === item.id
          const color = item.color || "#6366f1"
          return (
            <button
              key={item.id}
              onClick={() => handleClick(item)}
              disabled={isLoading}
              className={cn(
                "text-left p-4 rounded-xl border border-border bg-card hover:bg-foreground/3",
                "transition-all duration-200 hover:border-foreground/15 group relative overflow-hidden",
                "disabled:opacity-60 disabled:cursor-wait",
              )}
              style={{ borderLeftWidth: 4, borderLeftColor: color }}
            >
              {/* Agent number badge */}
              {adlcNum != null && (
                <div
                  className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {adlcNum}
                </div>
              )}
              {isLoading && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center bg-background/80">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Emoji + Role name */}
              <div className="flex items-center gap-2 mb-2 pr-7">
                <span className="text-xl leading-none">{item.emoji || "🧩"}</span>
                <span className="text-sm font-bold text-foreground leading-snug">{item.role}</span>
              </div>

              {/* Model recommendation */}
              {item.modelRecommendation && (
                <p className="text-[10px] text-muted-foreground/60 font-mono mb-2">
                  {item.modelRecommendation}
                </p>
              )}

              {/* Description */}
              <p className="text-[11px] text-muted-foreground leading-snug mb-3 line-clamp-2">
                {item.description}
              </p>

              {/* Skill / script counts */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                <span>{skillCount} skill{skillCount === 1 ? "" : "s"}</span>
                <span>{scriptCount} script{scriptCount === 1 ? "" : "s"}</span>
              </div>

              {/* Claude Code badge for SWE */}
              {item.id === 'swe' && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-[9px] font-bold text-emerald-400">Claude Code ⚡</span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

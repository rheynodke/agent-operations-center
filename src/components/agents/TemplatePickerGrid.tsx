import { cn } from "@/lib/utils"
import type { AgentRoleTemplate } from "@/types"
import { ADLC_ROLE_TEMPLATES } from "@/data/agentRoleTemplates"

interface Props {
  onSelect: (template: AgentRoleTemplate) => void
}

export function TemplatePickerGrid({ onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4">
      {ADLC_ROLE_TEMPLATES.map(template => (
        <button
          key={template.id}
          onClick={() => onSelect(template)}
          className={cn(
            "text-left p-4 rounded-xl border border-border bg-card hover:bg-foreground/3",
            "transition-all duration-200 hover:border-foreground/15 group relative overflow-hidden"
          )}
          style={{ borderLeftWidth: 4, borderLeftColor: template.color }}
        >
          {/* Agent number badge */}
          <div
            className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
            style={{ backgroundColor: template.color }}
          >
            {template.adlcAgentNumber}
          </div>

          {/* Emoji + Role name */}
          <div className="flex items-center gap-2 mb-2 pr-7">
            <span className="text-xl leading-none">{template.emoji}</span>
            <span className="text-sm font-bold text-foreground leading-snug">{template.role}</span>
          </div>

          {/* Model recommendation */}
          <p className="text-[10px] text-muted-foreground/60 font-mono mb-2">
            {template.modelRecommendation}
          </p>

          {/* Description */}
          <p className="text-[11px] text-muted-foreground leading-snug mb-3 line-clamp-2">
            {template.description}
          </p>

          {/* Skill / script counts */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
            <span>{template.skillSlugs.length} skills</span>
            <span>{template.scriptTemplates.length} scripts</span>
          </div>

          {/* Claude Code badge for SWE */}
          {template.id === 'swe' && (
            <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="text-[9px] font-bold text-emerald-400">Claude Code ⚡</span>
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

import { useState } from "react"
import { X, Sparkles, Bot } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AgentRoleTemplate } from "@/types"
import { TemplatePickerGrid } from "./TemplatePickerGrid"

interface Props {
  onSelectTemplate: (template: AgentRoleTemplate) => void
  onSelectBlank: () => void
  onClose: () => void
}

export function TemplateEntryModal({ onSelectTemplate, onSelectBlank, onClose }: Props) {
  const [showGrid, setShowGrid] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)" }}
    >
      <div className={cn(
        "bg-card border border-border rounded-2xl w-full shadow-2xl transition-all duration-300",
        showGrid ? "max-w-2xl" : "max-w-lg"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <div>
            <h2 className="text-base font-bold text-foreground">Buat Agent Baru</h2>
            <p className="text-[11px] text-muted-foreground/70">Pilih cara membuat agent baru.</p>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground/50 hover:text-foreground/70 transition-colors p-1.5 rounded-lg hover:bg-foreground/6"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Two options */}
        <div className="grid grid-cols-2 gap-4 p-6">
          {/* ADLC Template */}
          <button
            onClick={() => setShowGrid(true)}
            className={cn(
              "text-left p-5 rounded-xl border-2 transition-all duration-200",
              showGrid
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-border hover:border-emerald-500/30 hover:bg-foreground/3"
            )}
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <h3 className="font-bold text-foreground text-sm mb-1">ADLC Template</h3>
            <p className="text-[11px] text-muted-foreground leading-snug">
              7 template siap pakai. Skills &amp; identity sudah dikonfigurasi sesuai role.
            </p>
          </button>

          {/* Blank Agent */}
          <button
            onClick={() => { onClose(); onSelectBlank() }}
            className="text-left p-5 rounded-xl border-2 border-border hover:border-foreground/20 hover:bg-foreground/3 transition-all duration-200"
          >
            <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center mb-3">
              <Bot className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-bold text-foreground text-sm mb-1">Blank Agent</h3>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Setup manual dari awal. Fleksibel untuk konfigurasi custom.
            </p>
          </button>
        </div>

        {/* Expandable template picker grid */}
        {showGrid && (
          <div className="border-t border-border">
            <TemplatePickerGrid
              onSelect={(template) => {
                onClose()
                onSelectTemplate(template)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

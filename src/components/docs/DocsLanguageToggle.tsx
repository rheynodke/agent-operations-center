import { Languages } from "lucide-react"
import { useDocsLangStore } from "@/stores/useDocsLangStore"
import type { DocsLang } from "@/stores/useDocsLangStore"
import { cn } from "@/lib/utils"

const OPTIONS: { value: DocsLang; label: string }[] = [
  { value: "id", label: "ID" },
  { value: "en", label: "EN" },
]

export function DocsLanguageToggle() {
  const lang = useDocsLangStore((s) => s.lang)
  const setLang = useDocsLangStore((s) => s.setLang)

  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <Languages className="w-4 h-4 text-muted-foreground" aria-hidden />
      <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setLang(opt.value)}
            className={cn(
              "px-2.5 py-1 text-xs font-medium rounded transition-colors",
              lang === opt.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={lang === opt.value}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

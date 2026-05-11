import { useEffect } from "react"
import { User2, Code2, ShieldCheck } from "lucide-react"
import { useDocsPovStore, type DocsPov } from "@/stores/useDocsPovStore"
import { useAuthStore } from "@/stores"
import { useDocsLangStore } from "@/stores/useDocsLangStore"
import { cn } from "@/lib/utils"

interface PovOption {
  value: DocsPov
  label: { id: string; en: string }
  Icon: typeof User2
  /** Hanya admin role yang lihat opsi ini */
  adminOnly?: boolean
}

const OPTIONS: PovOption[] = [
  { value: "user", label: { id: "User", en: "User" }, Icon: User2 },
  { value: "developer", label: { id: "Developer", en: "Developer" }, Icon: Code2 },
  { value: "admin", label: { id: "Admin", en: "Admin" }, Icon: ShieldCheck, adminOnly: true },
]

export function DocsPovToggle() {
  const pov = useDocsPovStore((s) => s.pov)
  const setPov = useDocsPovStore((s) => s.setPov)
  const lang = useDocsLangStore((s) => s.lang)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === "admin"

  const visibleOptions = isAdmin ? OPTIONS : OPTIONS.filter((o) => !o.adminOnly)

  // Safety: kalau user bukan admin tapi pov-nya 'admin' (mis. demoted), reset ke 'user'.
  useEffect(() => {
    if (!isAdmin && pov === "admin") {
      setPov("user")
    }
  }, [isAdmin, pov, setPov])

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 px-1">
        {lang === "id" ? "Lihat sebagai" : "View as"}
      </p>
      <div
        className="grid gap-1 rounded-md bg-muted/30 border border-border/60 p-1"
        style={{ gridTemplateColumns: `repeat(${visibleOptions.length}, 1fr)` }}
      >
        {visibleOptions.map((opt) => {
          const isActive = opt.value === pov
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPov(opt.value)}
              className={cn(
                "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] font-semibold transition-all min-w-0",
                isActive
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              )}
              aria-pressed={isActive}
            >
              <opt.Icon className="w-3 h-3 shrink-0" aria-hidden />
              <span className="truncate">{opt.label[lang]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

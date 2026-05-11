import { NavLink } from "react-router-dom"
import { cn } from "@/lib/utils"
import { docsManifest } from "@/docs/_manifest"
import { useDocsLangStore } from "@/stores/useDocsLangStore"
import { useDocsPovStore } from "@/stores/useDocsPovStore"
import { DocsLanguageToggle } from "./DocsLanguageToggle"
import { DocsPovToggle } from "./DocsPovToggle"
import { BookOpen, ShieldCheck, Code, Sparkles } from "lucide-react"
import type { DocsAudience } from "@/docs/manifest-types"

const AUDIENCE_ICON: Record<DocsAudience, typeof BookOpen> = {
  all: Sparkles,
  user: BookOpen,
  admin: ShieldCheck,
  developer: Code,
}

const AUDIENCE_PILL: Record<DocsAudience, { id: string; en: string; cls: string }> = {
  all: {
    id: "Semua",
    en: "All",
    cls: "bg-muted text-muted-foreground border-border",
  },
  user: {
    id: "User",
    en: "User",
    cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  admin: {
    id: "Admin",
    en: "Admin",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  developer: {
    id: "Developer",
    en: "Developer",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
}

interface NavItemProps {
  composedSlug: string
  title: string
  isPlaceholder: boolean
  indented?: boolean
}

function NavItem({ composedSlug, title, isPlaceholder, indented }: NavItemProps) {
  return (
    <NavLink
      to={`/docs/${composedSlug}`}
      end
      className={({ isActive }) =>
        cn(
          "relative flex items-center px-3 py-1.5 text-[13px] leading-snug transition-colors rounded-md",
          indented ? "ml-3" : "",
          isActive
            ? "bg-primary/10 text-primary font-semibold"
            : "text-foreground/65 hover:text-foreground hover:bg-foreground/4",
          isPlaceholder && "italic opacity-45 cursor-not-allowed hover:bg-transparent hover:text-foreground/65"
        )
      }
      onClick={(e) => {
        if (isPlaceholder) e.preventDefault()
      }}
      aria-disabled={isPlaceholder}
      title={isPlaceholder ? "Coming soon" : undefined}
    >
      {({ isActive }) => (
        <>
          {isActive && !isPlaceholder && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] bg-primary rounded-r" />
          )}
          <span className="flex-1 truncate">{title}</span>
          {isPlaceholder && <span className="ml-2 text-[9px] uppercase tracking-wider opacity-70">soon</span>}
        </>
      )}
    </NavLink>
  )
}

export function DocsSidebar() {
  const lang = useDocsLangStore((s) => s.lang)
  const pov = useDocsPovStore((s) => s.pov)

  // Filter sections by current POV. 'all' audience always visible.
  const visibleSections = docsManifest.sections.filter(
    (section) => section.audience === "all" || section.audience === pov
  )

  return (
    <div className="flex flex-col gap-3 px-4 py-5">
      {/* Header: Title + Language toggle */}
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          {lang === "id" ? "Dokumentasi" : "Documentation"}
        </h2>
        <DocsLanguageToggle />
      </div>

      {/* POV toggle */}
      <DocsPovToggle />

      <div className="border-b border-border my-1" />

      {visibleSections.length === 0 && (
        <div className="px-3 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {lang === "id"
              ? "Tidak ada konten untuk POV ini."
              : "No content for this POV."}
          </p>
        </div>
      )}

      <nav className="flex flex-col gap-6">
        {visibleSections.map((section) => {
          const Icon = AUDIENCE_ICON[section.audience]
          const pill = AUDIENCE_PILL[section.audience]
          // Only show pill kalau section "universal" — redundant kalau match current POV.
          const showPill = section.audience === "all"

          return (
            <section key={section.slug} className="flex flex-col gap-1.5">
              {/* Section header */}
              <header className="flex items-center gap-2 px-2 mb-1">
                <Icon className="w-3.5 h-3.5 text-foreground/70 shrink-0" aria-hidden />
                <h3 className="flex-1 text-[11px] font-bold uppercase tracking-wider text-foreground/80 truncate">
                  {section.title[lang]}
                </h3>
                {showPill && (
                  <span
                    className={cn(
                      "shrink-0 px-1.5 py-0 rounded text-[9px] font-medium uppercase tracking-wide border",
                      pill.cls
                    )}
                  >
                    {pill[lang]}
                  </span>
                )}
              </header>

              {/* Flat pages directly under section */}
              {section.pages && section.pages.length > 0 && (
                <div className="flex flex-col gap-px">
                  {section.pages.map((page) => (
                    <NavItem
                      key={page.slug}
                      composedSlug={`${section.slug}/${page.slug}`}
                      title={page.title[lang]}
                      isPlaceholder={page.status === "placeholder"}
                    />
                  ))}
                </div>
              )}

              {/* Groups within section */}
              {section.groups?.map((group) => (
                <div key={group.slug} className="flex flex-col gap-px mt-1">
                  <p className="px-3 mt-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {group.title[lang]}
                  </p>
                  {group.pages.map((page) => (
                    <NavItem
                      key={page.slug}
                      composedSlug={`${section.slug}/${group.slug}/${page.slug}`}
                      title={page.title[lang]}
                      isPlaceholder={page.status === "placeholder"}
                      indented
                    />
                  ))}
                </div>
              ))}
            </section>
          )
        })}

        {/* Bottom padding so last item isn't flush with edge */}
        <div className="h-4" aria-hidden />
      </nav>
    </div>
  )
}

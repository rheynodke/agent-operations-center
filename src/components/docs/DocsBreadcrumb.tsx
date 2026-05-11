import { ChevronRight } from "lucide-react"
import { Link } from "react-router-dom"
import { docsManifest } from "@/docs/_manifest"
import { findEntryBySlug } from "@/lib/docs-manifest-walk"
import { useDocsLangStore } from "@/stores/useDocsLangStore"

interface DocsBreadcrumbProps {
  composedSlug: string
}

export function DocsBreadcrumb({ composedSlug }: DocsBreadcrumbProps) {
  const lang = useDocsLangStore((s) => s.lang)
  const entry = findEntryBySlug(docsManifest, composedSlug)
  if (!entry) return null

  const sectionTitle = entry.section.title[lang]
  const groupTitle = entry.group?.title[lang]
  const pageTitle = entry.page.title[lang]

  return (
    <nav aria-label="Breadcrumb" className="not-prose mb-4">
      <ol className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
        <li>
          <Link to="/docs" className="hover:text-foreground">
            Docs
          </Link>
        </li>
        <li className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3" aria-hidden />
          <span>{sectionTitle}</span>
        </li>
        {groupTitle && (
          <li className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3" aria-hidden />
            <span>{groupTitle}</span>
          </li>
        )}
        <li className="flex items-center gap-1">
          <ChevronRight className="w-3 h-3" aria-hidden />
          <span className="text-foreground font-medium">{pageTitle}</span>
        </li>
      </ol>
    </nav>
  )
}

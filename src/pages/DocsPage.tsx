import { useEffect, useMemo, useRef, useState, Suspense } from "react"
import { useParams, Navigate } from "react-router-dom"
import { MDXProvider } from "@mdx-js/react"
import { docsManifest } from "@/docs/_manifest"
import { findEntryBySlug } from "@/lib/docs-manifest-walk"
import { fetchDocModule, loadDocPage } from "@/lib/docs-loader"
import { mdxComponents } from "@/docs/components/mdx-components"
import { useDocsLangStore } from "@/stores/useDocsLangStore"
import { useDocsTocStore } from "@/stores/useDocsTocStore"
import { cn } from "@/lib/utils"
import { DocsSidebar } from "@/components/docs/DocsSidebar"
import { DocsTOC } from "@/components/docs/DocsTOC"
import { DocsBreadcrumb } from "@/components/docs/DocsBreadcrumb"
import { DocsContentSkeleton } from "@/components/docs/DocsContentSkeleton"
import { Globe } from "lucide-react"
import type { TocEntry } from "@/docs/manifest-types"

function FallbackBanner({ targetLang }: { targetLang: "id" | "en" }) {
  const isEn = targetLang === "en"
  return (
    <div className="not-prose flex items-start gap-3 mb-5 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100 text-sm">
      <Globe className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
      <p className="leading-relaxed">
        {isEn
          ? "This page hasn't been translated to English yet — showing the Indonesian version."
          : "Halaman ini belum tersedia dalam bahasa pilihan — menampilkan versi default."}
      </p>
    </div>
  )
}

function DocsNotFound({ slug }: { slug: string }) {
  return (
    <div className="not-prose">
      <h1 className="text-2xl font-semibold mb-2">404 — Halaman tidak ditemukan</h1>
      <p className="text-muted-foreground">
        Slug <code className="px-1 py-0.5 rounded bg-muted text-sm">{slug}</code> tidak ada di manifest atau filesystem.
      </p>
    </div>
  )
}

export function DocsPage() {
  const params = useParams<{ "*": string }>()
  const slug = params["*"] ?? ""
  const lang = useDocsLangStore((s) => s.lang)
  const tocCollapsed = useDocsTocStore((s) => s.collapsed)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [fallbackUsed, setFallbackUsed] = useState(false)
  const mainRef = useRef<HTMLElement | null>(null)

  // Scroll content area to top on navigation
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [slug, lang])

  // CRITICAL: memoize loadDocPage — it returns a new React.lazy() each call,
  // which would cause unmount/remount + re-suspend on every render without this.
  // Also: all hooks must run before any early return (rules of hooks).
  const loaded = useMemo(() => (slug ? loadDocPage(slug, lang) : null), [slug, lang])

  // Fetch frontmatter + toc for the loaded module
  useEffect(() => {
    let cancelled = false
    if (!loaded) {
      setToc([])
      setFallbackUsed(false)
      return
    }
    fetchDocModule(slug, lang).then((res) => {
      if (cancelled || !res) return
      setToc(res.module.toc ?? [])
      setFallbackUsed(res.fallbackUsed)
    })
    return () => {
      cancelled = true
    }
  }, [slug, lang, loaded])

  // Redirect /docs to manifest.defaultPage (after hooks — rules of hooks).
  if (!slug) {
    return <Navigate to={`/docs/${docsManifest.defaultPage}`} replace />
  }

  const manifestEntry = findEntryBySlug(docsManifest, slug)
  const isPlaceholder = manifestEntry?.page.status === "placeholder"

  return (
    <div
      className={cn(
        "grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] h-full overflow-hidden transition-[grid-template-columns] duration-200",
        tocCollapsed
          ? "xl:grid-cols-[280px_minmax(0,1fr)_56px]"
          : "xl:grid-cols-[280px_minmax(0,1fr)_240px]"
      )}
    >
      {/* Left rail: sidebar (independent scroll) */}
      <aside className="hidden lg:block border-r border-border overflow-y-auto bg-sidebar/50">
        <DocsSidebar />
      </aside>

      {/* Main content (independent scroll) */}
      <main ref={mainRef} className="overflow-y-auto">
        <div className="px-6 md:px-10 py-6 md:py-8">
          <article className="prose prose-neutral dark:prose-invert max-w-3xl mx-auto w-full">
            <DocsBreadcrumb composedSlug={slug} />

            {fallbackUsed && <FallbackBanner targetLang={lang} />}

            <Suspense key={`${slug}-${lang}`} fallback={<DocsContentSkeleton />}>
              {loaded ? (
                <MDXProvider components={mdxComponents}>
                  <loaded.Component />
                </MDXProvider>
              ) : isPlaceholder ? (
                <div className="not-prose">
                  <h1 className="text-2xl font-semibold mb-2">
                    {manifestEntry?.page.title[lang]}
                  </h1>
                  <p className="text-muted-foreground">
                    {lang === "id"
                      ? "Halaman ini sedang dalam penulisan."
                      : "This page is being written."}
                  </p>
                </div>
              ) : (
                <DocsNotFound slug={slug} />
              )}
            </Suspense>
          </article>
        </div>
      </main>

      {/* Right rail: TOC (independent scroll, collapsible) */}
      <aside
        className={cn(
          "hidden xl:block border-l border-border overflow-y-auto",
          !tocCollapsed && "px-4 py-6"
        )}
      >
        <DocsTOC toc={toc} />
      </aside>
    </div>
  )
}

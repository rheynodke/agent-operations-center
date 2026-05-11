import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { TocEntry } from "@/docs/manifest-types"
import { useDocsLangStore } from "@/stores/useDocsLangStore"
import { useDocsTocStore } from "@/stores/useDocsTocStore"
import { PanelRightOpen, PanelRightClose } from "lucide-react"

interface DocsTOCProps {
  toc: TocEntry[]
}

interface FlatEntry {
  id: string
  value: string
  depth: number
}

function flatten(entries: TocEntry[], maxDepth = 3, acc: FlatEntry[] = []): FlatEntry[] {
  for (const e of entries) {
    if (e.depth >= 2 && e.depth <= maxDepth) {
      acc.push({ id: e.id, value: e.value, depth: e.depth })
    }
    if (e.children) flatten(e.children, maxDepth, acc)
  }
  return acc
}

export function DocsTOC({ toc }: DocsTOCProps) {
  const flat = flatten(toc)
  const [activeId, setActiveId] = useState<string | null>(null)
  const lang = useDocsLangStore((s) => s.lang)
  const collapsed = useDocsTocStore((s) => s.collapsed)
  const toggle = useDocsTocStore((s) => s.toggle)

  useEffect(() => {
    if (flat.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: [0, 1] }
    )
    flat.forEach((entry) => {
      const el = document.getElementById(entry.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [flat])

  if (flat.length === 0) return null

  // ── Collapsed state: thin icon strip with vertical "On This Page" label ──
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="group w-full flex flex-col items-center pt-3 pb-3 gap-3 text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        title={lang === "id" ? "Tampilkan daftar isi" : "Show outline"}
        aria-label={lang === "id" ? "Tampilkan daftar isi" : "Show outline"}
      >
        <span className="rounded-md p-1.5 ring-1 ring-border group-hover:ring-primary/40 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
          <PanelRightOpen className="w-3.5 h-3.5" aria-hidden />
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 group-hover:text-foreground"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {lang === "id" ? "Daftar Isi" : "On This Page"}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/50">
          {flat.length}
        </span>
      </button>
    )
  }

  // ── Expanded state: full TOC ──
  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {lang === "id" ? "Di Halaman Ini" : "On This Page"}
        </p>
        <button
          type="button"
          onClick={toggle}
          className="p-1 -mr-1 rounded text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors shrink-0"
          title={lang === "id" ? "Sembunyikan daftar isi" : "Collapse outline"}
          aria-label={lang === "id" ? "Sembunyikan daftar isi" : "Collapse outline"}
        >
          <PanelRightClose className="w-3.5 h-3.5" />
        </button>
      </div>
      <ul className="space-y-1 text-sm border-l border-border">
        {flat.map((entry) => (
          <li key={entry.id} style={{ paddingLeft: `${(entry.depth - 2) * 12}px` }}>
            <a
              href={`#${entry.id}`}
              className={cn(
                "block -ml-px pl-3 border-l-2 border-transparent transition-colors leading-snug py-1 text-[13px]",
                activeId === entry.id
                  ? "border-primary text-primary font-semibold"
                  : "text-foreground/55 hover:text-foreground"
              )}
            >
              {entry.value}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

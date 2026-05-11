import React from "react"
import type { DocsLang } from "@/stores/useDocsLangStore"
import type { TocEntry } from "@/docs/manifest-types"

interface MdxModule {
  default: React.ComponentType
  frontmatter?: {
    title?: string
    description?: string
    updated?: string
    tags?: string[]
  }
  toc?: TocEntry[]
}

// Vite scans this glob at build-time; result keys are absolute paths from project root.
const modules = import.meta.glob<MdxModule>("/src/docs/pages/**/*.{id,en}.mdx")

export interface LoadedDoc {
  Component: React.LazyExoticComponent<React.ComponentType>
  loader: () => Promise<MdxModule>
  fallbackUsed: boolean
}

export function loadDocPage(slug: string, lang: DocsLang): LoadedDoc | null {
  const primary = `/src/docs/pages/${slug}.${lang}.mdx`
  const fallbackPath = `/src/docs/pages/${slug}.id.mdx`

  const primaryLoader = modules[primary]
  const fallbackLoader = modules[fallbackPath]

  const loader = primaryLoader ?? fallbackLoader
  if (!loader) return null

  const fallbackUsed = !primaryLoader && lang !== "id"

  return {
    loader,
    Component: React.lazy(async () => {
      const mod = await loader()
      return { default: mod.default }
    }),
    fallbackUsed,
  }
}

/** Eagerly fetch the module to access frontmatter + toc (used by DocsPage). */
export async function fetchDocModule(
  slug: string,
  lang: DocsLang
): Promise<{ module: MdxModule; fallbackUsed: boolean } | null> {
  const primary = `/src/docs/pages/${slug}.${lang}.mdx`
  const fallbackPath = `/src/docs/pages/${slug}.id.mdx`
  const primaryLoader = modules[primary]
  const fallbackLoader = modules[fallbackPath]
  const loader = primaryLoader ?? fallbackLoader
  if (!loader) return null
  const module = await loader()
  return {
    module,
    fallbackUsed: !primaryLoader && lang !== "id",
  }
}

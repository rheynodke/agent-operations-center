import type { DocsManifest, ResolvedDocsEntry } from "@/docs/manifest-types"

/** Walk every page in the manifest in display order, yielding composed slugs. */
export function* walkManifest(manifest: DocsManifest): Generator<ResolvedDocsEntry> {
  for (const section of manifest.sections) {
    if (section.groups) {
      for (const group of section.groups) {
        for (const page of group.pages) {
          yield {
            composedSlug: `${section.slug}/${group.slug}/${page.slug}`,
            section,
            group,
            page,
          }
        }
      }
    }
    if (section.pages) {
      for (const page of section.pages) {
        yield {
          composedSlug: `${section.slug}/${page.slug}`,
          section,
          page,
        }
      }
    }
  }
}

/** Find a manifest entry by its composed slug. Returns null if not found. */
export function findEntryBySlug(
  manifest: DocsManifest,
  composedSlug: string
): ResolvedDocsEntry | null {
  for (const entry of walkManifest(manifest)) {
    if (entry.composedSlug === composedSlug) return entry
  }
  return null
}

/** Return prev + next entries for a given composed slug (for prev/next nav). */
export function getNeighbors(
  manifest: DocsManifest,
  composedSlug: string
): { prev: ResolvedDocsEntry | null; next: ResolvedDocsEntry | null } {
  const all = Array.from(walkManifest(manifest)).filter(
    (e) => e.page.status !== "placeholder"
  )
  const idx = all.findIndex((e) => e.composedSlug === composedSlug)
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: idx > 0 ? all[idx - 1] : null,
    next: idx < all.length - 1 ? all[idx + 1] : null,
  }
}

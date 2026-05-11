export type DocsLocale = "id" | "en"
export type DocsLocalizedString = Record<DocsLocale, string>

export type DocsAudience = "all" | "user" | "admin" | "developer"
export type DocsPageStatus = "ready" | "draft" | "placeholder"

export interface DocsPageEntry {
  /** Leaf segment, e.g. 'provisioning' or 'multi-tenant' */
  slug: string
  title: DocsLocalizedString
  status?: DocsPageStatus
}

export interface DocsGroup {
  /** Group segment, e.g. 'agents' */
  slug: string
  title: DocsLocalizedString
  pages: DocsPageEntry[]
}

export interface DocsSection {
  /** Section segment, e.g. 'user-guide' */
  slug: string
  title: DocsLocalizedString
  audience: DocsAudience
  groups?: DocsGroup[]
  pages?: DocsPageEntry[]
}

export interface DocsManifest {
  /** Composed slug to redirect /docs to, e.g. 'getting-started/welcome' */
  defaultPage: string
  sections: DocsSection[]
}

/** Resolved entry returned by manifest walkers */
export interface ResolvedDocsEntry {
  composedSlug: string
  section: DocsSection
  group?: DocsGroup
  page: DocsPageEntry
}

export interface TocEntry {
  id: string
  value: string
  depth: number
  children?: TocEntry[]
}

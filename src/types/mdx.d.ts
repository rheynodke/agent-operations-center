declare module "*.mdx" {
  import type { ComponentType } from "react"

  export const frontmatter: {
    title?: string
    description?: string
    updated?: string
    tags?: string[]
  }

  export interface TocEntry {
    id: string
    value: string
    depth: number
    children?: TocEntry[]
  }

  export const toc: TocEntry[]

  const Component: ComponentType
  export default Component
}

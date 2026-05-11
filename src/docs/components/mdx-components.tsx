import { Link } from "react-router-dom"
import type { MDXComponents } from "mdx/types"
import { Callout } from "./Callout"
import { Steps, Step } from "./Steps"
import { Screenshot } from "./Screenshot"
import { KeyboardShortcut } from "./KeyboardShortcut"
import { ConceptLink } from "./ConceptLink"
import { Tabs, Tab } from "./Tabs"
import {
  Mockup,
  MockupToolbar,
  MockupInput,
  MockupDropdown,
  MockupButton,
  MockupGrid,
  MockupAgentCard,
  MockupStatusPill,
  MockupStatusFilter,
  MockupTabBar,
  MockupActionMenu,
  MockupBox,
  MockupArrow,
  MockupFlow,
  MockupKanban,
  MockupKanbanColumn,
  MockupTaskCard,
  StatusDot,
} from "./Mockup"

export const mdxComponents: MDXComponents = {
  // Themed HTML
  h1: (props) => <h1 className="text-3xl font-bold mt-0 mb-4" {...props} />,
  h2: (props) => (
    <h2 className="text-2xl font-semibold mt-8 mb-3 scroll-mt-20" {...props} />
  ),
  h3: (props) => (
    <h3 className="text-xl font-semibold mt-6 mb-2 scroll-mt-20" {...props} />
  ),
  h4: (props) => <h4 className="text-base font-semibold mt-5 mb-2" {...props} />,
  p: (props) => <p className="my-3 leading-relaxed" {...props} />,
  ul: (props) => <ul className="my-3 list-disc pl-6 space-y-1" {...props} />,
  ol: (props) => <ol className="my-3 list-decimal pl-6 space-y-1" {...props} />,
  li: (props) => <li className="leading-relaxed" {...props} />,
  a: ({ href, ...rest }) => {
    if (!href) return <a {...rest} />
    const cls =
      "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary transition-colors"
    if (href.startsWith("#")) {
      return <a href={href} className={cls} {...rest} />
    }
    if (href.startsWith("/")) {
      return <Link to={href} className={cls} {...rest} />
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        {...rest}
      />
    )
  },
  code: (props) => (
    <code
      className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono before:content-none after:content-none"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="rounded-lg overflow-x-auto p-4 my-4 bg-muted text-sm leading-relaxed"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-4 border-l-4 border-border pl-4 italic text-muted-foreground"
      {...props}
    />
  ),
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="border-b border-border bg-muted/50" {...props} />,
  th: (props) => <th className="text-left font-semibold px-3 py-2" {...props} />,
  td: (props) => <td className="px-3 py-2 border-b border-border/60" {...props} />,
  hr: (props) => <hr className="my-6 border-border" {...props} />,
  // Custom
  Callout,
  Steps,
  Step,
  Screenshot,
  KeyboardShortcut,
  ConceptLink,
  Tabs,
  Tab,
  // Mockup family — visual UI mockups
  Mockup,
  MockupToolbar,
  MockupInput,
  MockupDropdown,
  MockupButton,
  MockupGrid,
  MockupAgentCard,
  MockupStatusPill,
  MockupStatusFilter,
  MockupTabBar,
  MockupActionMenu,
  MockupBox,
  MockupArrow,
  MockupFlow,
  MockupKanban,
  MockupKanbanColumn,
  MockupTaskCard,
  StatusDot,
}

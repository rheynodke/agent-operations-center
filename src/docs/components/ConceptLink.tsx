import { Link } from "react-router-dom"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface ConceptLinkProps {
  to: string
  children: ReactNode
  className?: string
}

export function ConceptLink({ to, children, className }: ConceptLinkProps) {
  const isExternal = !to.startsWith("/")
  if (isExternal) {
    return (
      <a
        href={to}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "text-primary font-medium underline decoration-primary/40 decoration-dotted underline-offset-4 hover:decoration-primary hover:decoration-solid",
          className
        )}
      >
        {children}
      </a>
    )
  }
  return (
    <Link
      to={to}
      className={cn(
        "text-primary font-medium underline decoration-primary/40 decoration-dotted underline-offset-4 hover:decoration-primary hover:decoration-solid cursor-help",
        className
      )}
      title="Internal cross-reference"
    >
      {children}
    </Link>
  )
}

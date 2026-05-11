import { Children, isValidElement, cloneElement } from "react"
import type { ReactNode, ReactElement } from "react"
import { cn } from "@/lib/utils"

interface StepsProps {
  children: ReactNode
}

interface StepProps {
  title?: string
  children: ReactNode
  /** Auto-injected by <Steps>. Don't pass manually. */
  _index?: number
}

export function Steps({ children }: StepsProps) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<StepProps>[]
  return (
    <ol className="my-5 ml-0 pl-0 space-y-5 list-none border-l-2 border-border">
      {items.map((child, idx) =>
        cloneElement(child, { _index: idx + 1, key: idx })
      )}
    </ol>
  )
}

export function Step({ title, children, _index }: StepProps) {
  return (
    <li className="relative pl-10 -ml-px">
      <span
        className={cn(
          "absolute left-0 top-0 -translate-x-1/2",
          "flex items-center justify-center w-7 h-7 rounded-full",
          "bg-primary text-primary-foreground text-xs font-semibold",
          "ring-4 ring-background"
        )}
      >
        {_index ?? "?"}
      </span>
      {title && <p className="font-semibold mb-1 mt-0">{title}</p>}
      <div className="text-sm leading-relaxed [&>p]:my-2 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {children}
      </div>
    </li>
  )
}

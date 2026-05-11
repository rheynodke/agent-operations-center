import * as RadixTabs from "@radix-ui/react-tabs"
import { Children, isValidElement, useMemo } from "react"
import type { ReactNode, ReactElement } from "react"
import { cn } from "@/lib/utils"

interface TabsProps {
  children: ReactNode
  defaultLabel?: string
}

interface TabProps {
  label: string
  children: ReactNode
}

export function Tabs({ children, defaultLabel }: TabsProps) {
  const tabs = useMemo(
    () =>
      (Children.toArray(children).filter(isValidElement) as ReactElement<TabProps>[]).map(
        (child) => ({ label: child.props.label, content: child.props.children })
      ),
    [children]
  )

  if (tabs.length === 0) return null

  const initial = defaultLabel && tabs.some((t) => t.label === defaultLabel)
    ? defaultLabel
    : tabs[0].label

  return (
    <RadixTabs.Root defaultValue={initial} className="my-5">
      <RadixTabs.List className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <RadixTabs.Trigger
            key={tab.label}
            value={tab.label}
            className={cn(
              "px-3 py-1.5 text-sm font-medium text-muted-foreground",
              "border-b-2 border-transparent -mb-px",
              "data-[state=active]:text-foreground data-[state=active]:border-primary",
              "transition-colors hover:text-foreground"
            )}
          >
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content
          key={tab.label}
          value={tab.label}
          className="pt-3 [&>*:first-child]:mt-0"
        >
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function Tab(_props: TabProps) {
  // Tab is a slot — content extracted by <Tabs> via Children iteration.
  return null
}

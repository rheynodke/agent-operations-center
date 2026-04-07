import { AgentWorldView } from "@/components/world/AgentWorldView"

export function AgentWorldPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Agent World</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Live view of your agents — who's working, who's wandering.
        </p>
      </div>
      <AgentWorldView />
    </div>
  )
}

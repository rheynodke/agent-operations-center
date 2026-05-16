import { HardDrive, Cpu, Activity, MessageSquare } from "lucide-react"
import { KpiCard } from "@/components/metrics/KpiCard"
import type { GatewayAggregate } from "@/types"

interface ClusterKPIsProps {
  data: GatewayAggregate | null
  loading?: boolean
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function ClusterKPIs({ data, loading }: ClusterKPIsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Total RSS"
        value={loading || !data ? "—" : `${round1(data.totalRssMb).toLocaleString()} MB`}
        deltaPct={data && data.deltaRssPercent != null ? round1(data.deltaRssPercent) : null}
        icon={HardDrive}
        tone="violet"
        invertGood
        loading={loading}
        compareLabel="vs previous window"
      />
      <KpiCard
        label="Avg CPU"
        value={loading || !data ? "—" : `${round1(data.avgCpuPercent)}%`}
        deltaPct={data && data.deltaCpuPercent != null ? round1(data.deltaCpuPercent) : null}
        icon={Cpu}
        tone="amber"
        invertGood
        loading={loading}
        compareLabel="vs previous window"
      />
      <KpiCard
        label="Running"
        value={loading || !data ? "—" : `${data.runningCount} / ${data.totalCount}`}
        icon={Activity}
        tone="emerald"
        loading={loading}
        compareLabel="gateways live"
      />
      <KpiCard
        label="Messages 24h"
        value={loading || !data ? "—" : data.totalMessages24h.toLocaleString()}
        icon={MessageSquare}
        tone="blue"
        loading={loading}
        compareLabel="cluster-wide"
      />
    </div>
  )
}

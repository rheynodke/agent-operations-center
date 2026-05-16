/**
 * Shared chart palette + theme tokens for the Gateway Metrics dashboard.
 * Picks a stable color per userId via a deterministic hash so the same user
 * keeps the same line color as the range / filter changes.
 */

export const USER_PALETTE = [
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fbbf24', // amber
  '#60a5fa', // blue
  '#f472b6', // pink
  '#fb923c', // orange
  '#22d3ee', // cyan
  '#a3e635', // lime
] as const

export function colorForUser(userId: number): string {
  return USER_PALETTE[Math.abs(userId) % USER_PALETTE.length]
}

export interface ChartThemeTokens {
  gridColor: string
  axisColor: string
  tooltipBg: string
  tooltipBorder: string
}

export function chartTheme(isDark: boolean): ChartThemeTokens {
  return {
    gridColor: isDark ? '#ffffff10' : '#00000010',
    axisColor: isDark ? '#ffffff60' : '#00000080',
    tooltipBg: isDark ? '#1a1a1a' : '#ffffff',
    tooltipBorder: isDark ? '#ffffff20' : '#00000015',
  }
}

export function formatTsAxis(ts: number, bucketMs: number): string {
  const d = new Date(ts)
  // For sub-day buckets show HH:mm, for >= 1d show MMM dd
  if (bucketMs < 86_400_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

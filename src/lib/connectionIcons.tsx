/**
 * Shared connection type icon helpers.
 *
 * Brand assets live in /public/connections_icon. GitHub has separate light/dark
 * glyphs; everything else is theme-neutral. Falls back to a Lucide icon when
 * we don't have an asset (e.g. composio).
 */
import React from "react"
import {
  Plug, Cloud, Database, Server, Globe, GitBranch, Box, FileText, Workflow,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useThemeStore } from "@/stores"

const CONN_ICON_BASE = "/connections_icon"

export function getConnectionTypeImage(type: string, theme: 'light' | 'dark'): string | null {
  switch (type) {
    case "bigquery": return `${CONN_ICON_BASE}/bigquery.svg`
    case "postgres": return `${CONN_ICON_BASE}/postgres.jpg`
    case "ssh": return `${CONN_ICON_BASE}/vps.png`
    case "website": return `${CONN_ICON_BASE}/website.png`
    case "github": return theme === 'dark' ? `${CONN_ICON_BASE}/github-white.webp` : `${CONN_ICON_BASE}/github-black.png`
    case "odoocli": return `${CONN_ICON_BASE}/odoo.webp`
    case "google_workspace": return `${CONN_ICON_BASE}/google.webp`
    case "mcp": return `${CONN_ICON_BASE}/mcp.png`
    default: return null
  }
}

const FALLBACK_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  bigquery: Cloud,
  postgres: Database,
  ssh: Server,
  website: Globe,
  github: GitBranch,
  odoocli: Box,
  google_workspace: FileText,
  mcp: Workflow,
}

export const CONNECTION_TYPE_LABELS: Record<string, string> = {
  bigquery: "Google BigQuery",
  postgres: "PostgreSQL",
  ssh: "VPS / SSH",
  website: "Website / Service",
  github: "GitHub Repo",
  odoocli: "Odoo (XML-RPC)",
  google_workspace: "Google Workspace",
  mcp: "MCP Server",
  composio: "Composio",
}

export function ConnectionTypeIcon({
  type,
  size = 40,
  rounded = "rounded-lg",
  className,
}: {
  type: string
  size?: number
  rounded?: string
  className?: string
}) {
  const theme = useThemeStore(s => s.theme)
  const src = getConnectionTypeImage(type, theme)
  const Fallback = FALLBACK_ICON[type] || Plug
  return (
    <div
      className={cn("flex items-center justify-center shrink-0 overflow-hidden", rounded, className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={type}
          className="object-contain"
          style={{ width: size * 0.7, height: size * 0.7 }}
          draggable={false}
        />
      ) : (
        <Fallback className="h-1/2 w-1/2 text-muted-foreground" />
      )}
    </div>
  )
}

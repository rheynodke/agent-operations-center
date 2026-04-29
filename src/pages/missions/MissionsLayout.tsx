// Shared layout for /missions/* pages. Horizontal sub-nav flips between the
// Missions list (primary) and the Playbooks library (secondary, more admin-y).
// Hidden on nested detail pages (mission canvas, playbook editor) — those are
// full-screen with their own back button.

import { NavLink, Outlet, useLocation } from "react-router-dom"
import { Target, Layers } from "lucide-react"
import { cn } from "@/lib/utils"

const TABS = [
  { to: "/missions", label: "Missions", icon: Target, end: true },
  { to: "/missions/playbooks", label: "Playbooks", icon: Layers, end: false },
] as const

export function MissionsLayout() {
  const { pathname } = useLocation()
  const isMissionDetail =
    pathname.startsWith("/missions/") &&
    pathname !== "/missions/playbooks" &&
    !pathname.startsWith("/missions/playbooks/")
  const isPlaybookEditor = /^\/missions\/playbooks\/[^/]+/.test(pathname)
  const isNestedDetail = isMissionDetail || isPlaybookEditor

  return (
    <div className="flex flex-col h-full">
      {!isNestedDetail && (
        <div className="flex items-center gap-4 px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mr-2">
            <Target className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">Missions</span>
          </div>
          <nav className="flex items-center gap-1">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </NavLink>
              )
            })}
          </nav>
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  )
}

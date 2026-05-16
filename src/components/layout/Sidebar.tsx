import { NavLink, useLocation } from "react-router-dom"
import { useEffect } from "react"
import {
  LayoutDashboard,
  Bot,
  BarChart3,
  Activity,
  Timer,
  Settings,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  BookText,
  IdCard,
  MessageSquare,
  MessageCircle,
  Cable,
  Webhook,
  Plug,
  Users,
  FolderGit2,
  Megaphone,
  Lock,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAlertStore, useWsStore, useAuthStore } from "@/stores"
import { useThemeStore } from "@/stores/useThemeStore"
import { AgentLogo } from "@/components/AgentLogo"

const navGroups = [
  {
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
    ],
  },
  {
    label: "Workforce",
    items: [
      { to: "/agents", label: "Agents", icon: Bot },
      { to: "/chat", label: "Chat", icon: MessageSquare },
      { to: "/projects", label: "Projects", icon: FolderGit2 },
      { to: "/sessions", label: "Sessions", icon: Activity },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/cron", label: "Schedules", icon: Timer },
      { to: "/hooks", label: "Webhooks", icon: Webhook },
    ],
  },
  {
    label: "Channels",
    items: [
      { to: "/routing", label: "Channel Routing", icon: Cable },
      { to: "/embeds", label: "Embeds", icon: MessageCircle },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/skills", label: "Skills & Tools", icon: BookOpen },
      { to: "/roles", label: "Role Templates", icon: IdCard, adminOnly: true },
      { to: "/connections", label: "Connections", icon: Plug },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/gateway-metrics", label: "Gateway Metrics", icon: BarChart3, adminOnly: true },
    ],
  },
]

export function Sidebar() {
  const location = useLocation()
  const alertsStore = useAlertStore((s) => s.alerts)
  const alerts = alertsStore.filter((a) => !a.acknowledged)
  const wsStatus = useWsStore((s) => s.status)
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "admin"
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, setMobileNavOpen } = useThemeStore()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, setMobileNavOpen])

  return (
    <>
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={cn(
          "flex flex-col h-full py-4 bg-sidebar border-r border-sidebar-border transition-all duration-200 ease-in-out overflow-hidden",
          // Mobile: fixed overlay, slide in/out
          "fixed inset-y-0 left-0 z-50 w-56 px-3",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, width by collapse state
          "md:relative md:inset-auto md:z-auto md:translate-x-0 md:shrink-0",
          sidebarCollapsed ? "md:w-[56px] md:px-2" : "md:w-56 md:px-3",
        )}
      >
        {/* Mobile close button */}
        <button
          className="md:hidden absolute top-3 right-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          onClick={() => setMobileNavOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Logo & App Name */}
        <div
          className={cn(
            "flex items-center mb-4 lg:mb-6 shrink-0 transition-all duration-200",
            sidebarCollapsed ? "md:justify-center md:px-0 gap-3 px-2" : "gap-3 px-2"
          )}
        >
          <div className="relative flex items-center justify-center shrink-0">
            <AgentLogo className="w-10 h-10" />
            {wsStatus === "connected" && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-status-active-text pulse-dot ring-2 ring-sidebar" />
            )}
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col justify-center overflow-hidden">
              <p className="font-display text-[13px] font-bold text-foreground leading-tight tracking-tight whitespace-nowrap">Agent Ops</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 whitespace-nowrap">Operations Center</p>
            </div>
          )}
        </div>

        {/* Nav — scrollable so all items reach when viewport is short (e.g. 768px) */}
        <nav className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto">
          {navGroups.map((group, gi) => (
            <div key={gi} className={cn("flex flex-col gap-0.5", gi > 0 && "mt-3")}>
              {group.label && !sidebarCollapsed && (
                <p className="px-2.5 mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
                  {group.label}
                </p>
              )}
              {gi > 0 && sidebarCollapsed && (
                <div className="mx-auto w-4 border-t border-sidebar-border mb-1" />
              )}
              {group.items.map((item) => {
                const { to, label, icon: Icon } = item
                const adminOnly = (item as { adminOnly?: boolean }).adminOnly === true
                const locked = adminOnly && !isAdmin
                const isActive =
                  to === "/" ? location.pathname === "/" : location.pathname.startsWith(to)
                if (locked) {
                  // Muted, non-clickable. Tooltip explains why.
                  return (
                    <div
                      key={to}
                      title={sidebarCollapsed ? `${label} — admin only` : "Admin only"}
                      aria-disabled="true"
                      className={cn(
                        "group relative flex items-center gap-2.5 py-2 rounded-lg text-sm cursor-not-allowed select-none",
                        sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                        "text-muted-foreground/40"
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="flex-1">{label}</span>
                          <Lock className="h-3 w-3 text-muted-foreground/40" />
                        </>
                      )}
                      {sidebarCollapsed && (
                        <Lock className="absolute top-1 right-1 h-2.5 w-2.5 text-muted-foreground/40" />
                      )}
                    </div>
                  )
                }
                return (
                  <NavLink
                    key={to}
                    to={to}
                    title={sidebarCollapsed ? label : undefined}
                    className={cn(
                      "group relative flex items-center gap-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                      sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                      isActive
                        ? "bg-surface-high text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0 transition-colors",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1">{label}</span>
                        {label === "Channel Routing" && alerts.length > 0 && (
                          <span className="flex items-center justify-center h-4 min-w-4 rounded-full bg-destructive/20 text-destructive text-[10px] font-bold px-1">
                            {alerts.length}
                          </span>
                        )}
                        {isActive && (
                          <ChevronRight className="h-3 w-3 text-primary/50" />
                        )}
                      </>
                    )}
                    {sidebarCollapsed && label === "Channel Routing" && alerts.length > 0 && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-destructive" />
                    )}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="flex flex-col gap-0.5 mt-2 pt-3 border-t border-sidebar-border">
          <NavLink
            to="/docs"
            title={sidebarCollapsed ? "Docs" : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                isActive
                  ? "bg-surface-high text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )
            }
          >
            <BookText className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>Docs</span>}
          </NavLink>
          {isAdmin && (
            <NavLink
              to="/announcements"
              title={sidebarCollapsed ? "Announcements" : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                  sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                  isActive
                    ? "bg-surface-high text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )
              }
            >
              <Megaphone className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>Announcements</span>}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/users"
              title={sidebarCollapsed ? "Users" : undefined}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                  sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                  isActive
                    ? "bg-surface-high text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )
              }
            >
              <Users className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span>Users</span>}
            </NavLink>
          )}
          {isAdmin && (
          <NavLink
            to="/settings"
            title={sidebarCollapsed ? "Settings" : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 py-2 rounded-lg text-sm transition-all duration-150",
                sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5",
                isActive
                  ? "bg-surface-high text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              )
            }
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>Settings</span>}
          </NavLink>
          )}

          <button
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center gap-2.5 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-150",
              sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5"
            )}
          >
            {sidebarCollapsed
              ? <PanelLeftOpen className="h-4 w-4 shrink-0" />
              : <PanelLeftClose className="h-4 w-4 shrink-0" />
            }
            {!sidebarCollapsed && <span className="text-xs">Collapse</span>}
          </button>

          <div className={cn("flex items-center gap-2 py-2", sidebarCollapsed ? "md:justify-center md:px-0 px-2.5" : "px-2.5")}>
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                wsStatus === "connected" && "bg-status-active-text pulse-dot",
                wsStatus === "connecting" && "bg-status-paused-text",
                wsStatus === "disconnected" && "bg-status-idle-text",
                wsStatus === "error" && "bg-status-error-text"
              )}
            />
            {!sidebarCollapsed && (
              <span className="text-[10px] text-muted-foreground capitalize">{wsStatus}</span>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}

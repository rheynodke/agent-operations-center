import { Bell, Zap, LogOut, Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAlertStore, useAuthStore, useLiveFeedStore, useThemeStore, useWsStore } from "@/stores"
import { cn } from "@/lib/utils"

export function TopBar() {
  const allAlerts = useAlertStore((s) => s.alerts)
  const unreadAlerts = allAlerts.filter((a) => !a.acknowledged)
  const { clearAuth, user } = useAuthStore()
  const { toggleFeed, isOpen } = useLiveFeedStore()
  const { theme, toggleTheme } = useThemeStore()
  const wsStatus = useWsStore((s) => s.status)

  return (
    <header className="flex items-center justify-between h-12 px-6 shrink-0 border-b border-border/50">
      {/* Left: connection status */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            wsStatus === "connected" && "bg-emerald-500 pulse-dot",
            wsStatus === "connecting" && "bg-amber-500",
            wsStatus === "disconnected" && "bg-white/20",
            wsStatus === "error" && "bg-red-500"
          )}
        />
        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
          {wsStatus === "connected" ? "Live" : wsStatus}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="text-muted-foreground mr-1"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* Live Feed Toggle */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleFeed}
          className={cn(isOpen && "text-primary bg-accent/10")}
          title="Toggle Live Feed"
        >
          <Zap className="h-4 w-4" />
        </Button>

        {/* Alerts */}
        <Button variant="ghost" size="icon-sm" className="relative" title="Alerts">
          <Bell className="h-4 w-4" />
          {unreadAlerts.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-destructive text-[9px] font-bold flex items-center justify-center text-white">
              {unreadAlerts.length > 9 ? "9+" : unreadAlerts.length}
            </span>
          )}
        </Button>

        {/* User chip */}
        {user && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent/10 border border-border/60">
            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center">
              <span className="text-[10px] font-bold text-primary uppercase">
                {(user.displayName || user.username).charAt(0)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {user.displayName || user.username}
            </span>
          </div>
        )}

        {/* Logout */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={clearAuth}
          title="Sign out"
          className="text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}


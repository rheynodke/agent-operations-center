import { useAuthStore } from "@/stores"
import { Settings, Shield, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function SettingsPage() {
  const { clearAuth, user } = useAuthStore()

  return (
    <div className="flex flex-col gap-4 max-w-2xl animate-fade-in">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Authentication
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm text-foreground">Logged in as {user?.displayName || user?.username || 'Admin'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Role: {user?.role || 'admin'}
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={clearAuth}>
            Sign Out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>OpenClaw Agent Operations Center</p>
          <p className="text-xs font-mono text-muted-foreground/60">v2.0.0 — Vite + React + Tailwind v4 + shadcn/ui</p>
        </CardContent>
      </Card>
    </div>
  )
}

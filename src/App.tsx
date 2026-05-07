import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Sidebar } from "@/components/layout/Sidebar"
import { TopBar } from "@/components/layout/TopBar"
import { LiveFeedPanel } from "@/components/layout/LiveFeedPanel"
import { MobileFeedSheet } from "@/components/layout/MobileFeedSheet"
import { LoginScreen } from "@/components/LoginScreen"
import { SetupScreen } from "@/components/SetupScreen"
import { useAuthStore } from "@/stores"
import { useWebSocket } from "@/hooks/useWebSocket"
import { useDataLoader } from "@/hooks/useDataLoader"
import { api } from "@/lib/api"
import { Loader2 } from "lucide-react"
import { ImpersonationBanner } from "@/components/ImpersonationBanner"

// Pages
import { OverviewPage } from "@/pages/OverviewPage"
import { AgentsPage } from "@/pages/AgentsPage"
import { AgentDetailPage } from "@/pages/AgentDetailPage"
import { SessionsPage } from "@/pages/SessionsPage"
import BoardPage from "@/pages/BoardPage"
import ProjectsPage from "@/pages/ProjectsPage"
import ProjectDetailPage from "@/pages/ProjectDetailPage"
import MetricsPage from "@/pages/MetricsPage"
import AgentMetricsPage from "@/pages/AgentMetricsPage"
import { CronPage } from "@/pages/CronPage"
import { HooksPage } from "@/pages/HooksPage"
import { RoutingPage } from "@/pages/RoutingPage"
import { SettingsPage } from "@/pages/SettingsPage"
import { SkillsPage } from "@/pages/SkillsPage"
import { RoleTemplatesPage } from "@/pages/RoleTemplatesPage"
import { ChatPage } from "@/pages/ChatPage"
import { ConnectionsPage } from "@/pages/ConnectionsPage"
import { RegisterPage } from "@/pages/RegisterPage"
import { UserManagementPage } from "@/pages/UserManagementPage"
import OnboardingPage from "@/pages/OnboardingPage"
import { useMasterStatus } from "@/hooks/useMasterStatus"

function AdminOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (user?.role !== "admin") return <Navigate to="/" replace />
  return <>{children}</>
}

function MasterGate({ children }: { children: React.ReactNode }) {
  const { hasMaster } = useMasterStatus()
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const allowed = location.pathname.startsWith('/onboarding') || location.pathname.startsWith('/logout')
  // Admins are exempt — they manage the platform, they don't go through the
  // user master-onboarding wizard. Admin's master agent (when needed) is wired
  // by `runMasterBackfill()` on startup or set up manually via openclaw.json.
  if (user?.role === 'admin') return <>{children}</>
  if (!hasMaster && !allowed) {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

// /onboarding is a first-time-user-only route. Anyone who already has a Master
// Agent — and admins — are bounced back to the dashboard.
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { hasMaster } = useMasterStatus()
  const user = useAuthStore((s) => s.user)
  if (user?.role === 'admin' || hasMaster) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}

function DashboardShell() {
  useWebSocket()
  useDataLoader()
  const location = useLocation()
  const isChatPage = location.pathname === "/chat"

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <ImpersonationBanner />
      <div className="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        <main className={isChatPage ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-3 md:p-6"}>
          <ErrorBoundary scope="route">
          <Routes>
            {/* Dashboard valid routes */}
            <Route path="/" element={<OverviewPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:id" element={<AgentDetailPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectDetailPage />} />
            {/* Legacy: /board → projects/general (keep links + bookmarks working). */}
            <Route path="/board" element={<Navigate to="/projects/general" replace />} />
            <Route path="/metrics" element={<Navigate to="/projects" replace />} />
            <Route path="/metrics/agents/:agentId" element={<AgentMetricsPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/hooks" element={<HooksPage />} />
            <Route path="/routing" element={<RoutingPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/roles" element={<RoleTemplatesPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            {/* Legacy redirects (Mission/Playbook feature retired). */}
            <Route path="/pipelines" element={<Navigate to="/projects" replace />} />
            <Route path="/pipelines/:id" element={<Navigate to="/projects" replace />} />
            <Route path="/workflows" element={<Navigate to="/projects" replace />} />
            <Route path="/workflows/runs" element={<Navigate to="/projects" replace />} />
            <Route path="/workflows/runs/:id" element={<Navigate to="/projects" replace />} />
            <Route path="/workflows/templates" element={<Navigate to="/projects" replace />} />
            <Route path="/workflows/templates/:id" element={<Navigate to="/projects" replace />} />
            <Route path="/missions" element={<Navigate to="/projects" replace />} />
            <Route path="/missions/*" element={<Navigate to="/projects" replace />} />
            <Route path="/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
            <Route path="/users" element={<AdminOnly><UserManagementPage /></AdminOnly>} />
            <Route path="/chat" element={<ChatPage />} />
            {/* If authenticated user goes to login or setup, redirect them to dashboard root */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </main>
        <LiveFeedPanel />
        <MobileFeedSheet />
      </div>
      </div>
    </div>
  )
}

function MainApp() {
  const { isAuthenticated, needsSetup, setNeedsSetup, clearAuth, setAuth, token, user } = useAuthStore()
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    async function initAuth() {
      try {
        // First check if setup is needed
        const status = await api.getAuthStatus()
        setNeedsSetup(status.needsSetup)

        // Then verify token if we have one
        if (token && !status.needsSetup) {
          try {
            const me = await api.getMe()
            if (me.user) {
              setAuth(token, me.user)
            }
          } catch {
            clearAuth()
          }
        }
      } catch (err) {
        console.error("Failed to initialize auth:", err)
      } finally {
        setInitializing(false)
      }
    }
    initAuth()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  if (initializing) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
      </div>
    )
  }

  return (
    <Routes>
      {/* 1. System needs initial admin setup */}
      {needsSetup ? (
        <>
          <Route path="/setup" element={<SetupScreen />} />
          {/* Redirect ALL other paths to setup, since setup is mandatory */}
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </>
      ) : /* 2. System is setup, but user is not authenticated */
      !isAuthenticated || !user ? (
        <>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/register" element={<RegisterPage />} />
          {/* Redirect ALL other paths to login, preventing setup access */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      ) : /* 3. System is setup and user is authenticated */ (
        <>
          <Route path="/onboarding" element={<OnboardingGate><OnboardingPage /></OnboardingGate>} />
          <Route path="/*" element={<MasterGate><DashboardShell /></MasterGate>} />
        </>
      )}
    </Routes>
  )
}

export default function App() {
  // Theme is initialized via useThemeStore's persist hydration
  
  return (
    <BrowserRouter>
      <MainApp />
    </BrowserRouter>
  )
}

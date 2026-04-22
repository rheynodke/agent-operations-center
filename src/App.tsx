import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { useEffect, useState } from "react"
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

// Pages
import { OverviewPage } from "@/pages/OverviewPage"
import { AgentsPage } from "@/pages/AgentsPage"
import { AgentDetailPage } from "@/pages/AgentDetailPage"
import { SessionsPage } from "@/pages/SessionsPage"
import BoardPage from "@/pages/BoardPage"
import MetricsPage from "@/pages/MetricsPage"
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

function AdminOnly({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  if (user?.role !== "admin") return <Navigate to="/" replace />
  return <>{children}</>
}

function DashboardShell() {
  useWebSocket()
  useDataLoader()
  const location = useLocation()
  const isChatPage = location.pathname === "/chat"

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar />
        <main className={isChatPage ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-3 md:p-6"}>
          <Routes>
            {/* Dashboard valid routes */}
            <Route path="/" element={<OverviewPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/:id" element={<AgentDetailPage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/board" element={<BoardPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/cron" element={<CronPage />} />
            <Route path="/hooks" element={<HooksPage />} />
            <Route path="/routing" element={<RoutingPage />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/roles" element={<RoleTemplatesPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
            <Route path="/users" element={<AdminOnly><UserManagementPage /></AdminOnly>} />
            <Route path="/chat" element={<ChatPage />} />
            {/* If authenticated user goes to login or setup, redirect them to dashboard root */}
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/setup" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <LiveFeedPanel />
        <MobileFeedSheet />
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
          <Route path="/*" element={<DashboardShell />} />
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

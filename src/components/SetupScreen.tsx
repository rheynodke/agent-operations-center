import { useState, FormEvent } from "react"
import { Loader2, Lock, User, ShieldCheck, Eye, EyeOff, Sun, Moon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { useAuthStore, useThemeStore } from "@/stores"
import { AgentLogo } from "@/components/AgentLogo"


export function SetupScreen() {
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const { theme, toggleTheme } = useThemeStore()

  function validate() {
    if (!username.trim()) return "Username is required"
    if (username.trim().length < 3) return "Username must be at least 3 characters"
    if (!/^[a-zA-Z0-9_-]+$/.test(username.trim()))
      return "Username can only contain letters, numbers, _ and -"
    if (!password) return "Password is required"
    if (password.length < 6) return "Password must be at least 6 characters"
    if (password !== confirmPassword) return "Passwords do not match"
    return null
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setLoading(true)
    setError("")

    try {
      const res = await api.setup(
        username.trim(),
        password,
        displayName.trim() || username.trim()
      )
      setAuth(res.token, res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row relative selection:bg-primary/30">
      {/* Theme Toggle */}
      <div className="absolute top-6 right-6 z-50">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
          className="text-muted-foreground bg-background/50 hover:bg-accent/30 border border-border/50 rounded-full backdrop-blur-md shadow-sm"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      {/* LEFT PANE - Image/Vibe (Hidden on Mobile) */}
      <div className="hidden md:flex md:w-1/2 lg:w-3/5 bg-black relative flex-col justify-between overflow-hidden border-r border-border/20">
        <img
          src="/agent-hero-bg.png"
          alt="Agent Hero"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        
        {/* Decorative elements or text can go here, but since the image itself has text, keep it clean. 
            We'll just add a subtle vignette. */}
        <div className="absolute inset-0 shadow-[inset_0_0_150px_rgba(0,0,0,0.8)] pointer-events-none" />
      </div>

      {/* RIGHT PANE - Form */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 relative bg-background">
        
        {/* Mobile ambient glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none md:hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px]" />
        </div>

        <div className="w-full max-w-md relative z-10">
          {/* Header */}
          <div className="flex flex-col items-center md:items-start gap-3 mb-10">
            {/* Show Logo only on Mobile, since Desktop has the hero image */}
            <div className="md:hidden flex items-center justify-center mb-4">
              <AgentLogo className="w-40 h-40 drop-shadow-[0_0_20px_rgba(168,85,247,0.4)]" />
            </div>
            
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-3">
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 shadow-sm">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs text-primary font-medium tracking-wide">INITIAL SETUP</span>
                </div>
              </div>
              <h1 className="font-display text-4xl font-bold text-foreground tracking-tight">Agents Operation Center</h1>
              <p className="text-base text-muted-foreground mt-2">Create your admin account to get started.</p>
            </div>
          </div>

          {/* Setup card */}
          <form
            onSubmit={handleSubmit}
            className="bg-card/60 backdrop-blur-xl rounded-2xl p-6 sm:p-8 border border-border/80 shadow-2xl flex flex-col gap-5 relative overflow-hidden"
          >
            {/* Subtle card glow */}
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 blur-[50px] rounded-full pointer-events-none" />

            {/* Username */}
            <div className="flex flex-col gap-1.5 relative z-10">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Username <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  className="pl-10 bg-background/50 focus:bg-background"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Letters, numbers, _ and - only</p>
            </div>

            {/* Display name */}
            <div className="flex flex-col gap-1.5 relative z-10">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Display Name
              </label>
              <Input
                type="text"
                placeholder="Admin"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                className="bg-background/50 focus:bg-background"
              />
              <p className="text-[11px] text-muted-foreground">Optional — defaults to username</p>
            </div>

            <div className="h-px bg-border/40 my-1 relative z-10" />

            {/* Password */}
            <div className="flex flex-col gap-1.5 relative z-10">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pl-10 pr-10 bg-background/50 focus:bg-background"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Password strength indicator */}
            {password && (
              <div className="flex gap-1.5 -mt-2 relative z-10">
                {[6, 10, 16].map((threshold, i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full transition-all duration-500"
                    style={{
                      backgroundColor:
                        password.length >= threshold
                          ? i === 0 ? "var(--status-error-text)" : i === 1 ? "var(--status-warning-text, #f59e0b)" : "var(--status-active-text)"
                          : "var(--border)",
                    }}
                  />
                ))}
              </div>
            )}

            {/* Confirm password */}
            <div className="flex flex-col gap-1.5 relative z-10">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Confirm Password <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className={`pl-10 bg-background/50 focus:bg-background ${confirmPassword && confirmPassword !== password ? "border-destructive/60 focus-visible:ring-destructive/30" : ""}`}
                />
              </div>
              {confirmPassword && confirmPassword !== password && (
                <p className="text-[11px] text-destructive">Passwords do not match</p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-3 px-4 py-3 mt-1 rounded-xl bg-destructive/10 border border-destructive/20 relative z-10">
                <span className="text-destructive text-sm opacity-80">⚠</span>
                <p className="text-[13px] font-medium text-destructive">{error}</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading || !username.trim() || !password || !confirmPassword}
              className="w-full gap-2 mt-3 py-6 rounded-xl font-medium shadow-md shadow-primary/20 transition-all hover:shadow-primary/30 relative z-10"
              variant="default"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-5 w-5" />
              )}
              {loading ? "Creating account…" : "Create Admin Account"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-8">
            This account will have <span className="text-foreground font-medium">full admin access</span> to the dashboard
          </p>
        </div>
      </div>
    </div>
  )
}

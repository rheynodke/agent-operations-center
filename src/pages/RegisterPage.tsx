import { useEffect, useState, useRef, FormEvent } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Loader2, XCircle, Eye, EyeOff } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores"
import { AgentLogo } from "@/components/AgentLogo"
import PixelSnow from "@/components/onboarding/PixelSnow"
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton"

function useThemePrimary(fallback = '#b197fc') {
  const [color, setColor] = useState(fallback)
  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--primary')
        .trim()
      if (v) setColor(v)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => observer.disconnect()
  }, [])
  return color
}

export function RegisterPage() {
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const cosmicColor = useThemePrimary()

  const [validating, setValidating] = useState(true)
  const [validation, setValidation] = useState<{ valid: boolean; role?: string; expiresAt?: string; error?: string } | null>(null)

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [spinnerText, setSpinnerText] = useState("Create account")
  const spinnerTimers = useRef<number[]>([])

  function startSpinnerProgression() {
    setSpinnerText("Creating your account...")
    spinnerTimers.current.push(
      window.setTimeout(() => setSpinnerText("Setting up your workspace..."), 2000),
      window.setTimeout(() => setSpinnerText("Setting up your workspace... (this may take up to 30 seconds)"), 10000),
    )
  }

  function stopSpinnerProgression() {
    spinnerTimers.current.forEach(clearTimeout)
    spinnerTimers.current = []
    setSpinnerText("Create account")
  }

  useEffect(() => {
    if (!token) {
      setValidation({ valid: false, error: "Missing invitation token" })
      setValidating(false)
      return
    }
    ;(async () => {
      try {
        const r = await api.validateInvitation(token)
        setValidation({ valid: r.valid, role: r.defaultRole, expiresAt: r.expiresAt, error: r.error })
      } catch (err) {
        const e = err as Error & { body?: { error?: string } }
        setValidation({ valid: false, error: e.body?.error || e.message || "Invalid invitation" })
      } finally {
        setValidating(false)
      }
    })()
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    setSubmitting(true)
    setError("")
    startSpinnerProgression()
    try {
      const res = await api.registerWithInvite(token, username.trim(), password, displayName.trim() || undefined)
      setAuth(res.token, res.user)
      navigate("/", { replace: true })
    } catch (err: any) {
      if (err?.code === "GATEWAY_SPAWN_FAILED" || err?.status === 503) {
        setError("Account creation succeeded but workspace setup failed. Please contact your admin to retry the workspace setup.")
      } else {
        const e = err as Error & { body?: { error?: string } }
        setError(e.body?.error || e.message || "Registration failed")
      }
    } finally {
      setSubmitting(false)
      stopSpinnerProgression()
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center px-4">
      <div aria-hidden className="absolute inset-0 opacity-60 pointer-events-none">
        <PixelSnow
          color={cosmicColor}
          variant="round"
          speed={0.45}
          density={0.42}
          pixelResolution={420}
          flakeSize={0.012}
          minFlakeSize={1.0}
          depthFade={11}
          brightness={1.05}
        />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="flex flex-col items-center mb-6">
          <AgentLogo className="w-14 h-14 mb-3" />
          <h1 className="text-xl font-bold">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">Agent Operations Center</p>
        </div>

        {validating ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Validating invitation…
          </div>
        ) : !validation?.valid ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-center">
            <XCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="font-semibold text-destructive">Invitation invalid</p>
            <p className="text-sm text-muted-foreground mt-1">{validation?.error || "This link is no longer usable."}</p>
            <button
              onClick={() => navigate("/login")}
              className="mt-4 px-4 py-2 rounded-md bg-secondary text-sm hover:bg-secondary/80"
            >
              Go to login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="rounded-xl border border-border bg-card p-6 space-y-4">

            <div>
              <label className="block text-xs font-semibold mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={3}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Display name <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 pr-9 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-0 top-0 h-full px-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Minimum 6 characters.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Confirm password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className={`w-full rounded-md border bg-background px-3 py-2 pr-9 text-sm outline-none focus:border-primary transition-colors ${confirmPassword && password !== confirmPassword ? "border-destructive/60 focus:border-destructive" : "border-border"}`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-0 top-0 h-full px-2.5 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-[11px] text-destructive mt-1">Passwords do not match.</p>
              )}
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password || password !== confirmPassword}
              className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? spinnerText : "Create account"}
            </button>

            <div className="flex items-center gap-2 my-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted-foreground/60 font-mono uppercase tracking-wider">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <GoogleSignInButton
              intent="register"
              invitationToken={token}
              onError={(msg) => setError(msg)}
              disabled={submitting}
              label="Daftar dengan Google"
            />

            <p className="text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <button type="button" onClick={() => navigate("/login")} className="underline hover:text-foreground">
                Sign in
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

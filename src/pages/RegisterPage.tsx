import { useEffect, useState, FormEvent } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { Loader2, CheckCircle2, XCircle } from "lucide-react"
import { api } from "@/lib/api"
import { useAuthStore } from "@/stores"
import { AgentLogo } from "@/components/AgentLogo"

export function RegisterPage() {
  const [params] = useSearchParams()
  const token = params.get("token") || ""
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  const [validating, setValidating] = useState(true)
  const [validation, setValidation] = useState<{ valid: boolean; role?: string; expiresAt?: string; error?: string } | null>(null)

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

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
    setSubmitting(true)
    setError("")
    try {
      const res = await api.registerWithInvite(token, username.trim(), password, displayName.trim() || undefined)
      setAuth(res.token, res.user)
      navigate("/", { replace: true })
    } catch (err) {
      const e = err as Error & { body?: { error?: string } }
      setError(e.body?.error || e.message || "Registration failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
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
            <div className="flex items-center gap-2 text-sm text-emerald-500 bg-emerald-500/10 rounded-md px-3 py-2">
              <CheckCircle2 className="w-4 h-4" />
              Valid invitation — role: <strong>{validation.role}</strong>
              {validation.expiresAt && (
                <span className="ml-auto text-xs text-muted-foreground">
                  expires {new Date(validation.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>

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
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Minimum 6 characters.</p>
            </div>

            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !username.trim() || !password}
              className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create account
            </button>

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

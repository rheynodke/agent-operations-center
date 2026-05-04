import { useState, useEffect, useRef } from "react"
import { KeyRound, Loader2, Eye, EyeOff } from "lucide-react"

interface Props {
  username: string
  loading?: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordResetDialog({ username, loading = false, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (password.length < 6) { setError("Password must be at least 6 characters."); return }
    if (password !== confirmPassword) { setError("Passwords do not match."); return }
    onSubmit(password)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!loading ? onCancel : undefined}
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5 bg-amber-500/10">
            <KeyRound className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground leading-snug">
              Reset password for <span className="text-primary">{username}</span>
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              Set a new password. The user will need to log out and log in again.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-3 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              New password
            </label>
            <div className="relative mt-1">
              <input
                ref={inputRef}
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null) }}
                disabled={loading}
                autoComplete="new-password"
                placeholder="Minimum 6 characters"
                className="w-full bg-surface-high border border-border rounded-lg px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Confirm
            </label>
            <input
              type={show ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(null) }}
              disabled={loading}
              autoComplete="new-password"
              placeholder="Re-enter password"
              className="mt-1 w-full bg-surface-high border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="text-[12px] text-red-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-surface-high disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !password || !confirmPassword}
            className="flex-1 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 disabled:opacity-40 transition-colors"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {loading ? "Resetting…" : "Reset password"}
          </button>
        </div>
      </form>
    </div>
  )
}

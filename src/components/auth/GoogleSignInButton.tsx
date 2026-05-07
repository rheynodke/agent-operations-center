import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores'
import type { AuthUser } from '@/types'
import { Loader2 } from 'lucide-react'

interface Props {
  intent: 'login' | 'register'
  /** invitation token — required when intent === 'register' */
  invitationToken?: string
  disabled?: boolean
  onError?: (msg: string) => void
  className?: string
  label?: string
}

interface OAuthResult {
  ok: boolean
  token?: string
  user?: AuthUser & { email?: string | null }
  error?: string
}

const POPUP_W = 480
const POPUP_H = 640

/**
 * Sign in / Sign up via Google. Opens a popup, listens for postMessage from
 * the OAuth callback page, then commits the session to the auth store.
 */
export function GoogleSignInButton({
  intent,
  invitationToken,
  disabled,
  onError,
  className,
  label,
}: Props) {
  const nav = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)

  async function start() {
    if (loading) return
    if (intent === 'register' && !invitationToken) {
      onError?.('Invitation token tidak tersedia.')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ intent })
      if (invitationToken) params.set('token', invitationToken)
      const r = await fetch(`/api/auth/google/url?${params.toString()}`)
      const data = await r.json()
      if (!r.ok || !data.url) {
        onError?.(data.error || 'Gagal memulai Google sign-in')
        setLoading(false)
        return
      }

      // Open popup centered on screen
      const left = Math.max(0, Math.round((window.screen.availWidth - POPUP_W) / 2))
      const top = Math.max(0, Math.round((window.screen.availHeight - POPUP_H) / 2))
      const popup = window.open(
        data.url,
        'aoc-google-oauth',
        `width=${POPUP_W},height=${POPUP_H},left=${left},top=${top}`,
      )
      if (!popup) {
        onError?.('Popup diblok browser. Izinkan popup untuk localhost dan coba lagi.')
        setLoading(false)
        return
      }

      // Race: postMessage from popup OR popup closed without resolution.
      const result = await new Promise<OAuthResult>((resolve) => {
        let settled = false
        function settle(value: OAuthResult) {
          if (settled) return
          settled = true
          window.removeEventListener('message', onMessage)
          clearInterval(closeWatch)
          resolve(value)
        }
        function onMessage(e: MessageEvent) {
          if (!e.data || typeof e.data !== 'object') return
          if (e.data.type !== 'aoc-google-oauth') return
          settle((e.data.payload as OAuthResult) ?? { ok: false, error: 'malformed payload' })
        }
        window.addEventListener('message', onMessage)
        const closeWatch = setInterval(() => {
          try {
            if (popup.closed) settle({ ok: false, error: 'Popup ditutup sebelum selesai' })
          } catch {/* cross-origin throw — ignore */}
        }, 500)
        // Hard timeout: 5 minutes
        setTimeout(() => settle({ ok: false, error: 'Timeout — silakan coba lagi' }), 5 * 60 * 1000)
      })

      if (!result.ok || !result.token || !result.user) {
        onError?.(result.error || 'Google sign-in gagal')
        setLoading(false)
        return
      }

      setAuth(result.token, result.user)
      // Admins skip the onboarding wizard entirely; only regular users without
      // a master are routed there.
      const needsOnboarding = result.user.role !== 'admin' && !result.user.hasMaster
      nav(needsOnboarding ? '/onboarding' : '/', { replace: true })
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Google sign-in error')
      setLoading(false)
    }
  }

  const computedLabel = label ?? (intent === 'register' ? 'Daftar dengan Google' : 'Masuk dengan Google')

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled || loading}
      className={
        className ??
        'w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      }
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.6 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 16 4 9.1 8.6 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.2 35.4 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9 39.3 16 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.9 35.5 44 30.2 44 24c0-1.2-.1-2.4-.4-3.5z" />
        </svg>
      )}
      <span>{computedLabel}</span>
    </button>
  )
}

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, ArrowRight, ArrowLeft, Loader2, Check,
  X, Plus, MessageCircle,
} from 'lucide-react'
import { AgentLogo } from '@/components/AgentLogo'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { CompactAvatarPicker } from '@/components/onboarding/CompactAvatarPicker'
import { useMasterStatus } from '@/hooks/useMasterStatus'
import { useOnboardingProgressStore, type OnboardingPhase } from '@/stores/useOnboardingProgressStore'
import { api } from '@/lib/api'
import { chatApi, type GatewayMessage } from '@/lib/chat-api'
import { AVATAR_PRESETS } from '@/lib/avatarPresets'
import {
  TelegramBinding, WhatsAppBinding, DiscordBinding,
  FieldLabel, WizardInput, WizardTextarea,
} from '@/components/agents/ChannelBindingForms'
import { cn } from '@/lib/utils'
import type { ChannelBinding } from '@/types'

type Step = 1 | 2 | 3 | 4 | 5 | 6
type ChannelKind = 'telegram' | 'whatsapp' | 'discord' | null

const EMOJI_PRESETS = ['🧭', '🤖', '✨', '🧠', '🔮', '⚡', '🚀', '💎', '🌟', '🦾']
const COLOR_PRESETS = [
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Sky', value: '#0ea5e9' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Indigo', value: '#6366f1' },
]

interface Form {
  name: string
  emoji: string
  color: string
  description: string
  avatarPresetId: string | null
  soulContent: string
  channelKind: ChannelKind
  channelBinding: ChannelBinding | null
}

const INITIAL: Form = {
  name: '',
  emoji: '🧭',
  color: '#8b5cf6',
  description: '',
  avatarPresetId: null,
  soulContent: '',
  channelKind: null,
  channelBinding: null,
}

function PrimaryButton({
  children, onClick, disabled, className,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold',
        'shadow-md hover:shadow-lg hover:opacity-95 active:scale-[0.98] transition-all',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
        className,
      )}
    >
      {children}
    </button>
  )
}

function SecondaryButton({
  children, onClick, disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border bg-card text-foreground text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// Maps backend onboarding phase → wizard copy + halo color tier.
// Tiers: 'warming' (purple), 'wiring' (sky), 'ready' (emerald).
function phaseAttrs(phase: OnboardingPhase | null, agentName: string): {
  tier: 'warming' | 'wiring' | 'ready'
  copy: string
} {
  switch (phase) {
    case 'started':
    case 'provisioning':
      return { tier: 'warming', copy: `Lagi nyusun ${agentName}…` }
    case 'profile_linked':
      return { tier: 'warming', copy: `${agentName} sudah punya identitas. Mengaktifkan memori…` }
    case 'gateway_restarting':
      return { tier: 'wiring', copy: `Menyalakan jalur komunikasi ${agentName}…` }
    case 'gateway_ready':
      return { tier: 'wiring', copy: `Jalur siap. Menunggu sapaan pertama…` }
    case 'greeting_sent':
      return { tier: 'wiring', copy: `${agentName} sedang menyiapkan sapaan…` }
    case 'greeting_received':
    case 'done':
      return { tier: 'ready', copy: `${agentName} siap menemani kamu!` }
    default:
      return { tier: 'warming', copy: `Menyiapkan workspace…` }
  }
}

const HALO_BY_TIER = {
  warming: '#a78bfa', // violet — provisioning
  wiring:  '#38bdf8', // sky    — gateway booting
  ready:   '#10b981', // emerald — alive
} as const

export default function OnboardingPage() {
  const nav = useNavigate()
  const { refresh } = useMasterStatus()
  const backendPhase = useOnboardingProgressStore((s) => s.phase)
  const resetProgress = useOnboardingProgressStore((s) => s.reset)
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<Form>(INITIAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)

  // Step-5 state (WhatsApp QR)
  const [provisionedAgentId, setProvisionedAgentId] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrLinked, setQrLinked] = useState(false)
  const [pairingLinked, setPairingLinked] = useState(false)
  const [pairingError, setPairingError] = useState<string | null>(null)

  // Step-6 state (greeting / proof-of-life chat)
  const [greetingState, setGreetingState] = useState<'idle' | 'sending' | 'waiting' | 'received' | 'error'>('idle')
  const [greetingResponse, setGreetingResponse] = useState<string>('')
  const [greetingError, setGreetingError] = useState<string | null>(null)
  const greetingStartedRef = useRef(false)

  // Reset onboarding progress store once when this page mounts — a stale
  // phase from a previous (failed) run shouldn't leak into the new flow.
  useEffect(() => {
    resetProgress()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(s => ({ ...s, [k]: v }))
  }

  function pickChannel(kind: ChannelKind) {
    if (kind === null) {
      setForm(s => ({ ...s, channelKind: null, channelBinding: null }))
      return
    }
    if (kind === 'telegram') {
      setForm(s => ({
        ...s,
        channelKind: 'telegram',
        channelBinding: { type: 'telegram', dmPolicy: 'pairing', streaming: 'partial' },
      }))
    } else if (kind === 'whatsapp') {
      setForm(s => ({
        ...s,
        channelKind: 'whatsapp',
        channelBinding: { type: 'whatsapp', dmPolicy: 'pairing', allowFrom: [] },
      }))
    } else if (kind === 'discord') {
      setForm(s => ({
        ...s,
        channelKind: 'discord',
        channelBinding: { type: 'discord', dmPolicy: 'pairing', groupPolicy: 'open', botToken: '' },
      }))
    }
  }

  function finishToHome() {
    setTransitioning(true)
    refresh().finally(() => {
      setTimeout(() => nav('/', { replace: true }), 700)
    })
  }

  function goToGreeting() {
    setStep(6)
  }

  function wrap(node: React.ReactNode) {
    return (
      <>
        <div
          className={cn(
            'transition-all duration-700 ease-out',
            transitioning && 'opacity-0 scale-110 blur-sm pointer-events-none',
          )}
        >
          {node}
        </div>
        {transitioning && (() => {
          const heroPreset = form.avatarPresetId ? AVATAR_PRESETS.find(p => p.id === form.avatarPresetId) : null
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
              <div
                className="text-center"
                style={{ animation: 'aoc-zoom-hero 700ms ease-out forwards' }}
              >
                {heroPreset ? (
                  <img
                    src={heroPreset.file}
                    alt={heroPreset.name}
                    className="w-28 h-28 rounded-2xl object-cover object-top mx-auto mb-3 shadow-xl"
                    style={{ boxShadow: `0 0 32px ${heroPreset.color}66` }}
                  />
                ) : (
                  <div className="text-7xl mb-3" aria-hidden>{form.emoji}</div>
                )}
                <p className="text-2xl font-bold text-foreground">{form.name}</p>
                <p className="text-sm text-muted-foreground mt-2">Memasuki workspace…</p>
              </div>
            </div>
          )
        })()}
      </>
    )
  }

  async function provision() {
    setSubmitting(true)
    setError(null)
    try {
      const channels = form.channelBinding ? [form.channelBinding] : []
      const result = await api.provisionMaster({
        name: form.name,
        emoji: form.emoji,
        color: form.color,
        description: form.description,
        avatarPresetId: form.avatarPresetId || undefined,
        soulContent: form.soulContent,
        channels,
      })
      setProvisionedAgentId(result.agentId)
      // NOTE: do NOT call refresh() here — that flips hasMaster=true in auth state,
      // which causes <OnboardingGate> to immediately redirect to /. We delay the
      // master-status refresh until the greeting step finishes (finishToHome).
      if (form.channelKind) {
        setStep(5)
        setSubmitting(false)
        return
      }
      setSubmitting(false)
      setStep(6)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat agent. Coba lagi.')
      setSubmitting(false)
    }
  }

  // Step 5 — start WA login flow once we land (WhatsApp only).
  // The gateway was just restarted as part of provision, so the WA web-login
  // provider can take a few seconds to come up. Retry with backoff for up to
  // ~25s before surfacing an error.
  useEffect(() => {
    if (step !== 5 || !provisionedAgentId) return
    if (form.channelKind !== 'whatsapp') return
    let cancelled = false
    const start = async () => {
      setQrLoading(true)
      setQrError(null)
      const maxAttempts = 12 // ~25s with 2s base
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) return
        try {
          const r = await api.channelLoginStart('whatsapp', provisionedAgentId!)
          if (cancelled) return
          if (r.qrDataUrl) {
            setQrDataUrl(r.qrDataUrl)
          } else {
            setQrLinked(true)
          }
          setQrLoading(false)
          return
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const transient = /not available|not connected|gateway|timeout|ECONN|503/i.test(msg)
          if (!transient || attempt === maxAttempts) {
            if (!cancelled) {
              setQrError(transient
                ? 'Gateway belum siap. Coba muat ulang halaman ini sebentar lagi.'
                : msg)
              setQrLoading(false)
            }
            return
          }
          // Wait a bit and retry — gateway is probably still booting after restart
          await new Promise(res => setTimeout(res, 2000))
        }
      }
    }
    start()
    return () => { cancelled = true }
  }, [step, provisionedAgentId, form.channelKind])

  // Telegram / Discord / WhatsApp pairing polling — auto-approves first incoming request
  useEffect(() => {
    if (step !== 5 || !provisionedAgentId) return
    if (form.channelKind !== 'telegram' && form.channelKind !== 'discord' && form.channelKind !== 'whatsapp') return
    if (pairingLinked) return

    let cancelled = false

    async function tick() {
      try {
        const data = await api.getAgentPairing(provisionedAgentId!)
        const channel = form.channelKind as 'telegram' | 'discord' | 'whatsapp'
        const reqs = data[channel] || []
        const match = reqs.find(r => r.accountId === provisionedAgentId)
        if (!match) return false
        // Auto-approve
        const result = await api.approvePairing(channel, match.code, provisionedAgentId!)
        if (cancelled) return true
        if (result.ok) {
          setPairingLinked(true)
        } else {
          setPairingError(result.error || 'Gagal menyetujui pairing')
        }
        return true
      } catch (e) {
        if (!cancelled) setPairingError(e instanceof Error ? e.message : 'Gagal cek pairing')
        return true // stop polling on hard error
      }
    }

    // Run immediately, then every 3s
    let timer: ReturnType<typeof setInterval> | null = null
    ;(async () => {
      const done = await tick()
      if (cancelled || done) return
      timer = setInterval(async () => {
        const finished = await tick()
        if (finished && timer) clearInterval(timer)
      }, 3000)
    })()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [step, provisionedAgentId, form.channelKind, pairingLinked])

  // Step 6 — greet the freshly-provisioned agent and wait for first reply.
  // Proof-of-life so user knows their agent is alive before entering dashboard.
  useEffect(() => {
    if (step !== 6 || !provisionedAgentId) return
    if (greetingStartedRef.current) return
    greetingStartedRef.current = true

    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const extractAssistantText = (msg: GatewayMessage): string => {
      if (typeof msg.content === 'string') return msg.content
      if (Array.isArray(msg.content)) {
        return msg.content
          .filter(b => b && b.type === 'text' && typeof b.text === 'string')
          .map(b => b.text as string)
          .join('\n')
          .trim()
      }
      return (msg.text || '').trim()
    }

    // After provision, the per-user gateway was just (re)started so the pool's WS
    // connection takes a few seconds to come back. Retry transient 503s.
    const isTransient = (msg: string) =>
      /not connected|gateway|503|ECONN|timeout|not available/i.test(msg)
    const withRetry = async <T,>(fn: () => Promise<T>, label: string): Promise<T> => {
      const maxAttempts = 15 // ~30s with 2s base
      let lastErr: unknown
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) throw new Error('cancelled')
        try {
          return await fn()
        } catch (e) {
          lastErr = e
          const msg = e instanceof Error ? e.message : String(e)
          if (!isTransient(msg) || attempt === maxAttempts) {
            throw e
          }
          await new Promise(r => setTimeout(r, 2000))
        }
      }
      throw lastErr
    }

    const setStorePhase = useOnboardingProgressStore.getState().setPhase

    const run = async () => {
      try {
        setGreetingState('sending')
        setStorePhase({ phase: 'greeting_sent' })
        const session = await withRetry(
          () => chatApi.createSession(provisionedAgentId),
          'createSession',
        )
        if (cancelled) return
        const sessionKey =
          session.key
          || session.sessionKey
          || session.session?.key
          || session.session?.sessionKey
        if (!sessionKey) throw new Error('Gagal membuat sesi chat (key kosong)')

        const greetingText = `Halo ${form.name}! Tolong perkenalkan dirimu dalam 1-2 kalimat singkat.`
        await withRetry(
          () => chatApi.sendMessage(sessionKey, greetingText, provisionedAgentId),
          'sendMessage',
        )
        if (cancelled) return
        setGreetingState('waiting')

        // Poll history for the first assistant reply. Most simple agents respond
        // within ~10-30s; budget 90s before giving up.
        const startedAt = Date.now()
        const tick = async () => {
          if (cancelled) return true
          try {
            const r = await chatApi.getHistory(sessionKey)
            const msgs = r.messages || []
            for (let i = msgs.length - 1; i >= 0; i--) {
              const m = msgs[i]
              if (m.role !== 'assistant') continue
              const txt = extractAssistantText(m)
              if (txt) {
                if (!cancelled) {
                  setGreetingResponse(txt)
                  setGreetingState('received')
                  setStorePhase({ phase: 'greeting_received' })
                }
                return true
              }
            }
          } catch { /* transient — keep polling */ }
          if (Date.now() - startedAt > 90_000) {
            if (!cancelled) {
              setGreetingError('Agent belum membalas dalam 90 detik. Kamu bisa lanjut ke dashboard dan coba chat manual.')
              setGreetingState('error')
            }
            return true
          }
          return false
        }
        const done = await tick()
        if (cancelled || done) return
        pollTimer = setInterval(async () => {
          const finished = await tick()
          if (finished && pollTimer) { clearInterval(pollTimer); pollTimer = null }
        }, 1500)
      } catch (e) {
        if (!cancelled) {
          setGreetingError(e instanceof Error ? e.message : 'Gagal mengirim greeting')
          setGreetingState('error')
        }
      }
    }
    run()

    return () => {
      cancelled = true
      if (pollTimer) clearInterval(pollTimer)
    }
  }, [step, provisionedAgentId, form.name])

  // ── Step 1: Welcome ─────────────────────────────────────────────────────────
  if (step === 1) {
    return wrap(
      <OnboardingShell
        step={1}
        title="Selamat datang!"
        subtitle="Yuk buat agent pertama kamu — asisten pribadi yang siap bantuin pekerjaan harian."
        footer={
          <>
            <span />
            <PrimaryButton onClick={() => setStep(2)}>
              Mulai <ArrowRight className="h-3.5 w-3.5" />
            </PrimaryButton>
          </>
        }
      >
        <div className="flex flex-col items-center text-center py-4 space-y-3">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/25 blur-2xl rounded-full" aria-hidden />
            <AgentLogo className="relative w-16 h-16 drop-shadow-lg" />
          </div>
          <div className="max-w-md space-y-1">
            <p className="text-sm text-foreground/80 leading-snug">
              Pilih avatar, kasih nama, dan jelaskan kepribadiannya.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Cuma butuh beberapa langkah singkat — semuanya bisa kamu ubah lagi nanti.
            </p>
          </div>
        </div>
      </OnboardingShell>,
    )
  }

  // ── Step 2: Identity ────────────────────────────────────────────────────────
  if (step === 2) {
    const canNext = form.name.trim().length > 0
    return wrap(
      <OnboardingShell
        step={2}
        title="Kasih identitas untuk agent kamu"
        subtitle="Pilih avatar, kasih nama, dan tentukan kepribadiannya. Ini yang bikin agent kamu unik."
        footer={
          <>
            <SecondaryButton onClick={() => setStep(1)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Kembali
            </SecondaryButton>
            <PrimaryButton disabled={!canNext} onClick={() => setStep(3)}>
              Lanjut <ArrowRight className="h-3.5 w-3.5" />
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          {/* Avatar */}
          <div>
            <FieldLabel>Avatar</FieldLabel>
            <CompactAvatarPicker
              value={form.avatarPresetId}
              onChange={preset => {
                setForm(f => {
                  // Replace a field IFF it's empty OR still matches the previously-applied
                  // preset (i.e., user hasn't customized it). User-typed values are preserved.
                  const prev = f.avatarPresetId ? AVATAR_PRESETS.find(p => p.id === f.avatarPresetId) : null
                  const isPristine = (current: string, prevValue: string | undefined) =>
                    !current.trim() || (prevValue !== undefined && current.trim() === prevValue.trim())
                  return {
                    ...f,
                    avatarPresetId: preset.id,
                    color: preset.color,
                    name: isPristine(f.name, prev?.presetName) ? preset.presetName : f.name,
                    soulContent: isPristine(f.soulContent, prev?.presetPersona) ? preset.presetPersona : f.soulContent,
                    description: isPristine(f.description, prev?.presetDescription) ? preset.presetDescription : f.description,
                  }
                })
              }}
            />
            {form.avatarPresetId && (() => {
              const p = AVATAR_PRESETS.find(x => x.id === form.avatarPresetId)
              return p ? (
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Dipilih: <span className="font-semibold" style={{ color: p.color }}>{p.name}</span>
                  {' · '}<span className="italic">{p.vibe}</span>
                </p>
              ) : null
            })()}
          </div>

          {/* Name + Emoji + Color */}
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-7">
              <FieldLabel required>Nama</FieldLabel>
              <WizardInput
                placeholder="Contoh: Migi, Tadaki, Compass…"
                value={form.name}
                onChange={e => update('name', e.target.value)}
                autoFocus
                className="py-1.5 text-sm"
              />
            </div>
            <div className="col-span-2">
              <FieldLabel>Emoji</FieldLabel>
              <WizardInput
                value={form.emoji}
                onChange={e => update('emoji', e.target.value)}
                className="text-center py-1.5 text-sm"
              />
            </div>
            <div className="col-span-3">
              <FieldLabel>Warna</FieldLabel>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={form.color}
                  onChange={e => update('color', e.target.value)}
                  className="h-8 w-8 rounded-lg border border-border bg-background cursor-pointer"
                />
                <div className="flex flex-wrap gap-1">
                  {COLOR_PRESETS.slice(0, 4).map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => update('color', c.value)}
                      className={cn(
                        'h-4 w-4 rounded-full border transition-transform hover:scale-110',
                        form.color === c.value ? 'border-foreground/60 ring-2 ring-foreground/20' : 'border-border',
                      )}
                      style={{ backgroundColor: c.value }}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick emoji picks */}
          <div className="flex flex-wrap gap-1 -mt-1">
            {EMOJI_PRESETS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => update('emoji', em)}
                className={cn(
                  'h-6 w-6 rounded-md border text-sm transition-all',
                  form.emoji === em ? 'border-primary bg-primary/10' : 'border-border bg-foreground/3 hover:bg-foreground/8',
                )}
              >
                {em}
              </button>
            ))}
          </div>

          {/* Persona / Soul */}
          <div>
            <FieldLabel>Kepribadian</FieldLabel>
            <WizardTextarea
              rows={4}
              placeholder="Contoh: Asisten yang ramah dan suka membantu. Selalu menjawab dengan hangat, mengingat preferensi user, dan siap diajak ngobrol kapan saja."
              value={form.soulContent}
              onChange={e => update('soulContent', e.target.value)}
              className="p-2.5 text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Akan jadi inti kepribadian agent. Boleh dikosongin — agent akan pakai template default.
            </p>
          </div>

          {/* One-line description */}
          <div>
            <FieldLabel>Deskripsi singkat <span className="text-muted-foreground/60 font-normal">(opsional)</span></FieldLabel>
            <WizardInput
              placeholder="Apa yang dilakukan agent ini? (1 baris)"
              value={form.description}
              onChange={e => update('description', e.target.value)}
              className="py-1.5 text-sm"
            />
          </div>
        </div>
      </OnboardingShell>,
    )
  }

  // ── Step 3: Channel ────────────────────────────────────────────────────────
  if (step === 3) {
    return wrap(
      <OnboardingShell
        step={3}
        title="Hubungkan channel"
        subtitle="Pilih channel buat ngobrol sama agent kamu. Boleh diskip dulu — bisa diatur kapan aja nanti."
        footer={
          <>
            <SecondaryButton onClick={() => setStep(2)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Kembali
            </SecondaryButton>
            <PrimaryButton onClick={() => setStep(4)}>
              Lanjut <ArrowRight className="h-3.5 w-3.5" />
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          {/* Channel cards */}
          <div className="grid grid-cols-3 gap-2">
            <ChannelCard
              kind="telegram"
              iconSrc="/telegram.webp"
              label="Telegram"
              hint="Bot token"
              accent="sky"
              active={form.channelKind === 'telegram'}
              onClick={() => pickChannel(form.channelKind === 'telegram' ? null : 'telegram')}
            />
            <ChannelCard
              kind="whatsapp"
              iconSrc="/wa.png"
              label="WhatsApp"
              hint="Scan QR"
              accent="emerald"
              active={form.channelKind === 'whatsapp'}
              onClick={() => pickChannel(form.channelKind === 'whatsapp' ? null : 'whatsapp')}
            />
            <ChannelCard
              kind="discord"
              iconSrc="/discord.png"
              label="Discord"
              hint="Bot token"
              accent="indigo"
              active={form.channelKind === 'discord'}
              onClick={() => pickChannel(form.channelKind === 'discord' ? null : 'discord')}
            />
          </div>

          {/* Inline form for picked channel */}
          {form.channelKind === 'telegram' && form.channelBinding?.type === 'telegram' && (
            <TelegramBinding
              binding={form.channelBinding}
              onChange={b => update('channelBinding', b)}
              onRemove={() => pickChannel(null)}
            />
          )}
          {form.channelKind === 'whatsapp' && form.channelBinding?.type === 'whatsapp' && (
            <WhatsAppBinding
              binding={form.channelBinding}
              onChange={b => update('channelBinding', b)}
              onRemove={() => pickChannel(null)}
            />
          )}
          {form.channelKind === 'discord' && form.channelBinding?.type === 'discord' && (
            <DiscordBinding
              binding={form.channelBinding}
              onChange={b => update('channelBinding', b)}
              onRemove={() => pickChannel(null)}
            />
          )}

          {/* Skip option */}
          {form.channelKind === null && (
            <div className="rounded-xl border border-dashed border-border bg-foreground/3 p-3 text-center">
              <p className="text-sm text-foreground/80 font-medium">Belum pilih channel</p>
              <p className="text-xs text-muted-foreground mt-1">
                Tidak masalah — kamu tetap bisa chat dengan agent langsung dari dashboard, dan bisa hubungkan channel kapan aja nanti dari halaman detail agent.
              </p>
            </div>
          )}
        </div>
      </OnboardingShell>,
    )
  }

  // ── Step 4: Review ─────────────────────────────────────────────────────────
  if (step === 4) {
    const preset = form.avatarPresetId ? AVATAR_PRESETS.find(p => p.id === form.avatarPresetId) : null
    return wrap(
      <OnboardingShell
        step={4}
        title="Review & buat agent"
        subtitle="Sudah pas? Kami akan siapkan agent kamu dan langsung hubungin ke akun."
        footer={
          <>
            <SecondaryButton onClick={() => setStep(3)} disabled={submitting}>
              <ArrowLeft className="h-3.5 w-3.5" /> Kembali
            </SecondaryButton>
            <PrimaryButton
              onClick={provision}
              disabled={submitting || !form.name.trim()}
            >
              {submitting ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memproses…</>) : (<>Buat Agent <Sparkles className="h-3.5 w-3.5" /></>)}
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          {/* Hero card */}
          <div
            className="rounded-xl border border-border p-3 flex items-center gap-3"
            style={{
              background: `linear-gradient(135deg, ${form.color}14, ${form.color}06)`,
              borderColor: `${form.color}40`,
            }}
          >
            <div
              className="h-12 w-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-2xl"
              style={{
                backgroundColor: `${form.color}24`,
                color: form.color,
                boxShadow: preset ? `0 0 0 1px ${preset.color}40 inset` : undefined,
              }}
            >
              {preset ? (
                <img
                  src={preset.file}
                  alt={preset.name}
                  className="w-full h-full object-cover object-top"
                  loading="lazy"
                />
              ) : (
                form.emoji
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">{form.name || '—'}</p>
              <p className="text-xs text-muted-foreground">
                {preset ? `${preset.name} · ${preset.vibe}` : 'Agent'}
              </p>
              {form.description && (
                <p className="text-xs text-foreground/70 mt-0.5 line-clamp-2">{form.description}</p>
              )}
            </div>
          </div>

          {/* Details */}
          <dl className="grid grid-cols-3 gap-y-1.5 bg-foreground/3 rounded-xl border border-border p-3">
            <dt className="text-[11px] text-muted-foreground self-center">Peran</dt>
            <dd className="col-span-2 text-[12px] text-foreground/80">Agent utama</dd>

            <dt className="text-[11px] text-muted-foreground self-center">Channel</dt>
            <dd className="col-span-2 text-[12px] text-foreground/80">
              {form.channelKind ? <span className="capitalize">{form.channelKind}</span> : <span className="text-muted-foreground">Diskip — atur nanti</span>}
            </dd>

            <dt className="text-[11px] text-muted-foreground self-center">Kepribadian</dt>
            <dd className="col-span-2 text-foreground/70 text-[11px] leading-relaxed line-clamp-3">
              {form.soulContent.trim() || <span className="text-muted-foreground italic">Pakai template default</span>}
            </dd>
          </dl>

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
        </div>
      </OnboardingShell>,
    )
  }

  // ── Step 5: Channel pairing (WhatsApp QR / Telegram DM / Discord DM) ────────
  if (step === 5) {
  const channel = form.channelKind
  const channelMeta = channel === 'whatsapp'
    ? { title: 'Hubungkan WhatsApp', subtitle: 'Scan QR di bawah ini pakai WhatsApp di HP kamu.', logo: '/wa.png' }
    : channel === 'telegram'
    ? { title: 'Hubungkan Telegram', subtitle: 'Buka Telegram dan kirim pesan apapun ke bot kamu. Pairing akan otomatis disetujui.', logo: '/telegram.webp' }
    : channel === 'discord'
    ? { title: 'Hubungkan Discord', subtitle: 'Buka Discord dan kirim DM ke bot kamu. Pairing akan otomatis disetujui.', logo: '/discord.png' }
    : { title: 'Hubungkan channel', subtitle: '', logo: null }

  return wrap(
    <OnboardingShell
      step={5}
      totalSteps={6}
      title={channelMeta.title}
      subtitle={channelMeta.subtitle}
      footer={
        <>
          <span />
          <PrimaryButton onClick={goToGreeting}>
            {pairingLinked || qrLinked ? 'Lanjut' : 'Lewati saja'} <ArrowRight className="h-3.5 w-3.5" />
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-3 flex flex-col items-center">
        {channelMeta.logo && (
          <img src={channelMeta.logo} alt="" className="h-10 w-10 object-contain" />
        )}

        {/* WhatsApp QR */}
        {channel === 'whatsapp' && (
          <>
            {qrLoading && (
              <div className="h-60 w-60 rounded-2xl border border-border bg-foreground/3 flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Memuat QR…</p>
              </div>
            )}
            {!qrLoading && qrDataUrl && !pairingLinked && !qrLinked && (
              <div className="rounded-2xl border border-border bg-card p-4 shadow-md">
                <img src={qrDataUrl} alt="WhatsApp pairing QR" className="h-56 w-56 rounded-lg" />
              </div>
            )}
            {!qrLoading && qrError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400 max-w-md text-center">
                {qrError}
              </div>
            )}
            {!qrLoading && !qrLinked && !pairingLinked && (
              <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside max-w-sm text-center">
                <li>Buka WhatsApp di HP kamu</li>
                <li>Masuk ke <strong>Pengaturan → Perangkat Tertaut</strong></li>
                <li>Ketuk <strong>Tautkan Perangkat</strong> dan scan QR di atas</li>
              </ol>
            )}
          </>
        )}

        {/* Telegram / Discord DM pairing */}
        {(channel === 'telegram' || channel === 'discord') && !pairingLinked && (
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <div className="h-32 w-32 rounded-2xl border border-border bg-foreground/3 flex items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <p className="text-xs text-muted-foreground">
              Menunggu pesan pertama dari kamu di {channel === 'telegram' ? 'Telegram' : 'Discord'}…
            </p>
            <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside text-left max-w-sm">
              {channel === 'telegram' ? (
                <>
                  <li>Buka <strong>Telegram</strong> dan cari bot kamu (sesuai username yang kamu daftarkan ke BotFather).</li>
                  <li>Kirim <code className="font-mono">/start</code> atau pesan apapun.</li>
                  <li>Pairing akan otomatis disetujui begitu permintaan masuk.</li>
                </>
              ) : (
                <>
                  <li>Buka <strong>Discord</strong> dan cari bot kamu.</li>
                  <li>Kirim DM apapun ke bot.</li>
                  <li>Pairing akan otomatis disetujui begitu permintaan masuk.</li>
                </>
              )}
            </ol>
          </div>
        )}

        {/* Linked state — applies to all three channels */}
        {(pairingLinked || (channel === 'whatsapp' && qrLinked)) && (
          <div className="flex flex-col items-center gap-3 max-w-md text-center">
            <div className="h-20 w-20 rounded-full border border-emerald-500/30 bg-emerald-500/10 flex items-center justify-center">
              <Check className="h-10 w-10 text-emerald-400" />
            </div>
            <p className="text-sm text-emerald-400 font-semibold">Berhasil terhubung!</p>
            <p className="text-xs text-muted-foreground">
              Channel {channel} sudah dipasang ke agent kamu.
            </p>
          </div>
        )}

        {pairingError && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400 max-w-md text-center">
            {pairingError}
          </div>
        )}
      </div>
    </OnboardingShell>,
  )
  }

  // ── Step 6: Greeting / proof-of-life ────────────────────────────────────────
  const heroPreset = form.avatarPresetId ? AVATAR_PRESETS.find(p => p.id === form.avatarPresetId) : null
  const greetingPending = greetingState === 'idle' || greetingState === 'sending' || greetingState === 'waiting'
  const greetingDone = greetingState === 'received'
  const greetingFailed = greetingState === 'error'

  // Phase-driven progress: prefer backend WS phase when fresher than 4s.
  // If backend hasn't fired (older deploys, or step 6 is post-greeting), fall
  // back to frontend greeting state.
  const phaseForUI: OnboardingPhase | null =
    greetingDone ? 'greeting_received'
    : greetingFailed ? null
    : (greetingState === 'sending' || greetingState === 'waiting') ? 'greeting_sent'
    : backendPhase ?? 'started'
  const { tier, copy: progressCopy } = phaseAttrs(phaseForUI, form.name)
  const haloColor = HALO_BY_TIER[tier]

  const subtitle = greetingDone
    ? `${form.name} sudah siap menemani kamu. Yuk masuk dashboard.`
    : greetingFailed
    ? 'Kita belum dapat balasan dari agent. Kamu tetap bisa lanjut dan coba chat manual.'
    : `Memastikan ${form.name} sudah siap kerja. Sebentar ya, kita lagi nungguin sapaan pertamanya.`

  return wrap(
    <OnboardingShell
      step={6}
      totalSteps={6}
      title={greetingDone ? `${form.name} siap! ✨` : 'Menyapa agent kamu'}
      subtitle={subtitle}
      footer={
        <>
          <span />
          <PrimaryButton onClick={finishToHome} disabled={greetingPending}>
            <Check className="h-3.5 w-3.5" /> Masuk Dashboard
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col items-center justify-center py-2 min-h-[220px]">
        {/* Avatar with phase-tinted animated halo; settles to a calm emerald glow when done */}
        <div className="relative mb-4">
          {greetingPending && (
            <>
              <div
                className="absolute inset-0 rounded-2xl animate-ping transition-colors duration-700"
                style={{ backgroundColor: `${haloColor}33` }}
                aria-hidden
              />
              <div
                className="absolute -inset-2 rounded-3xl blur-xl opacity-60 transition-colors duration-700"
                style={{ backgroundColor: `${haloColor}55` }}
                aria-hidden
              />
            </>
          )}
          {greetingDone && (
            <div
              className="absolute -inset-3 rounded-3xl blur-2xl opacity-70 animate-pulse"
              style={{ backgroundColor: `${haloColor}66` }}
              aria-hidden
            />
          )}
          <div
            className="relative h-20 w-20 rounded-2xl overflow-hidden flex items-center justify-center text-4xl shadow-xl transition-shadow duration-700"
            style={{
              backgroundColor: `${form.color}24`,
              color: form.color,
              boxShadow: heroPreset
                ? `0 0 0 1px ${heroPreset.color}66 inset, 0 12px 32px ${haloColor}44`
                : `0 12px 32px ${haloColor}44`,
            }}
          >
            {heroPreset ? (
              <img src={heroPreset.file} alt={heroPreset.name} className="w-full h-full object-cover object-top" />
            ) : (
              form.emoji
            )}
          </div>
          {greetingDone && (
            <div className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center shadow-lg" style={{ animation: 'aoc-zoom-hero 400ms ease-out' }}>
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            </div>
          )}
        </div>

        {/* Status row — phase-driven copy + tinted dots */}
        {greetingPending && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full animate-bounce transition-colors duration-700" style={{ animationDelay: '0ms', backgroundColor: haloColor }} />
              <span className="h-1.5 w-1.5 rounded-full animate-bounce transition-colors duration-700" style={{ animationDelay: '120ms', backgroundColor: haloColor }} />
              <span className="h-1.5 w-1.5 rounded-full animate-bounce transition-colors duration-700" style={{ animationDelay: '240ms', backgroundColor: haloColor }} />
            </div>
            <p key={phaseForUI ?? 'idle'} className="text-xs text-muted-foreground" style={{ animation: 'aoc-zoom-hero 300ms ease-out' }}>
              {progressCopy}
            </p>
            <p className="text-[10px] text-muted-foreground/60 italic">
              <MessageCircle className="inline h-2.5 w-2.5 mr-1" />
              Proses pertama biasanya 5-30 detik buat warm-up.
            </p>
          </div>
        )}

        {/* Success — show the agent's reply in a polished card */}
        {greetingDone && (
          <div className="w-full max-w-md flex flex-col items-center gap-3" style={{ animation: 'aoc-zoom-hero 500ms ease-out' }}>
            <div
              className="relative rounded-2xl border bg-card px-4 py-3 text-sm text-foreground whitespace-pre-wrap shadow-md"
              style={{ borderColor: `${form.color}55` }}
            >
              <div className="absolute -top-2 left-4 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                style={{ backgroundColor: form.color, color: '#fff' }}
              >
                {form.name}
              </div>
              <p className="leading-relaxed mt-1">{greetingResponse}</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Mantap! Agent kamu siap kerja.</span>
            </div>
          </div>
        )}

        {/* Failure — gentle, lets user proceed */}
        {greetingFailed && (
          <div className="w-full max-w-md flex flex-col items-center gap-2 text-center">
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              {greetingError || 'Belum ada balasan dari agent.'}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Tenang — agent tetap aktif. Kamu bisa lanjut ke dashboard dan coba chat manual.
            </p>
          </div>
        )}
      </div>
    </OnboardingShell>,
  )
}

function ChannelCard({
  iconSrc,
  label,
  hint,
  accent,
  active,
  onClick,
}: {
  kind: ChannelKind
  iconSrc: string
  label: string
  hint: string
  accent: 'sky' | 'emerald' | 'indigo'
  active: boolean
  onClick: () => void
}) {
  const accentMap = {
    sky: 'border-sky-500/50 bg-sky-500/10 text-sky-400 ring-sky-500/30',
    emerald: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 ring-emerald-500/30',
    indigo: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-400 ring-indigo-500/30',
  } as const

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200',
        active
          ? `${accentMap[accent]} ring-2 shadow-md scale-[1.02]`
          : 'border-border bg-foreground/3 hover:bg-foreground/6 text-foreground/70',
      )}
    >
      {active && (
        <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
      <img src={iconSrc} alt={label} className="h-6 w-6 object-contain" />
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  )
}

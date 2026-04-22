import { useState, FormEvent } from "react"
import { Loader2, Lock, User, ArrowRight, Zap, Activity, ShieldCheck } from "lucide-react"
import { useAuthStore } from "@/stores"
import { api } from "@/lib/api"
import { AgentLogo } from "@/components/AgentLogo"

const RIGHT_BG = "#09090f"   // single source of truth — must match the right panel bg

export function LoginScreen() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError]       = useState("")
  const [loading, setLoading]   = useState(false)
  const [focused, setFocused]   = useState<"user" | "pass" | null>(null)
  const { setAuth } = useAuthStore()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError("")
    try {
      const res = await api.login(username.trim(), password)
      setAuth(res.token, res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid credentials")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes pulse-ring {
          0%   { transform: scale(1);   opacity: 0.6; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes scanline {
          0%   { top: -1px; opacity: 0; }
          4%   { opacity: 1; }
          96%  { opacity: 0.5; }
          100% { top: 100%;  opacity: 0; }
        }
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ken-burns {
          0%   { transform: scale(1.0) translate(0px,   0px); }
          33%  { transform: scale(1.05) translate(-8px, -5px); }
          66%  { transform: scale(1.08) translate(5px,  -9px); }
          100% { transform: scale(1.0) translate(0px,   0px); }
        }
        @keyframes neon-pulse {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1.0; }
        }
        @keyframes flicker {
          0%,89%,91%,93%,100% { opacity: 1; }
          90%  { opacity: 0.1; }
          92%  { opacity: 0.7; }
          94%  { opacity: 0.2; }
        }
        @keyframes drift {
          0%   { transform: translate(0, 0) scale(1);     opacity: 0; }
          8%   { opacity: 1; }
          88%  { opacity: 0.7; }
          100% { transform: translate(-28px, -55px) scale(0.5); opacity: 0; }
        }
        @keyframes float-orb {
          0%,100% { transform: translate(0, 0); }
          30%     { transform: translate(8px, -14px); }
          70%     { transform: translate(-6px, 10px); }
        }
        .anim-0 { animation: fade-up 0.65s cubic-bezier(.22,1,.36,1) 0.00s both; }
        .anim-1 { animation: fade-up 0.65s cubic-bezier(.22,1,.36,1) 0.10s both; }
        .anim-2 { animation: fade-up 0.65s cubic-bezier(.22,1,.36,1) 0.20s both; }
      `}</style>

      <div className="min-h-screen flex overflow-hidden" style={{ background: RIGHT_BG }}>

        {/* ══════════════════════════════════════════════════════════
            LEFT COLUMN  — hero image + decorative chips
            The RIGHT EDGE of this column fades into RIGHT_BG so the
            two panels appear to "melt" together seamlessly.
        ══════════════════════════════════════════════════════════ */}
        <div className="hidden md:block relative w-[58%] lg:w-[62%] overflow-hidden shrink-0">

          {/* Base video — 16:9 source cropped to fill the panel via object-cover */}
          <video
            src="/video_background.mp4"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover object-center"
            style={{
              filter: "brightness(0.72) saturate(1.15)",
            }}
          />

          {/* ── MOTION OVERLAY LAYER ── */}

          {/* Neon column pulsers — mimics the purple tubes on the left */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Left tube glow */}
            <div className="absolute left-[7%] top-[8%] w-4 h-[60%] rounded-full"
              style={{
                background: "linear-gradient(to bottom, rgba(168,85,247,0.0), rgba(168,85,247,0.7), rgba(168,85,247,0.0))",
                filter: "blur(6px)",
                animation: "neon-pulse 2.1s ease-in-out infinite",
              }}
            />
            {/* Second tube */}
            <div className="absolute left-[12%] top-[20%] w-3 h-[45%] rounded-full"
              style={{
                background: "linear-gradient(to bottom, rgba(168,85,247,0.0), rgba(192,132,252,0.5), rgba(168,85,247,0.0))",
                filter: "blur(5px)",
                animation: "neon-pulse 3.4s ease-in-out infinite 0.7s",
              }}
            />
            {/* Bottom neon rail */}
            <div className="absolute bottom-[28%] left-[15%] right-[20%] h-[2px]"
              style={{
                background: "linear-gradient(to right, transparent, rgba(236,72,153,0.8) 40%, rgba(168,85,247,0.8) 70%, transparent)",
                filter: "blur(2px)",
                animation: "neon-pulse 1.8s ease-in-out infinite 0.3s",
              }}
            />
          </div>

          {/* Drifting data particles */}
          {[
            { left: "22%", top: "65%", size: 3, dur: 5.2, delay: 0    },
            { left: "38%", top: "72%", size: 2, dur: 7.1, delay: 1.4  },
            { left: "55%", top: "60%", size: 2, dur: 6.3, delay: 0.8  },
            { left: "18%", top: "50%", size: 2, dur: 8.0, delay: 2.1  },
            { left: "45%", top: "80%", size: 3, dur: 5.8, delay: 3.3  },
            { left: "62%", top: "45%", size: 2, dur: 9.2, delay: 1.0  },
            { left: "30%", top: "35%", size: 2, dur: 6.7, delay: 4.5  },
          ].map((p, i) => (
            <div
              key={i}
              className="absolute rounded-full pointer-events-none"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
                background: i % 2 === 0 ? "rgba(192,132,252,0.9)" : "rgba(96,165,250,0.85)",
                boxShadow: `0 0 6px ${i % 2 === 0 ? "rgba(192,132,252,0.8)" : "rgba(96,165,250,0.8)"}`,
                animation: `drift ${p.dur}s ease-in-out infinite ${p.delay}s`,
              }}
            />
          ))}

          {/* Screen glint flickers — holographic display shimmer */}
          <div className="absolute pointer-events-none"
            style={{
              left: "28%", top: "22%", width: "22%", height: "18%",
              background: "rgba(139,92,246,0.06)",
              border: "1px solid rgba(139,92,246,0.15)",
              borderRadius: "4px",
              animation: "flicker 8s linear infinite 1s",
            }}
          />
          <div className="absolute pointer-events-none"
            style={{
              right: "8%", top: "8%", width: "18%", height: "14%",
              background: "rgba(59,130,246,0.05)",
              animation: "flicker 11s linear infinite 3s",
              borderRadius: "4px",
            }}
          />

          {/* Floating orb glow — ambient AI core effect */}
          <div className="absolute pointer-events-none rounded-full"
            style={{
              left: "38%", top: "42%", width: 80, height: 80,
              background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
              filter: "blur(8px)",
              animation: "float-orb 7s ease-in-out infinite",
            }}
          />

          {/* ── Overlays (order matters) ── */}

          {/* 1. Top + bottom edge fade */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: `linear-gradient(to bottom,
              ${RIGHT_BG}55 0%,
              transparent 18%,
              transparent 72%,
              ${RIGHT_BG}99 100%)`
          }} />

          {/* 2. Left edge subtle fade-in from dark */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: `linear-gradient(to right, ${RIGHT_BG}88 0%, transparent 12%)`
          }} />

          {/* 3. KEY: right-edge blend into the right panel */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background: `linear-gradient(to right,
              transparent 42%,
              ${RIGHT_BG}60 68%,
              ${RIGHT_BG}cc 82%,
              ${RIGHT_BG}   100%)`
          }} />

          {/* 4. Subtle purple vignette glow in the center */}
          <div className="absolute inset-0 pointer-events-none" style={{
            background:
              "radial-gradient(ellipse at 38% 48%, rgba(139,92,246,0.10) 0%, transparent 65%)"
          }} />

          {/* Scan line */}
          <div
            className="absolute inset-x-0 h-px pointer-events-none z-10"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(139,92,246,0.55) 50%, transparent)",
              animation: "scanline 7s linear infinite",
            }}
          />

          {/* Top-left chips */}
          <div className="absolute top-7 left-7 z-20 flex flex-col gap-2.5 anim-0">
            {[
              { icon: Zap,          label: "Active Agents", value: "Live"    },
              { icon: Activity,     label: "Sessions",      value: "Running" },
              { icon: ShieldCheck,  label: "Encrypted",     value: "E2E"     },
            ].map(({ icon: Icon, label, value }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg w-fit"
                style={{
                  background: "rgba(6,6,14,0.45)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(10px)",
                }}
              >
                <Icon className="w-3 h-3 text-violet-400/80 shrink-0" />
                <span className="text-[11px] text-white/50">{label}</span>
                <span className="ml-0.5 text-[11px] font-bold text-violet-300/80 font-mono">{value}</span>
              </div>
            ))}
          </div>

          {/* Bottom-left system badge */}
          <div className="absolute bottom-7 left-7 z-20 anim-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="relative w-1.5 h-1.5">
                <span className="block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span
                  className="absolute inset-0 rounded-full bg-emerald-400"
                  style={{ animation: "pulse-ring 2s ease-out infinite" }}
                />
              </div>
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-emerald-400/70">
                System Online
              </span>
            </div>
            <p className="text-[10px] text-white/20 font-mono">Agent Operations Center © 2026</p>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════════════
            RIGHT COLUMN  — plain dark bg + glassmorphism form card
        ══════════════════════════════════════════════════════════ */}
        <div
          className="flex-1 flex items-center justify-center px-8 py-12 relative"
          style={{ background: RIGHT_BG }}
        >
          {/* Ambient violet glow (very subtle, doesn't mask the right column) */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div
              className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(109,40,217,0.09) 0%, transparent 70%)",
              }}
            />
          </div>

          <div className="w-full max-w-xs relative z-10 anim-1">

            {/* Logo mark — same icon as sidebar / dashboard */}
            <div className="flex justify-center mb-8">
              <div className="relative">
                <div
                  className="w-[52px] h-[52px] rounded-2xl overflow-hidden"
                  style={{
                    boxShadow: "0 0 32px rgba(139,92,246,0.25)",
                  }}
                >
                  <AgentLogo className="w-full h-full" />
                </div>
                <div
                  className="absolute inset-0 rounded-2xl"
                  style={{
                    border: "1px solid rgba(139,92,246,0.45)",
                    animation: "pulse-ring 2.5s ease-out infinite",
                  }}
                />
              </div>
            </div>

            {/* Heading */}
            <div className="text-center mb-7">
              <h1 className="text-[22px] font-bold tracking-tight text-white mb-1.5">
                Agents Operation Center
              </h1>
              <p className="text-sm text-white/38">
                Sign in to access your command center
              </p>
            </div>

            {/* Form card */}
            <form onSubmit={handleSubmit}>
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  boxShadow:
                    "0 20px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
                  backdropFilter: "blur(20px)",
                }}
              >
                {/* Username */}
                <div
                  className="flex items-center gap-3 px-4 py-3.5 border-b transition-all duration-200"
                  style={{
                    borderColor:
                      focused === "user"
                        ? "rgba(139,92,246,0.3)"
                        : "rgba(255,255,255,0.055)",
                    background:
                      focused === "user"
                        ? "rgba(139,92,246,0.06)"
                        : "transparent",
                  }}
                >
                  <User
                    className="w-4 h-4 shrink-0 transition-colors duration-200"
                    style={{
                      color:
                        focused === "user"
                          ? "rgba(167,139,250,1)"
                          : "rgba(255,255,255,0.22)",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <label className="block text-[8px] font-bold uppercase tracking-[0.18em] text-white/28 mb-0.5">
                      Username
                    </label>
                    <input
                      type="text"
                      placeholder="your-username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      onFocus={() => setFocused("user")}
                      onBlur={() => setFocused(null)}
                      autoFocus
                      autoComplete="username"
                      className="w-full bg-transparent text-[13px] text-white placeholder:text-white/18 outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Password */}
                <div
                  className="flex items-center gap-3 px-4 py-3.5 transition-all duration-200"
                  style={{
                    background:
                      focused === "pass"
                        ? "rgba(139,92,246,0.06)"
                        : "transparent",
                  }}
                >
                  <Lock
                    className="w-4 h-4 shrink-0 transition-colors duration-200"
                    style={{
                      color:
                        focused === "pass"
                          ? "rgba(167,139,250,1)"
                          : "rgba(255,255,255,0.22)",
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <label className="block text-[8px] font-bold uppercase tracking-[0.18em] text-white/28 mb-0.5">
                      Password
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onFocus={() => setFocused("pass")}
                      onBlur={() => setFocused(null)}
                      autoComplete="current-password"
                      className="w-full bg-transparent text-[13px] text-white placeholder:text-white/18 outline-none font-mono tracking-widest"
                    />
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div
                  className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-red-400"
                  style={{
                    background: "rgba(239,68,68,0.07)",
                    border: "1px solid rgba(239,68,68,0.14)",
                  }}
                >
                  <span>⚠</span>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !username.trim() || !password}
                className="w-full mt-4 flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background:
                    "linear-gradient(135deg, #7c3aed 0%, #6d28d9 60%, #5b21b6 100%)",
                  boxShadow:
                    "0 8px 28px rgba(109,40,217,0.42), inset 0 1px 0 rgba(255,255,255,0.12)",
                }}
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ArrowRight className="w-4 h-4" />}
                {loading ? "Authenticating…" : "Sign In"}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-7 flex items-center gap-2">
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.055)" }} />
              <span className="text-[11px] text-white/18 font-mono px-2">AOC v2.0</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.055)" }} />
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

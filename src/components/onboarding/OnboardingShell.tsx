import { ReactNode, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import PixelSnow from './PixelSnow'

// Reads the active theme's --primary CSS variable so the cosmic background
// stays in sync with whatever theme (obsidian cyberpunk dark, light, etc.)
// the user has applied.
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

export type OnboardingStep = 1 | 2 | 3 | 4 | 5

interface Props {
  step: OnboardingStep
  totalSteps?: number
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  showStepper?: boolean
}

const STEP_LABELS: readonly string[] = ['Mulai', 'Identitas', 'Channel', 'Review', 'Hubungkan'] as const

export function OnboardingShell({
  step,
  totalSteps = 4,
  title,
  subtitle,
  children,
  footer,
  showStepper = true,
}: Props) {
  const labels = STEP_LABELS.slice(0, totalSteps)
  const cosmicColor = useThemePrimary()

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-6">
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

      <div className="relative z-10 w-full max-w-xl">
        <div className="bg-card/80 backdrop-blur-sm border border-border rounded-2xl shadow-lg p-6 sm:p-7 transition-all duration-300">
          {showStepper && (
            <div className="flex items-center gap-0 mb-6">
              {labels.map((label, i) => {
                const n = (i + 1) as OnboardingStep
                const active = n === step
                const done = n < step
                return (
                  <div key={label} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={cn(
                          'h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold border transition-all duration-300',
                          active && 'bg-primary text-primary-foreground border-primary',
                          done && 'bg-primary/15 text-primary border-primary/40',
                          !active && !done && 'bg-muted text-muted-foreground/60 border-border',
                        )}
                      >
                        {done ? <Check className="h-3 w-3" /> : n}
                      </div>
                      <span
                        className={cn(
                          'text-[9px] font-semibold uppercase tracking-wider transition-colors',
                          active ? 'text-primary' : done ? 'text-primary/70' : 'text-muted-foreground/50',
                        )}
                      >
                        {label}
                      </span>
                    </div>
                    {i < labels.length - 1 && (
                      <div
                        className={cn(
                          'flex-1 h-px mx-2 mb-4 transition-colors duration-300',
                          done ? 'bg-primary/40' : 'bg-border',
                        )}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <h1 className="text-xl font-bold tracking-tight mb-1 text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mb-5 leading-snug">{subtitle}</p>}
          <div className="space-y-3">{children}</div>
          {footer && <div className="mt-6 flex justify-between items-center gap-3">{footer}</div>}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/50 mt-3 tracking-wider uppercase">
          Agent Operations Center
        </p>
      </div>
    </div>
  )
}

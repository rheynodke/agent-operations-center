import { create } from 'zustand'

/**
 * Phases emitted by the backend during master-agent onboarding. The wizard's
 * step 6 maps these to copy + halo color so the user sees real progress
 * instead of a single "loading…" spinner.
 */
export type OnboardingPhase =
  | 'started'
  | 'provisioning'
  | 'profile_linked'
  | 'gateway_restarting'
  | 'gateway_ready'
  | 'greeting_sent'
  | 'greeting_received'
  | 'done'
  | 'error'

interface State {
  phase: OnboardingPhase | null
  detail?: string
  agentId?: string
  updatedAt: number
  setPhase: (p: { phase: OnboardingPhase; detail?: string; agentId?: string }) => void
  reset: () => void
}

export const useOnboardingProgressStore = create<State>((set) => ({
  phase: null,
  detail: undefined,
  agentId: undefined,
  updatedAt: 0,
  setPhase: ({ phase, detail, agentId }) => set({
    phase,
    detail,
    agentId,
    updatedAt: Date.now(),
  }),
  reset: () => set({ phase: null, detail: undefined, agentId: undefined, updatedAt: 0 }),
}))

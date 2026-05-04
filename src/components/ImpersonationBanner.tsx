import { useAuthStore } from '@/stores'
import { useViewAsStore } from '@/stores/useViewAsStore'
import { useIsImpersonating } from '@/lib/permissions'

export function ImpersonationBanner() {
  const me = useAuthStore((s) => s.user)
  const viewing = useViewAsStore((s) => s.viewingAsUserId)
  const setViewing = useViewAsStore((s) => s.setViewingAs)
  const isImpersonating = useIsImpersonating()

  if (!isImpersonating || !me) return null

  return (
    <div className="sticky top-0 z-50 w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-900 dark:text-amber-100 px-4 py-2 text-sm flex items-center gap-3">
      <span aria-hidden>&#9888;</span>
      <span>Viewing as user #{viewing} (read-only)</span>
      <button
        onClick={() => setViewing(me.id)}
        className="ml-auto px-2 py-0.5 rounded border border-amber-500/40 hover:bg-amber-500/20"
      >
        Exit view-as
      </button>
    </div>
  )
}

import { useQuery, useMutation } from "@tanstack/react-query"
import { useAuthStore } from "@/stores"
import { api, type Announcement } from "@/lib/api"
import { queryClient, queryKeys } from "@/lib/queryClient"

/**
 * Sticky banner stack at the top of the dashboard. Renders one row per
 * announcement still active and unread for this user. WebSocket
 * `announcement:*` events invalidate the query so banners appear/disappear
 * live across all open tabs.
 */
export function AnnouncementBanner() {
  const me = useAuthStore((s) => s.user)

  const { data } = useQuery({
    queryKey: queryKeys.announcementsActive(),
    queryFn: () => api.getActiveAnnouncements(),
    enabled: !!me,
    // Cheap to refetch (single small query) and the WS invalidation is
    // best-effort — a 60s safety net catches any missed events.
    refetchInterval: 60_000,
  })

  const dismissMut = useMutation({
    mutationFn: (id: number) => api.dismissAnnouncement(id),
    // Optimistic: drop the row from the list immediately so the banner
    // disappears without waiting for the round-trip + WS echo.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.announcementsActive() })
      const prev = queryClient.getQueryData<{ announcements: Announcement[] }>(queryKeys.announcementsActive())
      queryClient.setQueryData<{ announcements: Announcement[] }>(
        queryKeys.announcementsActive(),
        (old) => ({ announcements: (old?.announcements || []).filter(a => a.id !== id) }),
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKeys.announcementsActive(), ctx.prev)
    },
  })

  const list = data?.announcements || []
  if (!me || list.length === 0) return null

  return (
    <div className="sticky top-0 z-50 w-full">
      {list.map((a) => (
        <BannerRow key={a.id} announcement={a} onDismiss={() => dismissMut.mutate(a.id)} />
      ))}
    </div>
  )
}

function BannerRow({ announcement, onDismiss }: { announcement: Announcement; onDismiss: () => void }) {
  const { severity, title, body } = announcement
  const palette = severityClasses(severity)

  return (
    <div className={`w-full border-b ${palette} px-4 py-2 text-sm flex items-start gap-3`}>
      <span aria-hidden className="text-base leading-tight pt-0.5">{severityIcon(severity)}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{title}</div>
        {body && (
          <div className="text-xs opacity-90 mt-0.5 whitespace-pre-wrap break-words">{body}</div>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss announcement"
        className="ml-auto px-2 py-0.5 rounded border border-current/30 hover:bg-current/10 text-xs whitespace-nowrap"
      >
        Dismiss
      </button>
    </div>
  )
}

function severityClasses(severity: Announcement["severity"]): string {
  switch (severity) {
    case "error":
      return "bg-red-500/15 border-red-500/40 text-red-900 dark:text-red-100"
    case "warn":
      return "bg-amber-500/15 border-amber-500/40 text-amber-900 dark:text-amber-100"
    case "info":
    default:
      return "bg-sky-500/15 border-sky-500/40 text-sky-900 dark:text-sky-100"
  }
}

function severityIcon(severity: Announcement["severity"]): string {
  switch (severity) {
    case "error": return "⛔"
    case "warn":  return "⚠"
    case "info":
    default:      return "ℹ"
  }
}

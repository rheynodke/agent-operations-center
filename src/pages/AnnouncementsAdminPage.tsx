import { useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { Loader2, Trash2, Megaphone } from "lucide-react"
import { api, type AnnouncementWithReads } from "@/lib/api"
import { useAuthStore } from "@/stores"
import { queryClient, queryKeys } from "@/lib/queryClient"
import { confirmDialog } from "@/lib/dialogs"

type Severity = "info" | "warn" | "error"

export function AnnouncementsAdminPage() {
  const me = useAuthStore((s) => s.user)
  const isAdmin = me?.role === "admin"

  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [severity, setSeverity] = useState<Severity>("info")
  const [expiresAt, setExpiresAt] = useState<string>("")

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.announcementsAll(),
    queryFn: () => api.listAllAnnouncements(),
    enabled: isAdmin,
  })

  const createMut = useMutation({
    mutationFn: () =>
      api.createAnnouncement({
        title: title.trim(),
        body: body.trim() || undefined,
        severity,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    onSuccess: () => {
      setTitle("")
      setBody("")
      setExpiresAt("")
      setSeverity("info")
      // The WS broadcast will invalidate too, but invalidate locally for
      // immediate visual feedback in case the WS is reconnecting.
      queryClient.invalidateQueries({ queryKey: queryKeys.announcementsAll() })
      queryClient.invalidateQueries({ queryKey: queryKeys.announcementsActive() })
    },
  })

  const deactivateMut = useMutation({
    mutationFn: (id: number) => api.deactivateAnnouncement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.announcementsAll() })
      queryClient.invalidateQueries({ queryKey: queryKeys.announcementsActive() })
    },
  })

  if (!isAdmin) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    createMut.mutate()
  }

  const list = data?.announcements || []

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <Megaphone className="size-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-xs text-muted-foreground">
            Broadcast a banner to every user&apos;s dashboard. Each user dismisses individually.
          </p>
        </div>
      </header>

      {/* Compose */}
      <form
        onSubmit={submit}
        className="border rounded-lg p-4 space-y-3 bg-card"
      >
        <h2 className="text-sm font-medium">New announcement</h2>
        <div className="space-y-2">
          <label className="text-xs font-medium">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Provider Kimi rotated — please /reset chats"
            maxLength={200}
            className="w-full rounded border px-3 py-2 text-sm bg-background"
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">Body (optional)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Detail tambahan, multi-line OK. 5000 chars max."
            maxLength={5000}
            rows={3}
            className="w-full rounded border px-3 py-2 text-sm bg-background resize-y"
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-xs font-medium">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              className="w-full rounded border px-3 py-2 text-sm bg-background"
            >
              <option value="info">Info (blue)</option>
              <option value="warn">Warning (amber)</option>
              <option value="error">Error (red)</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium">Expires (optional)</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm bg-background"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!title.trim() || createMut.isPending}
            className="px-4 py-2 rounded text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50"
          >
            {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : "Send to all users"}
          </button>
        </div>
        {createMut.isError && (
          <p className="text-xs text-red-600">
            Failed: {(createMut.error as Error)?.message}
          </p>
        )}
      </form>

      {/* History */}
      <section>
        <h2 className="text-sm font-medium mb-3">History</h2>
        {isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : list.length === 0 ? (
          <p className="text-xs text-muted-foreground">No announcements yet.</p>
        ) : (
          <div className="border rounded-lg divide-y">
            {list.map((a) => (
              <Row key={a.id} a={a} onDeactivate={async () => {
                const ok = await confirmDialog({
                  title: "Deactivate announcement?",
                  message: `"${a.title}" — already-shown copies stay visible to users until they dismiss.`,
                  confirmLabel: "Deactivate",
                  destructive: true,
                })
                if (ok) deactivateMut.mutate(a.id)
              }} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Row({ a, onDeactivate }: { a: AnnouncementWithReads; onDeactivate: () => void }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-base pt-0.5" aria-hidden>
        {a.severity === "error" ? "⛔" : a.severity === "warn" ? "⚠" : "ℹ"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{a.title}</span>
          {!a.active && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              inactive
            </span>
          )}
          {a.expiresAt && new Date(a.expiresAt) < new Date() && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              expired
            </span>
          )}
        </div>
        {a.body && (
          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{a.body}</p>
        )}
        <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-3">
          <span>{new Date(a.createdAt).toLocaleString()}</span>
          <span>{a.readCount} read</span>
          {a.expiresAt && <span>expires {new Date(a.expiresAt).toLocaleString()}</span>}
        </div>
      </div>
      {a.active && (
        <button
          onClick={onDeactivate}
          aria-label="Deactivate announcement"
          className="p-1.5 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  )
}

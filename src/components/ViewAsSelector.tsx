import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores'
import { useViewAsStore } from '@/stores/useViewAsStore'
import { useIsAdmin } from '@/lib/permissions'
import { api } from '@/lib/api'

interface UserLite { id: number; username: string }

export function ViewAsSelector() {
  const isAdmin = useIsAdmin()
  const me = useAuthStore((s) => s.user)
  const viewing = useViewAsStore((s) => s.viewingAsUserId)
  const setViewing = useViewAsStore((s) => s.setViewingAs)
  const [users, setUsers] = useState<UserLite[]>([])

  useEffect(() => {
    if (!isAdmin) return
    api.listUsers().then((res) => setUsers((res?.users ?? []) as UserLite[])).catch(() => {})
  }, [isAdmin])

  if (!isAdmin || !me) return null

  return (
    <select
      value={viewing ?? me.id}
      onChange={(e) => setViewing(Number(e.target.value))}
      className="bg-card border border-border rounded px-2 py-1 text-sm"
      aria-label="View as user"
      title="View dashboard as a different user"
    >
      <option value={me.id}>Self ({me.username})</option>
      {users
        .filter((u) => u.id !== me.id)
        .map((u) => (
          <option key={u.id} value={u.id}>{u.username}</option>
        ))}
    </select>
  )
}

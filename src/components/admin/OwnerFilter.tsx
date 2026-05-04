import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useIsAdmin } from "@/lib/permissions"
import type { ManagedUser } from "@/types"

export type OwnerScope = "me" | "all" | number

interface Props {
  value: OwnerScope
  onChange: (v: OwnerScope) => void
  className?: string
}

export function OwnerFilter({ value, onChange, className = "" }: Props) {
  const isAdmin = useIsAdmin()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    api
      .listUsers()
      .then((res) => {
        if (!cancelled) setUsers(res.users ?? [])
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin])

  if (!isAdmin) return null

  return (
    <select
      className={`rounded border border-border bg-card text-foreground px-2 py-1 text-sm ${className}`}
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === "me" || raw === "all") onChange(raw)
        else onChange(Number(raw))
      }}
      title={error ?? undefined}
    >
      <option value="all">All users</option>
      <option value="me">My own</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.display_name || u.username}
        </option>
      ))}
    </select>
  )
}

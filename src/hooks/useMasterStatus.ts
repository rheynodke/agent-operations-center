import { useAuthStore } from '@/stores'
import { api } from '@/lib/api'

export function useMasterStatus() {
  const user = useAuthStore(s => s.user)
  const setMasterStatus = useAuthStore(s => s.setMasterStatus)

  async function refresh() {
    const res = await api.getMe()
    setMasterStatus(res.user.hasMaster, res.user.masterAgentId)
    return { hasMaster: res.user.hasMaster, masterAgentId: res.user.masterAgentId }
  }

  return {
    hasMaster: user?.hasMaster ?? false,
    masterAgentId: user?.masterAgentId ?? null,
    refresh,
  }
}

import { create } from "zustand"
import type { MissionMessage, MissionRoom } from "@/types"

interface RoomGroups {
  global: MissionRoom[]
  project: MissionRoom[]
}

interface RoomState {
  rooms: RoomGroups
  activeRoomId: string | null
  messagesByRoom: Record<string, MissionMessage[]>
  unreadByRoom: Record<string, number>
  setRooms: (rooms: RoomGroups) => void
  upsertRoom: (room: MissionRoom) => void
  setActiveRoom: (roomId: string | null) => void
  setMessages: (roomId: string, messages: MissionMessage[]) => void
  appendMessage: (roomId: string, message: MissionMessage) => void
  markRead: (roomId: string) => void
}

function sortRooms(rooms: MissionRoom[]) {
  return [...rooms].sort((a, b) => a.name.localeCompare(b.name))
}

export const useRoomStore = create<RoomState>((set, get) => ({
  rooms: { global: [], project: [] },
  activeRoomId: null,
  messagesByRoom: {},
  unreadByRoom: {},

  setRooms: (rooms) => set({ rooms: { global: sortRooms(rooms.global || []), project: sortRooms(rooms.project || []) } }),

  upsertRoom: (room) => set((s) => {
    const key = room.kind === "project" ? "project" : "global"
    const nextGroup = [...s.rooms[key].filter((r) => r.id !== room.id), room]
    return { rooms: { ...s.rooms, [key]: sortRooms(nextGroup) } }
  }),

  setActiveRoom: (roomId) => set((s) => ({
    activeRoomId: roomId,
    unreadByRoom: roomId ? { ...s.unreadByRoom, [roomId]: 0 } : s.unreadByRoom,
  })),

  setMessages: (roomId, messages) => set((s) => ({
    messagesByRoom: { ...s.messagesByRoom, [roomId]: [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) },
  })),

  appendMessage: (roomId, message) => set((s) => {
    const existing = s.messagesByRoom[roomId] || []
    if (existing.some((m) => m.id === message.id)) return s
    const messages = [...existing, message].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const unread = s.activeRoomId === roomId
      ? s.unreadByRoom
      : { ...s.unreadByRoom, [roomId]: (s.unreadByRoom[roomId] || 0) + 1 }
    return { messagesByRoom: { ...s.messagesByRoom, [roomId]: messages }, unreadByRoom: unread }
  }),

  markRead: (roomId) => set((s) => ({ unreadByRoom: { ...s.unreadByRoom, [roomId]: 0 } })),
}))

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { loadMuted, loadVolume, saveMuted, saveVolume } from './identity'
import type { ConnectionStatus } from './realtime'
import type { SyncHealth } from './sync'
import { emptyRoomState, type Member, type RoomState } from './types'

export interface Toast {
  id: number
  text: string
  emoji: string
}

interface AppState {
  room: RoomState
  members: Member[]
  status: ConnectionStatus
  health: SyncHealth
  driftMs: number
  roomFull: boolean
  toasts: Toast[]
  volume: number
  muted: boolean

  setRoom: (room: RoomState) => void
  setMembers: (members: Member[]) => void
  setStatus: (status: ConnectionStatus) => void
  setHealth: (health: SyncHealth, driftMs: number) => void
  setRoomFull: (full: boolean) => void
  pushToast: (text: string, emoji: string) => void
  dismissToast: (id: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  reset: () => void
}

let toastSeq = 0

export const useApp = create<AppState>()(
  subscribeWithSelector((set) => ({
    room: emptyRoomState(''),
    members: [],
    status: 'connecting',
    health: 'locked',
    driftMs: 0,
    roomFull: false,
    toasts: [],
    volume: 80,
    muted: false,

    setRoom: (room) => set({ room }),
    setMembers: (members) => set({ members }),
    setStatus: (status) => set({ status }),
    setHealth: (health, driftMs) => set({ health, driftMs }),
    setRoomFull: (roomFull) => set({ roomFull }),

    pushToast: (text, emoji) =>
      set((s) => {
        toastSeq += 1
        const toast = { id: toastSeq, text, emoji }
        // Three at a time is plenty; older ones slide out.
        return { toasts: [...s.toasts, toast].slice(-3) }
      }),

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    setVolume: (volume) => {
      saveVolume(volume)
      set({ volume })
    },

    setMuted: (muted) => {
      saveMuted(muted)
      set({ muted })
    },

    reset: () =>
      set({
        room: emptyRoomState(''),
        members: [],
        status: 'connecting',
        health: 'locked',
        driftMs: 0,
        roomFull: false,
        toasts: [],
      }),
  })),
)

/** Pull the persisted local volume once the client is mounted. */
export function hydrateLocalPrefs(): void {
  useApp.setState({ volume: loadVolume(), muted: loadMuted() })
}

/**
 * The playhead lives in its own store so that a 4 Hz position update re-renders the progress bar
 * and nothing else. The player and Now Playing components never subscribe to it.
 */
interface PlayheadState {
  positionMs: number
  durationMs: number
  set: (positionMs: number, durationMs: number) => void
}

export const usePlayhead = create<PlayheadState>()((set) => ({
  positionMs: 0,
  durationMs: 0,
  set: (positionMs, durationMs) => set({ positionMs, durationMs }),
}))

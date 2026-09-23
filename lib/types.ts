export type SourceType = 'youtube' | 'soundcloud'

/** A single item in the shared queue. */
export interface Track {
  /** Stable id for this queue entry (not the provider's id — the same video can be queued twice). */
  id: string
  sourceType: SourceType
  /** YouTube video id, or the SoundCloud permalink URL. */
  sourceId: string
  /** Canonical URL, for display and for re-resolution. */
  sourceUrl: string
  title: string
  artist: string
  thumbnail: string | null
  durationMs: number | null
  /** Username of whoever queued it. */
  addedBy: string
  /** Set when this came from a Spotify link we matched to a YouTube video. */
  matchedFrom?: 'spotify'
}

/**
 * The shared room state. This whole object rides on every `ctrl` message — it is a few KB at
 * most and full-state replacement makes convergence trivial compared with deltas.
 */
export interface RoomState {
  queue: Track[]
  /** Index into `queue`, or -1 when nothing is loaded. */
  trackIndex: number
  /** Denormalised from queue[trackIndex] so a late joiner can act before resolving the queue. */
  trackId: string | null
  sourceType: SourceType | null
  sourceUrl: string | null
  isPlaying: boolean
  /** Playhead at the moment this state was emitted. */
  positionMs: number
  /** Clock-corrected emit time. */
  emittedAtServerMs: number
  /** Monotonic counter for conflict resolution. */
  seq: number
  /** Who triggered this state. */
  actorId: string
}

export type CtrlKind =
  | 'play'
  | 'pause'
  | 'seek'
  | 'skip'
  | 'prev'
  | 'stop'
  | 'track'
  | 'queue'

export interface Member {
  clientId: string
  username: string
  color: string
  emoji: string
  joinedAt: number
}

export const PROTOCOL_VERSION = 1

/** Omit that distributes across a union, so each variant keeps its own discriminated shape. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What a caller supplies to send() — the envelope fields are filled in for them. */
export type OutboundMessage = DistributiveOmit<SyncMessage, 'v' | 'actorId' | 'at'>

interface Base {
  v: typeof PROTOCOL_VERSION
  actorId: string
  /** Clock-corrected send time. */
  at: number
}

export type SyncMessage =
  /** "I just joined, somebody tell me what's going on." */
  | (Base & { type: 'hello' })
  /** Anchor's reply to `hello`. */
  | (Base & { type: 'state'; state: RoomState })
  /** A deliberate action by a human. Carries full state; ordered by (seq, actorId). */
  | (Base & { type: 'ctrl'; seq: number; kind: CtrlKind; state: RoomState })
  /** Anchor's 1 Hz timeline re-anchor. Advisory — never ordered against ctrl. */
  | (Base
      & {
        type: 'tick'
        seq: number
        trackId: string | null
        positionMs: number
        isPlaying: boolean
      })
  /** "I've cued that track and I'm holding at the start line." */
  | (Base & { type: 'ready'; trackId: string })
  /** Start barrier fires at an absolute, clock-corrected instant. */
  | (Base
      & {
        type: 'start'
        trackId: string
        startAt: number
        fromPositionMs: number
      })

export const MAX_MEMBERS = 3

/** Drift thresholds, in ms. See docs/PHASE0.md §3 — tier 2 is a micro-seek, not a rate nudge. */
export const DRIFT_IGNORE_MS = 150
export const DRIFT_HARD_SEEK_MS = 400
/** Tier 2 needs this many consecutive over-threshold samples before acting. */
export const DRIFT_CONFIRM_SAMPLES = 2
/** Minimum gap between two micro-seeks. */
export const MICRO_SEEK_COOLDOWN_MS = 5000
/** How long the volume stays ducked around a micro-seek, masking the discontinuity. */
export const MICRO_SEEK_DUCK_MS = 120
/** Lead time on the synchronized start barrier. */
export const START_BARRIER_LEAD_MS = 1500
/** Give up waiting for a slow client and start without it. */
export const READY_TIMEOUT_MS = 5000

/* ------------------------------------------------------------------ *
 * Pure convergence rules.
 *
 * These live here, exported and side-effect free, because they are the logic most likely to sink
 * the app if it is subtly wrong — and logic buried in a private method cannot be tested.
 * ------------------------------------------------------------------ */

export interface Stamp {
  seq: number
  actorId: string
}

/**
 * Should `incoming` be applied over what we have already applied?
 *
 * Equal `seq` means two people acted simultaneously. The higher `actorId` wins — and because
 * every client evaluates this identically, they all land on the same state instead of
 * ping-ponging forever.
 */
export function acceptsEvent(incoming: Stamp, applied: Stamp): boolean {
  if (incoming.seq > applied.seq) return true
  return incoming.seq === applied.seq && incoming.actorId > applied.actorId
}

/**
 * Total order over members: join time first, clientId to break ties.
 *
 * The tiebreak is not optional — two local clocks can report the same millisecond, and without it
 * the ordering is not total, so two clients could disagree about who holds the last seat.
 */
export function seatOrder(members: Member[]): Member[] {
  return [...members].sort(
    (a, b) => a.joinedAt - b.joinedAt || a.clientId.localeCompare(b.clientId),
  )
}

/**
 * The timeline reference: lowest clientId among those present. Derived independently by every
 * client from converged presence state, so it needs no election protocol and re-derives the
 * instant somebody leaves.
 */
export function electAnchor(members: Member[], fallback: string): string {
  if (members.length === 0) return fallback
  return [...members].sort((a, b) => a.clientId.localeCompare(b.clientId))[0].clientId
}

export function emptyRoomState(actorId: string): RoomState {
  return {
    queue: [],
    trackIndex: -1,
    trackId: null,
    sourceType: null,
    sourceUrl: null,
    isPlaying: false,
    positionMs: 0,
    emittedAtServerMs: 0,
    seq: 0,
    actorId,
  }
}

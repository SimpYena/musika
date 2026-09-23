import type { SourceType, Track } from '../types'

export interface PlayerError {
  code: number
  message: string
  /** Fatal means "this track will never play" — the queue should skip past it. */
  fatal: boolean
}

export type PlayerEvent =
  | { type: 'ready' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'ended' }
  | { type: 'buffering' }
  | { type: 'error'; error: PlayerError }

export type PlayerListener = (event: PlayerEvent) => void

/**
 * The one interface the sync engine talks to. Both adapters must make `getPositionMs()`
 * synchronous — the 1 Hz reconciliation loop cannot await a postMessage round trip.
 */
export interface PlayerAdapter {
  readonly sourceType: SourceType

  /** Load a track and hold it paused at `startMs`. Resolves when it is genuinely ready to play. */
  cue(track: Track, startMs: number): Promise<void>
  play(): void
  pause(): void
  /** `precise: false` keeps the seek inside the buffered range (no refetch) — used by micro-seeks. */
  seek(ms: number, precise: boolean): void

  getPositionMs(): number
  getDurationMs(): number
  /** 0–100. Local only; never broadcast. */
  setVolume(volume: number): void

  /**
   * Which track this adapter currently holds, or null before the first cue. The sync loop uses
   * it as a self-heal check: if it disagrees with the room, a track change was missed.
   */
  getCuedTrackId(): string | null

  destroy(): void
  subscribe(listener: PlayerListener): () => void
}

/** Loads a `<script>` once and resolves when the global it defines shows up. */
export function loadScriptOnce(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === '1') resolve()
      else {
        existing.addEventListener('load', () => resolve())
        existing.addEventListener('error', () => reject(new Error(`failed to load ${src}`)))
      }
      return
    }
    const el = document.createElement('script')
    el.id = id
    el.src = src
    el.async = true
    el.addEventListener('load', () => {
      el.dataset.loaded = '1'
      resolve()
    })
    el.addEventListener('error', () => reject(new Error(`failed to load ${src}`)))
    document.head.appendChild(el)
  })
}

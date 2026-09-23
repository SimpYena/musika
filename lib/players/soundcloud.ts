import type { Track } from '../types'
import { loadScriptOnce, type PlayerAdapter, type PlayerListener, type PlayerEvent } from './types'

let apiPromise: Promise<ScNamespace> | null = null

export function loadSoundCloudApi(): Promise<ScNamespace> {
  if (apiPromise) return apiPromise
  apiPromise = loadScriptOnce('https://w.soundcloud.com/player/api.js', 'musika-sc-api').then(() => {
    if (!window.SC) throw new Error('SoundCloud widget API failed to load')
    return window.SC
  })
  return apiPromise
}

/**
 * SoundCloud Widget adapter.
 *
 * The widget's getters are asynchronous postMessage round trips, which is useless for a 1 Hz
 * reconciliation loop that needs a position *now*. So we keep a local clock: every PLAY_PROGRESS
 * event re-anchors `lastPositionMs`, and reads extrapolate from it with wall-clock elapsed.
 *
 * The 1000 ms clamp mirrors what YouTube's own widget does internally — if the iframe stops
 * pushing progress, the reported position freezes rather than running away, which is exactly the
 * behaviour the stall detector wants.
 */
export class SoundCloudPlayer implements PlayerAdapter {
  readonly sourceType = 'soundcloud' as const

  private widget: ScWidget | null = null
  private iframe: HTMLIFrameElement | null = null
  private listeners = new Set<PlayerListener>()
  private volume = 80
  private destroyed = false

  private lastPositionMs = 0
  private lastPositionAt = 0
  private durationMs = 0
  private playing = false
  private cuedTrackId: string | null = null
  private readyResolvers: (() => void)[] = []

  constructor(private container: HTMLElement) {}

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: PlayerEvent) {
    for (const l of this.listeners) l(event)
  }

  private settleReady() {
    const resolvers = this.readyResolvers
    this.readyResolvers = []
    for (const r of resolvers) r()
  }

  private async ensureWidget(initialUrl: string): Promise<void> {
    if (this.widget) return
    const SC = await loadSoundCloudApi()
    if (this.destroyed) return

    const iframe = document.createElement('iframe')
    // Non-boolean widget params must go in the initial src: the shipped load() serializer coerces
    // every option except start_track to the literal string 'true'/'false'.
    iframe.src =
      'https://w.soundcloud.com/player/?url=' +
      encodeURIComponent(initialUrl) +
      '&auto_play=false&show_artwork=true&show_comments=false&visual=false&single_active=false'
    iframe.width = '100%'
    iframe.height = '100%'
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0'
    iframe.allow = 'autoplay'
    iframe.setAttribute('frameborder', '0')
    iframe.title = 'Musika player'
    iframe.scrolling = 'no'

    this.container.appendChild(iframe)
    this.iframe = iframe

    // One-argument form only. SC.Widget(iframe, url, options) leaks an internal dev host
    // (wt.soundcloud.test:9200) in the shipped api.js.
    const widget = SC.Widget(iframe)
    this.widget = widget

    widget.bind(SC.Widget.Events.READY, () => {
      widget.setVolume(this.volume)
      widget.getDuration((d) => {
        this.durationMs = typeof d === 'number' ? d : 0
      })
      this.emit({ type: 'ready' })
      this.settleReady()
    })

    widget.bind(SC.Widget.Events.PLAY, () => {
      this.playing = true
      this.emit({ type: 'play' })
    })

    widget.bind(SC.Widget.Events.PAUSE, () => {
      this.playing = false
      // Freeze the extrapolation at the paused instant.
      this.lastPositionMs = this.getPositionMs()
      this.lastPositionAt = Date.now()
      this.emit({ type: 'pause' })
    })

    widget.bind(SC.Widget.Events.FINISH, () => {
      this.playing = false
      this.emit({ type: 'ended' })
    })

    widget.bind(SC.Widget.Events.PLAY_PROGRESS, (data) => {
      const d = data as { currentPosition?: number } | undefined
      if (typeof d?.currentPosition === 'number') {
        this.lastPositionMs = d.currentPosition
        this.lastPositionAt = Date.now()
      }
    })

    widget.bind(SC.Widget.Events.SEEK, (data) => {
      const d = data as { currentPosition?: number } | undefined
      if (typeof d?.currentPosition === 'number') {
        this.lastPositionMs = d.currentPosition
        this.lastPositionAt = Date.now()
      }
    })

    widget.bind(SC.Widget.Events.ERROR, () => {
      // The widget's ERROR event carries no payload at all.
      this.emit({
        type: 'error',
        error: { code: -1, message: "This track can't be played here", fatal: true },
      })
      this.settleReady()
    })

    await new Promise<void>((resolve) => {
      this.readyResolvers.push(resolve)
      setTimeout(resolve, 8000)
    })
  }

  async cue(track: Track, startMs: number): Promise<void> {
    await this.ensureWidget(track.sourceUrl)
    if (this.destroyed || !this.widget) return

    const isFirstLoad = this.cuedTrackId === null
    this.cuedTrackId = track.id
    this.playing = false
    this.lastPositionMs = startMs
    this.lastPositionAt = Date.now()

    if (!isFirstLoad) {
      const ready = new Promise<void>((resolve) => {
        this.readyResolvers.push(resolve)
        setTimeout(resolve, 8000)
      })
      // Booleans only — see the serializer note above.
      this.widget.load(track.sourceUrl, { auto_play: false })
      await ready
    }

    if (this.destroyed || !this.widget) return
    this.widget.setVolume(this.volume)
    if (startMs > 0) this.widget.seekTo(startMs)

    this.widget.getDuration((d) => {
      this.durationMs = typeof d === 'number' ? d : 0
    })
  }

  play(): void {
    this.widget?.play()
  }

  pause(): void {
    this.widget?.pause()
  }

  seek(ms: number): void {
    const target = Math.max(0, ms)
    this.lastPositionMs = target
    this.lastPositionAt = Date.now()
    this.widget?.seekTo(target)
  }

  getPositionMs(): number {
    if (!this.playing) return this.lastPositionMs
    const elapsed = Date.now() - this.lastPositionAt
    return this.lastPositionMs + Math.min(Math.max(elapsed, 0), 1000)
  }

  getDurationMs(): number {
    return this.durationMs
  }

  setVolume(volume: number): void {
    this.volume = Math.min(100, Math.max(0, volume))
    try {
      this.widget?.setVolume(this.volume)
    } catch {
      /* widget not ready yet; READY handler applies it */
    }
  }

  getCuedTrackId(): string | null {
    return this.cuedTrackId
  }

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
    this.readyResolvers = []
    this.widget = null
    this.iframe?.remove()
    this.iframe = null
  }
}

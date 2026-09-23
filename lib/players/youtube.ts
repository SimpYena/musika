import type { Track } from '../types'
import { loadScriptOnce, type PlayerAdapter, type PlayerListener, type PlayerEvent } from './types'

let apiPromise: Promise<typeof YT> | null = null

/**
 * Load the IFrame Player API exactly once.
 *
 * The loader script itself must come from www.youtube.com even when the player iframe is served
 * from youtube-nocookie.com — nocookie does not host /iframe_api.
 */
export function loadYouTubeApi(): Promise<typeof YT> {
  if (apiPromise) return apiPromise

  apiPromise = new Promise<typeof YT>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube API loaded without YT.Player'))
    }
    loadScriptOnce('https://www.youtube.com/iframe_api', 'musika-yt-api').catch(reject)
  })

  return apiPromise
}

/** onError codes. 153 is a configuration bug on our side, not a bad link — see PHASE0.md §1.6. */
function describeError(code: number): { message: string; fatal: boolean } {
  switch (code) {
    case 2:
      return { message: 'That link looks malformed', fatal: true }
    case 5:
      return { message: "This one won't play in a browser player", fatal: true }
    case 100:
      return { message: 'Video was deleted or set to private', fatal: true }
    case 101:
    case 150:
      return { message: 'The uploader blocked playback on other sites', fatal: true }
    case 153:
      return {
        message: "Our page isn't sending a referrer — check Referrer-Policy",
        fatal: false,
      }
    default:
      return { message: "This one won't play", fatal: true }
  }
}

export class YouTubePlayer implements PlayerAdapter {
  readonly sourceType = 'youtube' as const

  private player: YT.Player | null = null
  private iframe: HTMLIFrameElement | null = null
  private listeners = new Set<PlayerListener>()
  private volume = 80
  private destroyed = false
  private cueResolve: (() => void) | null = null
  private cuedTrackId: string | null = null

  constructor(private container: HTMLElement) {}

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: PlayerEvent) {
    for (const l of this.listeners) l(event)
  }

  private async ensurePlayer(videoId: string): Promise<void> {
    if (this.player) return
    const YTApi = await loadYouTubeApi()
    if (this.destroyed) return

    const src = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`)
    src.searchParams.set('enablejsapi', '1')
    src.searchParams.set('origin', window.location.origin)
    src.searchParams.set('playsinline', '1')
    src.searchParams.set('controls', '0')
    src.searchParams.set('rel', '0')
    src.searchParams.set('disablekb', '1')
    src.searchParams.set('fs', '0')
    src.searchParams.set('iv_load_policy', '3')

    const iframe = document.createElement('iframe')
    iframe.src = src.toString()
    iframe.width = '100%'
    iframe.height = '100%'
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0'
    // `allow` is what delegates our page's autoplay permission into the cross-origin frame.
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture'
    // Never no-referrer / same-origin: that triggers onError 153 on every single video.
    iframe.referrerPolicy = 'strict-origin-when-cross-origin'
    iframe.setAttribute('frameborder', '0')
    iframe.title = 'Musika player'

    this.container.appendChild(iframe)
    this.iframe = iframe

    await new Promise<void>((resolve) => {
      this.player = new YTApi.Player(iframe, {
        events: {
          onReady: () => {
            this.player?.setVolume(this.volume)
            resolve()
          },
          onStateChange: (e) => this.onStateChange(e.data),
          onError: (e) => {
            const { message, fatal } = describeError(e.data)
            this.emit({ type: 'error', error: { code: e.data, message, fatal } })
            // Unblock a pending cue so the queue can move on instead of hanging.
            this.settleCue()
          },
          onAutoplayBlocked: () => {
            this.emit({
              type: 'error',
              error: {
                code: -1,
                message: 'Your browser blocked autoplay — tap play to start',
                fatal: false,
              },
            })
          },
        },
      })
    })
  }

  private onStateChange(state: number) {
    switch (state) {
      case 1: // PLAYING
        this.settleCue()
        this.emit({ type: 'play' })
        break
      case 2: // PAUSED
        this.emit({ type: 'pause' })
        break
      case 0: // ENDED
        this.emit({ type: 'ended' })
        break
      case 3: // BUFFERING
        this.emit({ type: 'buffering' })
        break
      case 5: // CUED — the track is loaded and holding at the start line
        this.settleCue()
        this.emit({ type: 'ready' })
        break
      default:
        break
    }
  }

  private settleCue() {
    if (this.cueResolve) {
      const resolve = this.cueResolve
      this.cueResolve = null
      resolve()
    }
  }

  async cue(track: Track, startMs: number): Promise<void> {
    await this.ensurePlayer(track.sourceId)
    if (this.destroyed || !this.player) return

    this.cuedTrackId = track.id
    const startSeconds = Math.max(0, startMs / 1000)

    // The very first track is already in the iframe src; cueing it again would reload for nothing.
    const alreadyLoaded = (() => {
      try {
        return this.player.getVideoData()?.video_id === track.sourceId
      } catch {
        return false
      }
    })()

    const wait = new Promise<void>((resolve) => {
      this.cueResolve = resolve
      // Never hang the start barrier on a player that refuses to report CUED.
      setTimeout(() => this.settleCue(), 8000)
    })

    if (alreadyLoaded) {
      this.player.seekTo(startSeconds, true)
      this.player.pauseVideo()
      this.settleCue()
    } else {
      this.player.cueVideoById({ videoId: track.sourceId, startSeconds })
    }

    await wait
    // cue/load resets playback rate to 1 — which is what we want, but be explicit about it.
    this.player.setVolume(this.volume)
  }

  play(): void {
    this.player?.playVideo()
  }

  pause(): void {
    this.player?.pauseVideo()
  }

  seek(ms: number, precise: boolean): void {
    this.player?.seekTo(Math.max(0, ms / 1000), precise)
  }

  getPositionMs(): number {
    try {
      return (this.player?.getCurrentTime() ?? 0) * 1000
    } catch {
      return 0
    }
  }

  getDurationMs(): number {
    try {
      return (this.player?.getDuration() ?? 0) * 1000
    } catch {
      return 0
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.min(100, Math.max(0, volume))
    try {
      this.player?.setVolume(this.volume)
    } catch {
      /* player not ready yet; ensurePlayer applies it on ready */
    }
  }

  getCuedTrackId(): string | null {
    return this.cuedTrackId
  }

  destroy(): void {
    this.destroyed = true
    this.listeners.clear()
    try {
      this.player?.destroy()
    } catch {
      /* iframe may already be detached */
    }
    this.player = null
    this.iframe?.remove()
    this.iframe = null
  }
}

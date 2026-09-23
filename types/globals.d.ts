/**
 * Minimal hand-written declarations for the two player SDKs.
 *
 * `@types/youtube` exists but omits error code 153 from its enum and lacks the `host` option we
 * rely on for youtube-nocookie, so a small local declaration is both smaller and more accurate.
 */

declare namespace YT {
  interface PlayerVars {
    enablejsapi?: 0 | 1
    origin?: string
    playsinline?: 0 | 1
    controls?: 0 | 1
    rel?: 0 | 1
    autoplay?: 0 | 1
    disablekb?: 0 | 1
    fs?: 0 | 1
    iv_load_policy?: 1 | 3
    start?: number
    listType?: 'playlist' | 'user_uploads'
    list?: string
    widget_referrer?: string
  }

  interface PlayerEventArg {
    target: Player
    data: number
  }

  interface PlayerOptions {
    /** Undocumented by Google but shipped: lets the iframe come from youtube-nocookie.com. */
    host?: string
    width?: string | number
    height?: string | number
    videoId?: string
    playerVars?: PlayerVars
    events?: {
      onReady?: (e: PlayerEventArg) => void
      onStateChange?: (e: PlayerEventArg) => void
      onError?: (e: PlayerEventArg) => void
      onAutoplayBlocked?: (e: PlayerEventArg) => void
    }
  }

  class Player {
    constructor(element: HTMLElement | string, options: PlayerOptions)
    loadVideoById(id: string | { videoId: string; startSeconds?: number }): void
    cueVideoById(id: string | { videoId: string; startSeconds?: number }): void
    cuePlaylist(opts: {
      listType: 'playlist' | 'user_uploads'
      list: string
      index?: number
      startSeconds?: number
    }): void
    loadPlaylist(opts: {
      listType: 'playlist' | 'user_uploads'
      list: string
      index?: number
      startSeconds?: number
    }): void
    getPlaylist(): string[] | undefined
    getPlaylistIndex(): number
    playVideo(): void
    pauseVideo(): void
    stopVideo(): void
    seekTo(seconds: number, allowSeekAhead: boolean): void
    getCurrentTime(): number
    getDuration(): number
    getPlayerState(): number
    getVideoLoadedFraction(): number
    setVolume(volume: number): void
    getVolume(): number
    mute(): void
    unMute(): void
    isMuted(): boolean
    getVideoData(): { video_id: string; author: string; title: string }
    getIframe(): HTMLIFrameElement
    destroy(): void
  }

  const PlayerState: {
    UNSTARTED: -1
    ENDED: 0
    PLAYING: 1
    PAUSED: 2
    BUFFERING: 3
    CUED: 5
  }
}

interface ScWidgetEvents {
  READY: string
  PLAY: string
  PAUSE: string
  FINISH: string
  SEEK: string
  PLAY_PROGRESS: string
  LOAD_PROGRESS: string
  ERROR: string
}

interface ScWidget {
  bind(event: string, listener: (data?: unknown) => void): void
  unbind(event: string): void
  load(url: string, options?: Record<string, unknown>): void
  play(): void
  pause(): void
  toggle(): void
  seekTo(milliseconds: number): void
  setVolume(volume: number): void
  getVolume(cb: (volume: number) => void): void
  getDuration(cb: (durationMs: number) => void): void
  getPosition(cb: (positionMs: number) => void): void
  isPaused(cb: (paused: boolean) => void): void
  getSounds(cb: (sounds: unknown[]) => void): void
  getCurrentSound(cb: (sound: unknown) => void): void
  getCurrentSoundIndex(cb: (index: number) => void): void
  skip(index: number): void
  next(): void
  prev(): void
}

interface ScNamespace {
  Widget: ((element: HTMLIFrameElement | string) => ScWidget) & {
    Events: ScWidgetEvents
  }
}

interface Window {
  YT?: typeof YT
  onYouTubeIframeAPIReady?: () => void
  SC?: ScNamespace
}

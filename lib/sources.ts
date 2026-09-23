import type { Track } from './types'
import { loadYouTubeApi } from './players/youtube'

export { parseSourceUrl } from './parse'
export type { Parsed, SpotifyKind } from './parse'

/* ------------------------------------------------------------------ *
 * Keyless metadata (oEmbed)
 * ------------------------------------------------------------------ */

let seq = 0
function trackId(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq.toString(36)}`
}

/** YouTube oEmbed 404s on /embed/ and on youtube-nocookie.com, so always ask about watch?v=. */
function ytWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

interface OEmbed {
  title?: string
  author_name?: string
  thumbnail_url?: string
}

async function fetchOEmbed(endpoint: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(endpoint)
    // Bad ids come back as 400 *or* 404 — never branch on a specific status here.
    if (!res.ok) return null
    return (await res.json()) as OEmbed
  } catch {
    return null
  }
}

export async function resolveYouTubeVideo(
  videoId: string,
  addedBy: string,
): Promise<Track | null> {
  const meta = await fetchOEmbed(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(ytWatchUrl(videoId))}&format=json`,
  )
  if (!meta) return null
  return {
    id: trackId(),
    sourceType: 'youtube',
    sourceId: videoId,
    sourceUrl: ytWatchUrl(videoId),
    title: meta.title ?? 'Unknown track',
    artist: meta.author_name ?? '',
    thumbnail: meta.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationMs: null,
    addedBy,
  }
}

export async function resolveSoundCloud(
  url: string,
  addedBy: string,
): Promise<Track | null> {
  const meta = await fetchOEmbed(
    `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  )
  if (!meta) return null
  // SoundCloud's oEmbed title is the combined "Track by Artist" string.
  const author = meta.author_name ?? ''
  let title = meta.title ?? 'Unknown track'
  if (author && title.endsWith(` by ${author}`)) {
    title = title.slice(0, -` by ${author}`.length)
  }
  return {
    id: trackId(),
    sourceType: 'soundcloud',
    sourceId: url,
    sourceUrl: url,
    title,
    artist: author,
    thumbnail: meta.thumbnail_url ?? null,
    durationMs: null,
    addedBy,
  }
}

export interface SpotifyMeta {
  title: string
  thumbnail: string | null
}

/**
 * Spotify oEmbed is CORS-open and keyless — but it returns NO artist field at all, for any
 * resource type. That is why the match below has to be confirmed by a human.
 */
export async function resolveSpotifyMeta(url: string): Promise<SpotifyMeta | null> {
  const meta = await fetchOEmbed(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
  )
  if (!meta?.title) return null
  return { title: meta.title, thumbnail: meta.thumbnail_url ?? null }
}

/* ------------------------------------------------------------------ *
 * Playlist expansion — no API key
 * ------------------------------------------------------------------ */

/**
 * Expand a YouTube playlist with no API key: cue it into an offscreen player, read the video ids
 * back out of getPlaylist(), then hydrate titles through keyless oEmbed.
 *
 * getPlaylist()'s population timing is undocumented, so this polls rather than trusting an event.
 */
export async function expandYouTubePlaylist(
  playlistId: string,
  addedBy: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Track[]> {
  const YT = await loadYouTubeApi()

  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0'
  const mount = document.createElement('div')
  host.appendChild(mount)
  document.body.appendChild(host)

  // A holder rather than a bare `let`: TS narrows a null-initialised local to `null` and does
  // not widen it from an assignment inside a callback, which breaks the cleanup below.
  const held: { player: YT.Player | null } = { player: null }
  try {
    const ids = await new Promise<string[]>((resolve, reject) => {
      const started = Date.now()
      let settled = false

      const poll = () => {
        if (settled) return
        let list: string[] | undefined
        try {
          list = held.player?.getPlaylist() ?? undefined
        } catch {
          list = undefined
        }
        if (Array.isArray(list) && list.length > 0) {
          settled = true
          resolve(list)
          return
        }
        if (Date.now() - started > 10_000) {
          settled = true
          reject(new Error('playlist-timeout'))
          return
        }
        setTimeout(poll, 150)
      }

      held.player = new YT.Player(mount, {
        host: 'https://www.youtube-nocookie.com',
        width: '1',
        height: '1',
        playerVars: {
          enablejsapi: 1,
          origin: window.location.origin,
          playsinline: 1,
          controls: 0,
          listType: 'playlist',
          list: playlistId,
        },
        events: {
          onReady: () => poll(),
          onStateChange: () => poll(),
          onError: () => {
            if (!settled) {
              settled = true
              reject(new Error('playlist-error'))
            }
          },
        },
      })
      poll()
    })

    // Hydrate titles, 8 at a time so a long playlist doesn't open 200 sockets.
    const out: Track[] = []
    let done = 0
    const queue = [...ids]
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      for (;;) {
        const id = queue.shift()
        if (!id) return
        const track = await resolveYouTubeVideo(id, addedBy)
        done += 1
        onProgress?.(done, ids.length)
        if (track) out.push({ ...track, id: `${track.id}-${id}` })
      }
    })
    await Promise.all(workers)

    // Workers finish out of order; restore the playlist's own order.
    const rank = new Map(ids.map((id, i) => [id, i]))
    out.sort((a, b) => (rank.get(a.sourceId) ?? 0) - (rank.get(b.sourceId) ?? 0))
    return out
  } finally {
    try {
      held.player?.destroy()
    } catch {
      /* the iframe may already be gone */
    }
    host.remove()
  }
}

/** SoundCloud sets expand through the widget's own getSounds(), also with no key. */
export async function expandSoundCloudSet(
  setUrl: string,
  addedBy: string,
): Promise<Track[]> {
  const { loadSoundCloudApi } = await import('./players/soundcloud')
  const SC = await loadSoundCloudApi()

  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0'
  const iframe = document.createElement('iframe')
  iframe.allow = 'autoplay'
  iframe.src =
    'https://w.soundcloud.com/player/?url=' +
    encodeURIComponent(setUrl) +
    '&auto_play=false&show_artwork=true&single_active=false'
  host.appendChild(iframe)
  document.body.appendChild(host)

  try {
    const widget = SC.Widget(iframe)
    const sounds = await new Promise<ScSound[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('set-timeout')), 10_000)
      widget.bind(SC.Widget.Events.READY, () => {
        widget.getSounds((list) => {
          clearTimeout(timer)
          resolve(Array.isArray(list) ? (list as ScSound[]) : [])
        })
      })
    })

    return sounds
      .filter((s) => s && s.permalink_url)
      .map((s, i) => ({
        id: `${trackId()}-${i}`,
        sourceType: 'soundcloud' as const,
        sourceId: s.permalink_url!,
        sourceUrl: s.permalink_url!,
        title: s.title ?? 'Unknown track',
        artist: s.user?.username ?? '',
        thumbnail:
          (s.artwork_url ?? s.user?.avatar_url)?.replace('-large.', '-t500x500.') ?? null,
        durationMs: typeof s.duration === 'number' ? s.duration : null,
        addedBy,
      }))
  } finally {
    host.remove()
  }
}

interface ScSound {
  id?: number
  title?: string
  duration?: number
  artwork_url?: string | null
  permalink_url?: string
  user?: { username?: string; avatar_url?: string }
}

/* ------------------------------------------------------------------ *
 * Spotify -> YouTube matching (optional key)
 * ------------------------------------------------------------------ */

export interface MatchCandidate {
  videoId: string
  title: string
  channel: string
  thumbnail: string
}

export function hasYouTubeKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_YOUTUBE_API_KEY)
}

/**
 * Search YouTube for a Spotify track's equivalent.
 *
 * googleapis.com is CORS-enabled, so this runs in the browser with a referrer-restricted key and
 * needs no backend. search.list sits in its own ~100-calls/day bucket, project-wide — so the
 * caller resolves once and broadcasts the result rather than having all three clients search.
 *
 * videoEmbeddable/videoSyndicated are not optional: without them you match videos the IFrame
 * player silently refuses to play, which dead-airs the whole room.
 */
export async function searchYouTube(query: string): Promise<MatchCandidate[]> {
  const key = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY
  if (!key) return []

  const url =
    'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video' +
    '&videoEmbeddable=true&videoSyndicated=true&maxResults=5' +
    `&q=${encodeURIComponent(query)}&key=${encodeURIComponent(key)}`

  const res = await fetch(url)
  if (!res.ok) {
    if (res.status === 403) throw new Error('quota')
    throw new Error('search-failed')
  }
  const data = (await res.json()) as {
    items?: {
      id?: { videoId?: string }
      snippet?: {
        title?: string
        channelTitle?: string
        thumbnails?: Record<string, { url?: string }>
      }
    }[]
  }

  return (data.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      videoId: i.id!.videoId!,
      title: decodeEntities(i.snippet?.title ?? ''),
      channel: decodeEntities(i.snippet?.channelTitle ?? ''),
      thumbnail:
        i.snippet?.thumbnails?.medium?.url ??
        i.snippet?.thumbnails?.default?.url ??
        `https://i.ytimg.com/vi/${i.id!.videoId!}/hqdefault.jpg`,
    }))
}

/** YouTube's search API returns HTML-escaped titles ("Tom &amp; Jerry"). */
function decodeEntities(s: string): string {
  const el = document.createElement('textarea')
  el.innerHTML = s
  return el.value
}

export function candidateToTrack(c: MatchCandidate, addedBy: string): Track {
  return {
    id: trackId(),
    sourceType: 'youtube',
    sourceId: c.videoId,
    sourceUrl: ytWatchUrl(c.videoId),
    title: c.title,
    artist: c.channel,
    thumbnail: c.thumbnail,
    durationMs: null,
    addedBy,
    matchedFrom: 'spotify',
  }
}

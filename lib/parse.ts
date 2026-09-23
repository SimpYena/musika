/**
 * URL shape detection.
 *
 * Pure and dependency-free on purpose: no DOM, no network, no player SDKs. That keeps it
 * directly testable (see scripts/selftest.ts) and keeps the parsing rules — which are full of
 * verified edge cases — in one readable place.
 */

/* ------------------------------------------------------------------ *
 * URL parsing
 * ------------------------------------------------------------------ */

export type Parsed =
  | { kind: 'yt-video'; videoId: string; startSec: number }
  | { kind: 'yt-playlist'; playlistId: string }
  | { kind: 'yt-video-in-playlist'; videoId: string; playlistId: string }
  | { kind: 'sc-track'; url: string }
  | { kind: 'sc-set'; url: string }
  | { kind: 'sc-short'; url: string }
  | { kind: 'sp'; spKind: SpotifyKind; id: string; url: string }
  | { kind: 'sp-short'; url: string }
  | { kind: 'unknown' }

export type SpotifyKind = 'track' | 'album' | 'playlist' | 'episode' | 'show' | 'artist'

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/

function parseStart(u: URL): number {
  const raw = u.searchParams.get('t') ?? u.searchParams.get('start') ?? ''
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Number(raw)
  // 1h2m3s / 2m3s / 45s
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw)
  if (!m) return 0
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

export function parseSourceUrl(raw: string): Parsed {
  let s = raw.trim()
  if (!s) return { kind: 'unknown' }

  // spotify:track:4cOdK2wGLETKBW3PvgPWqT  and the legacy spotify:user:x:playlist:y
  const uri = /^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]{22})$/i.exec(s)
  if (uri) {
    const kind = uri[1].toLowerCase() as SpotifyKind
    return {
      kind: 'sp',
      spKind: kind,
      id: uri[2],
      url: `https://open.spotify.com/${kind}/${uri[2]}`,
    }
  }
  const legacy = /^spotify:user:[^:]+:playlist:([A-Za-z0-9]{22})$/i.exec(s)
  if (legacy) {
    return {
      kind: 'sp',
      spKind: 'playlist',
      id: legacy[1],
      url: `https://open.spotify.com/playlist/${legacy[1]}`,
    }
  }

  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { kind: 'unknown' }
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const seg = u.pathname.split('/').filter(Boolean)

  /* ---- YouTube ---- */
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com' ||
    host === 'youtu.be'
  ) {
    const list = u.searchParams.get('list')
    let videoId: string | null = null

    if (host === 'youtu.be') {
      videoId = seg[0] ?? null
    } else if (seg[0] === 'watch') {
      videoId = u.searchParams.get('v')
    } else if (seg[0] === 'shorts' || seg[0] === 'live' || seg[0] === 'embed' || seg[0] === 'v') {
      videoId = seg[1] ?? null
    }

    if (videoId && YT_ID.test(videoId)) {
      if (list) return { kind: 'yt-video-in-playlist', videoId, playlistId: list }
      return { kind: 'yt-video', videoId, startSec: parseStart(u) }
    }
    if (list) return { kind: 'yt-playlist', playlistId: list }
    return { kind: 'unknown' }
  }

  /* ---- SoundCloud ---- */
  if (host === 'on.soundcloud.com') {
    // 302s with no Access-Control-Allow-Origin, and the widget 404s on it. Unresolvable here.
    return { kind: 'sc-short', url: u.toString() }
  }
  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') {
    if (seg.length >= 2) {
      const clean = `https://soundcloud.com/${seg.join('/')}`
      return seg[1] === 'sets'
        ? { kind: 'sc-set', url: clean }
        : { kind: 'sc-track', url: clean }
    }
    return { kind: 'unknown' }
  }

  /* ---- Spotify ---- */
  if (host === 'spotify.link') {
    // Branch.io interstitial: returns 200 with HTML, never a redirect. Cannot resolve client-side.
    return { kind: 'sp-short', url: u.toString() }
  }
  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    // Localised share links carry an /intl-xx/ segment before the type.
    const parts = seg[0]?.startsWith('intl-') ? seg.slice(1) : seg
    const kind = parts[0] as SpotifyKind | undefined
    const id = parts[1]
    if (
      kind &&
      id &&
      SPOTIFY_ID.test(id) &&
      ['track', 'album', 'playlist', 'episode', 'show', 'artist'].includes(kind)
    ) {
      return { kind: 'sp', spKind: kind, id, url: `https://open.spotify.com/${kind}/${id}` }
    }
    return { kind: 'unknown' }
  }

  return { kind: 'unknown' }
}

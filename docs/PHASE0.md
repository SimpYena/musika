# Phase 0 — Research findings

Researched 2026-09-22/23. Every load-bearing claim below was produced by one agent and then
attacked by a second agent whose job was to refute it against primary sources. Where the
refutation won, the corrected version is what appears here.

---

## 0. Summary table

| # | Question | Chosen | Runner-up | Why |
|---|---|---|---|---|
| 3.1 | Realtime transport | **Supabase Realtime** — public channel, Broadcast + Presence, anon key only | Liveblocks (`publicApiKey` client-only mode) | Only option that is genuinely browser-only with a publishable key *and* raw-message shaped. 6 ms median / 28 ms p95 broadcast. Free tier (200 conns, 2M msg/mo) is unreachable for 3 people. Ably pushes you to a token endpoint (= a server); PartyKit needs a deployed Worker (CLAUDE.md Plan B); PeerJS's free broker is not production-grade and a 3-peer mesh adds NAT/TURN failure modes for nothing. |
| 3.2 | Playback engine | **Official SDKs directly** (YouTube IFrame API + SoundCloud Widget API) behind one thin adapter | react-player v3 for YouTube only | **react-player v3 dropped SoundCloud entirely** and there is no upstream path back — `muxinc/media-elements` has no `soundcloud-audio-element`. v3's MIGRATING.md says to stay on v2 if you need it. Its HTMLMediaElement facade also hides the timing signals sync depends on. |
| 3.3 | Spotify | **(b) oEmbed → YouTube match**, with **(c) friendly explainer** as a first-class fallback | (a) Spotify Embed IFrame API | Embed degrades to a ≤30 s preview without a logged-in session, and its controller exposes no volume and no rate command. Decisive on its own: `seek()` is documented in **seconds** while `playback_update` reports **milliseconds**. |
| 3.4 | Playlist expansion | **Zero-key**: offscreen YT resolver player → `getPlaylist()` → keyless oEmbed hydration; SoundCloud sets via `widget.getSounds()` | YouTube Data API v3 `playlistItems.list` | Works with no key at all. The optional key buys only durations and very long playlists. |
| 3.5 | Ads | Unsuppressable and unobservable — **make the sync loop ad-aware, not ad-fighting** | — | No ad event exists in the IFrame API. Detect via a stall test and hold sync rather than fight it. |

---

## 1. Corrections to common assumptions (these changed the design)

These are all widely believed and **false**, verified live:

1. **Spotify oEmbed is NOT CORS-blocked.** `https://open.spotify.com/oembed?url=…` returns
   `access-control-allow-origin: *` on GET and on OPTIONS preflight. No proxy needed.
2. **…but Spotify oEmbed returns NO artist.** The entire response for a track is
   `{html, iframe_url, width, height, version, provider_name, provider_url, type, title,
   thumbnail_url, thumbnail_width, thumbnail_height}`. No `author_name`, no `description`.
   A track resolves to a bare `"Never Gonna Give You Up"`. **This single fact decides the
   Spotify UX**: searching YouTube on a bare title mismatches constantly, so the match must be
   user-confirmed rather than automatic.
3. **googleapis.com DOES send CORS headers** for YouTube Data API v3, with full OPTIONS
   preflight. Browser-side search needs no backend proxy.
4. **YouTube `setPlaybackRate()` cannot do fine nudges.** Official docs: an unsupported value is
   rounded *"down to the nearest supported value in the direction of 1"*. So `0.97` → `1.0` and
   `1.03` → `1.0`. Available rates are `[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]`.
   **SoundCloud's widget has no rate command at all** — its shipped command set is exactly
   `{play, pause, toggle, seekTo, setVolume, next, prev, skip}`. See §3.
5. **YouTube may run ads on any video**, including from channels not in the Partner Program —
   since the Nov 2020 ToS, YouTube holds a blanket right to monetize. You cannot pre-screen a
   URL for ad-freeness.
6. **`Referrer-Policy: no-referrer` or `same-origin` silently kills every YouTube embed** with
   `onError` code **153** (added 2025-07-09). Must stay `strict-origin-when-cross-origin`.
7. **`spotify.link` short URLs do not redirect.** They return `200` with a Branch.io
   interstitial HTML page — unresolvable client-side. Same for `on.soundcloud.com`: it 302s
   with **no** `Access-Control-Allow-Origin`, and passing the short link to the widget returns
   404. Both must ask the user to paste the full link.
8. **YouTube oEmbed rejects `/embed/<id>` and `youtube-nocookie.com/*` with 404** — normalize to
   `watch?v=` first. Bad IDs return **400 *or* 404**, so branch on `!res.ok`, never on `=== 404`.

---

## 2. Realtime — Supabase specifics

- Pin `@supabase/supabase-js@^2` (a `3.0.0-next` exists on the `next` tag — do not let tooling pull it).
- Broadcast needs **no table and no RLS**. RLS on `realtime.messages` is required only for
  `private: true` channels and broadcast-from-database.
- "Allow public access to channels" is **enabled by default**; that is what makes anon-key-only
  operation work. Do not turn it off.
- `broadcast: { self: false }` is already the default, but **still** do the `actorId` check —
  suppression is per channel *instance*, so a reconnect that rebuilds the channel will echo the
  old instance's sends back at you.
- Register the `.on('presence', …)` handler **before** `.subscribe()`. `presence.enabled` defaults
  to false and is only flipped on if a handler exists at subscribe time; otherwise `track()`
  silently does nothing.
- `presenceState()` returns **arrays of metas per key**, not one object per member.
- **There is no server timestamp** in the broadcast frame — `meta` is only `{id, replayed}`. See §4.
- **Free Supabase projects pause after ~1 week without *database* activity**, and Realtime
  traffic does not count. Mitigated with a one-row heartbeat table. Documented in the README.

---

## 3. The drift-correction middle tier does not exist — CLAUDE.md §4 needs a change

CLAUDE.md specifies, for 150–400 ms of drift: *"nudge `playbackRate` to 0.97 or 1.03 until
corrected"*. **This is not implementable on any of our engines.** YouTube rounds both values to
exactly 1.0; SoundCloud has no rate API; Spotify has no rate API.

For reference, real sync systems that *do* have rate control use ±800 ppm (0.08 %). CLAUDE.md's
±3 % is ~37× larger and would be audible as a pitch shift on music even if it were possible.

The three-tier structure is kept — a hard seek at 150 ms would be exactly as jarring as CLAUDE.md
warns. Only the *mechanism* of tier 2 changes:

| Drift | CLAUDE.md | **Implemented** |
|---|---|---|
| < 150 ms | do nothing | do nothing |
| 150–400 ms | `playbackRate` 0.97/1.03 | **volume-ducked micro-seek**: require 2 consecutive samples over threshold (filters jitter), ramp volume to 0 over ~60 ms, `seekTo(expected, false)` inside the buffered range, ramp back. 5 s cooldown. |
| > 400 ms | hard `seekTo` | hard `seekTo(expected, true)` immediately, no confirmation, no cooldown |

`allowSeekAhead: false` keeps the seek inside the buffer, so there is no network fetch and no
rebuffer. The volume duck masks the discontinuity, which is what makes it approximately inaudible —
the closest achievable thing to the intent of the original spec.

**A fourth tier sits above the other three: AD / STALL HOLD.** See §5.

---

## 4. Clock sync — one deviation, for the better

CLAUDE.md §4 specifies an NTP-style handshake. Supabase carries no server timestamp, so the
reference clock has to come from somewhere. Two options:

- **Peer-to-peer NTP over broadcast** — no server, but there is no authoritative clock: with three
  peers you get three pairwise offsets and no agreed origin, and the reference vanishes when its
  peer leaves.
- **A `GET /api/time` route handler on Vercel** returning `{t: Date.now()}` — one authoritative
  clock for every peer, trivially correct.

**Chosen: `/api/time`.** It is a plain JSON GET, not a long-lived socket, so it sits well inside
CLAUDE.md §2's constraint (which is specifically about WebSockets), and §11's ban is on *server-side
audio processing*. It is ~5 invocations per user per minute. The handshake is exactly as specified:
5 pings, RTT measured per ping, `offset = t_server + rtt/2 − t_client_recv`, median taken, re-run
every 60 s. Falls back to `offset = 0` with a visible warning if the route is unreachable.

---

## 5. Ads, and why sync must yield to them

There is **no ad event** in the IFrame API — the full event set is `onReady`, `onStateChange`,
`onPlaybackQualityChange`, `onPlaybackRateChange`, `onError`, `onApiChange`, `onAutoplayBlocked`.
A pre-roll on one listener and not another is a legitimate 15–30 s divergence that the sync
algorithm must not try to "correct", because during an ad `playVideo()`/`pauseVideo()` control the
**ad**, not the content.

The initially-proposed detector (watch `getDuration()` swap to the ad's length) was **refuted as
unverified** — no primary source documents it. The replacement needs no assumption about which
timeline is reported:

> **STALL TEST:** `state === PLAYING` for > 2 s while `getCurrentTime()` has advanced < 0.5 s.

While stalled, the client stops broadcasting position, stops correcting, buffers the latest inbound
control event, and shows an amber "catching up" state. On exit it applies the buffered event and
performs exactly one hard seek. If the heuristic ever misfires, the cost is one extra hard seek —
never a broken room.

---

## 6. What needs a key, and what does not

**Fully working with no API key at all:**

- YouTube single video — title/author/thumbnail via keyless CORS oEmbed
- YouTube playlist — offscreen resolver player, `cuePlaylist()` → `getPlaylist()` → oEmbed per id
- SoundCloud track and set — oEmbed for metadata, `widget.getSounds()` for set expansion
- Spotify — oEmbed for title + artwork (**no artist**, see §1.2)

**Optional `NEXT_PUBLIC_YOUTUBE_API_KEY`** buys exactly two things: track durations before play,
and the Spotify→YouTube search. Per CLAUDE.md §3.4 this is flagged for sign-off rather than assumed:

- It is restricted by HTTP referrer in Google Cloud Console. Referrer restriction is **trivially
  spoofable** — stated honestly in the README rather than dressed up as security.
- `search.list` now sits in its own bucket of **~100 calls/day**, separate from the 10,000-unit pool.
  That is project-wide, not per-user, so the result of a search is **broadcast to the room** and
  resolved once rather than three times.
- The app is fully functional without it. The no-key Spotify path is a polished first-class screen,
  not a stub.

---

## 7. Honest limitations (these go in the README too)

- **Ads can appear** on YouTube embeds and cannot be suppressed by an embedding site.
  `youtube-nocookie.com` only makes them non-personalized.
- **Spotify tracks are never played from Spotify.** They are matched to a YouTube equivalent and
  labelled "matched from Spotify". Bad matches are possible — hence the confirm-picker.
- **Spotify gives no artist**, so matching quality on generic titles is poor without confirmation.
- Some videos are **not embeddable** (`onError` 101/150) and are auto-skipped with a message.
- `spotify.link` and `on.soundcloud.com` short links **cannot be resolved** browser-side.
- A **free Supabase project pauses** after ~1 week of inactivity and needs a manual resume.
- The room code is 4 characters and the anon key is public: **anyone who guesses a code can join**
  until the 3 seats fill. Accepted per CLAUDE.md §11 (no auth hardening), stated plainly.

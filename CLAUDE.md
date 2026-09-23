# CLAUDE.md

Project instructions. Read this fully before acting. It is the source of truth for scope, architecture, and style.

---

## 1. WHAT WE ARE BUILDING

A synchronized listening-room web app. Up to 3 friends join a room and hear the same song at the same moment. Someone pastes a YouTube / SoundCloud / Spotify link (single track or playlist), it enters a shared queue, and every browser stays locked in sync.

No voice chat. Playful Gen-Z visual style. Personal, non-commercial, 3 users maximum.

Optimize for smoothness and joy, not for scale.

**Name:** propose 3 cute options and pick one before starting.

---

## 2. DEPLOYMENT — SETTLED, DO NOT RE-LITIGATE

**Host: Vercel. Free tier. Next.js App Router.**

Audio never passes through our server. YouTube/SoundCloud embeds stream directly from their own CDNs into each browser. Vercel serves static assets and JS once, then plays no further part. Do not propose "streaming-friendly" hosting — there is no stream to host.

The only real constraint: Vercel Serverless Functions cannot hold long-lived WebSocket connections. That is why sync goes through a hosted realtime service called directly from the browser (see §3.1). Those messages are ~200-byte JSON blobs between 3 people.

Plan B, only if the chosen realtime service proves unworkable: Cloudflare Workers + Durable Objects, which are on the Workers free plan and support WebSockets natively. This costs us a small server to write and deploy, so it is a fallback, not a starting point. Flag it to the user rather than switching unilaterally.

Do not suggest Netlify, GitHub Pages, Render, or Railway. They solve nothing Vercel doesn't.

---

## 3. PHASE 0 — RESEARCH BEFORE ANY CODE

Complete this first. Output a short findings table with chosen option, runner-up, and reasoning. Do not write implementation code until this is done and stated.

### 3.1 Realtime transport (zero self-hosted backend)

Must be callable from the browser with no server of ours. Evaluate at minimum:

- Supabase Realtime (Broadcast + Presence channels) — **current default assumption**
- Liveblocks
- Ably
- PartyKit / partyserver on Cloudflare Workers
- Raw WebRTC DataChannel via PeerJS

Judge on: browser-only usage, free tier, p50 message latency, presence support, setup friction. Argue against Supabase only with a concrete technical reason.

### 3.2 Playback engines

Check current provider support in `react-player` v3 (maintained by Mux; the provider list changed from v2 — **verify whether SoundCloud is still supported**).

Compare against wiring official SDKs directly:
- YouTube IFrame Player API
- SoundCloud Widget API
- Spotify Embed IFrame API

Decide on the basis of how precise `seekTo` / `getCurrentTime` / buffering events are, because sync accuracy depends entirely on that. **Prefer tighter control even if it means more code.**

### 3.3 Spotify reality check

Confirmed constraint: the Spotify Web Playback SDK requires a full Premium subscription **on the listener's account**, not just the developer's. Mobile-only plans (Lite, Mini) do not qualify. Requiring every friend to hold Premium is a dealbreaker for this app.

Pick a strategy and justify:

- **(a)** Spotify Embed IFrame API — works without Premium, but previews only for non-authenticated listeners
- **(b)** Resolve the Spotify URL via oEmbed → title + artist → search YouTube for the equivalent → play that, with a small "matched from Spotify" badge — **preferred**
- **(c)** Reject Spotify links with a friendly explainer — **graceful fallback when no good match is found**

Never implement anything requiring every user to hold Premium.

### 3.4 Playlist expansion, client-side only

Determine what expands with no API key (YouTube IFrame API accepts `listType: 'playlist'` / `list`; the SoundCloud Widget can load a set URL directly) versus what needs one. If a YouTube Data API key is needed for richer metadata, it can live in a referrer-restricted public env var — **note this and ask before relying on it.**

### 3.5 Ads

State plainly what is and isn't possible. Official embeds only. Use `youtube-nocookie.com` where the IFrame API permits.

**Do not use, suggest, or bundle stream-extraction tooling** — yt-dlp, ytdl-core, Invidious proxies, or similar. They require a server, break constantly, and are not deployable here. If ads can appear, say so in the report and put one honest line in the README.

---

## 4. CORE ARCHITECTURE — NON-NEGOTIABLE

**Sync state, never audio.** Do not stream audio between peers. Each browser loads its own instance of the same source and plays it locally. Only a small state object travels over the wire.

### Shared room state

```
{
  trackId, sourceType, sourceUrl,
  isPlaying,
  positionMs,          // playhead at the moment the event was emitted
  emittedAtServerMs,   // clock-corrected timestamp
  seq,                 // monotonic counter for conflict resolution
  actorId,             // who triggered it
  queue: [...]
}
```

### Clock synchronization

Client clocks differ by hundreds of ms and will ruin everything. On join, run a lightweight NTP-style handshake: send N=5 pings, measure round-trip time, take the median as `clockOffset`, store it. Every timestamp written or read is corrected by this offset. Re-run every 60s.

### Drift correction — three tiers

Each client runs a 1 Hz reconciliation loop comparing local playhead against expected (`positionMs + (now - emittedAt)`):

| Drift | Action |
|---|---|
| < 150 ms | do nothing |
| 150–400 ms | nudge `playbackRate` to 0.97 or 1.03 until corrected, then return to 1.0 |
| > 400 ms | hard `seekTo` |

The middle tier is inaudible. A hard seek there would be jarring — do not collapse these tiers.

### Synchronized start barrier

This is what makes track changes feel instant instead of staggered. On any track change:

1. All clients preload/cue the new source
2. Each broadcasts `ready`
3. The initiator broadcasts `startAt = now + 1500ms`
4. Everyone begins at that absolute corrected timestamp

If a client isn't ready within 5s, start without it and let drift correction catch it up.

### Idempotency and echo suppression

Ignore your own broadcasts (compare `actorId`). Ignore any event whose `seq` is ≤ the last applied. **Without this, three clients with equal control will ping-pong pause/play forever.** This is the single most likely bug to ruin the app — write it defensively.

### Late joiner

A user joining mid-song receives current state and seeks straight to the live position. Never "wait for the next track."

### Autoplay policy

Browsers block programmatic audio before user interaction. Gate room entry behind a big friendly "Tap to join the vibe 🎧" button to satisfy the gesture requirement.

---

## 5. FUNCTIONAL REQUIREMENTS

**Accounts** — Username only. No password, no email. 2–16 chars, alphanumeric + underscore, mild profanity filter. Persisted in `localStorage`. Auto-assign a random pastel avatar color and emoji. On collision inside a room, append a number.

**Rooms** — Create generates a 4-character code avoiding ambiguous characters (no 0/O, no 1/I/l). Join by code or shareable link `/room/ABCD`. Hard cap of 3, enforced via presence; the 4th sees a friendly "room's full 😢" screen. Live presence list.

**Queue** — Paste box accepts any supported URL; detect source from URL shape. Show resolved title/artist/thumbnail as a card before playing. Playlist URLs expand into multiple items. Anyone can add, anyone can remove, drag to reorder.

**Controls (shared — everyone equal, no host role)** — Play, pause, skip, previous, stop, scrub to seek. Every action is attributed in the UI with a small toast: "mina skipped ⏭️". This attribution matters more than it looks — it prevents the confusion of things changing for no visible reason.

**Volume (local only)** — Per-user slider + mute toggle. **Never broadcast.** Persist per user in `localStorage`.

**Now Playing** — Prominent: artwork, title, artist, source badge, animated progress bar, elapsed/total, a live sync indicator (green pulse under 150 ms drift, amber while correcting), and avatars of everyone listening.

**Connection resilience** — Detect disconnect, show a calm "reconnecting…" state, auto-rejoin and re-sync on recovery.

---

## 6. DESIGN DIRECTION

Reference point: **Duolingo's visual language** — friendly, chunky, tactile, slightly bouncy. Audience is under 25. Cute but not childish; clean but not corporate.

- **Shape** — heavily rounded corners (20–28px cards, full pill buttons). Thick visible borders (3px). Hard offset drop shadows (`4px 4px 0`, no blur) rather than soft blurs. This is the single biggest contributor to the "app for teenagers" feel.
- **Buttons** — press-down physicality: on `:active`, translate 4px down/right and collapse the shadow. Must feel clicky.
- **Type** — rounded geometric sans: Nunito, Baloo 2, or Fredoka (all free on Google Fonts). Heavy weights for headings, generous letter-spacing.
- **Color** — one energetic palette. Suggested: electric lilac, mint, hot coral, sunshine yellow, deep ink text. Light and dark mode. WCAG AA contrast even when playful.
- **Icons** — rounded, filled, chunky. Phosphor Icons (fill/duotone) or Lucide with increased stroke width. One consistent set throughout.
- **Motion** — spring physics, never linear easing. Framer Motion. Album art pulses with playback. Skip slides the card. Confetti when someone joins. **Every animation under 400ms — cute must never mean slow.**
- **Mascot** — a simple SVG character (headphones / music note / cassette) that reacts: bobbing while playing, asleep when paused, surprised on skip. Build it in code, not as an image asset.
- **Empty states** — empty queue, full room, lonely solo listener. Each gets its own illustrated, warm, funny treatment. Do not leave these generic.
- **Mobile-first** — beautiful at 375px, scales up. Touch targets ≥ 44px.

---

## 7. TECH STACK

- Next.js (App Router) + TypeScript → Vercel
- Tailwind CSS v4, with a small design-token layer so the palette changes in one file
- Framer Motion
- Zustand for client state
- Realtime service chosen in Phase 0, client-side only
- No database beyond what the realtime service gives ephemerally. **Rooms may vanish when empty — that is fine and expected.**
- All secrets must be public-safe client keys (`NEXT_PUBLIC_*`). If a design needs a genuinely secret key, **stop and say so** rather than building it.

---

## 8. PERFORMANCE BUDGET

Three users means there is no excuse for lag.

- Control action → other clients react: **< 250 ms p95**
- Steady-state drift between any two clients: **< 150 ms**
- First contentful paint: **< 1.5 s**
- **No re-render of the player component on progress ticks** — isolate the progress bar into its own subscribed component
- Throttle position broadcasts to 1/sec; send immediately on discrete events (play/pause/seek/skip)
- Lazy-load player SDKs only when a source of that type first appears

---

## 9. DELIVERABLES

1. Phase 0 research report — before any code
2. Stated architecture decision with a text data-flow diagram
3. Complete runnable repo: full file tree, every file written out, **no `// ... rest of implementation` placeholders**
4. `README.md` — setup, exact env vars, how to obtain each key, step-by-step Vercel deploy
5. `.env.example`
6. An honest note on every limitation hit (ads, Spotify, playlist metadata) — in the README, not hidden

---

## 10. ACCEPTANCE TESTS

Explain how to verify each:

1. Two windows, same room, paste a YouTube link → both start within 250 ms of each other
2. Window A pauses → Window B pauses near-instantly, attributed to A
3. Window A changes volume → Window B unaffected
4. Window C joins mid-song → jumps straight to live position
5. Window D tries to join → blocked with "room's full"
6. Both windows spam play/pause simultaneously → state settles, no infinite loop
7. Kill A's network 10s, restore → A rejoins and re-syncs automatically
8. Paste a Spotify link → the Phase 0 fallback behaves as designed
9. Paste a playlist URL → expands into multiple queue items
10. Run 10 minutes continuously → drift stays under 150 ms

---

## 11. CONSTRAINTS AND ANTI-GOALS

- Non-commercial, private, ≤3 people. **No** auth hardening, rate limiting, analytics, or moderation.
- **No** music library, search UI, lyrics view, social feed, or recommendation engine. Paste-a-link is the entire input model.
- **No** chat feature unless everything else is finished and polished.
- **No** server-side audio processing of any kind.
- **Don't over-abstract.** A clear 15-file project beats a clever 60-file one.

---

## 12. WORKING STYLE

Think through the sync algorithm and conflict-resolution logic thoroughly before writing code. Those two decide whether this project succeeds. Everything else is straightforward UI work.

At a genuine fork, state both options and your pick with a one-sentence reason, then continue. Don't stop to ask unless it's a true blocker.

When editing this file's assumptions (stack, host, sync design), surface the change to the user explicitly rather than quietly revising.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

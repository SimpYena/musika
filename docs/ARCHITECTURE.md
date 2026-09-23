# Architecture — Musika

## The one-line version

Every browser loads its own copy of the same YouTube/SoundCloud embed and plays it locally.
The only thing that crosses the network is a ~200-byte JSON object describing *where the
playhead should be*. Audio never touches our server, and never passes between peers.

---

## Data flow

```
                        ┌──────────────────────────────────────────────┐
                        │  Vercel (static JS + one tiny JSON route)     │
                        │                                              │
                        │   GET /api/time  ->  { t: Date.now() }       │
                        └───────────────▲──────────────────────────────┘
                                        │  5 pings on join, then every 60 s
                                        │  offset = t_srv + rtt/2 - t_recv
                                        │  clockOffset = median(offsets)
                                        │
   ┌────────────────────────────────────┼────────────────────────────────────┐
   │                                    │                                    │
┌──┴──────────────┐            ┌────────┴────────┐                 ┌─────────┴───────┐
│  BROWSER  mina  │            │  BROWSER  jake  │                 │  BROWSER  sam   │
│   (ANCHOR)      │            │                 │                 │                 │
│                 │            │                 │                 │                 │
│ ┌─────────────┐ │            │ ┌─────────────┐ │                 │ ┌─────────────┐ │
│ │ YT / SC     │ │            │ │ YT / SC     │ │                 │ │ YT / SC     │ │
│ │ iframe      │◄┼── audio ───┼─┤ iframe      │◄┼──── audio ──────┼─┤ iframe      │ │
│ └──────▲──────┘ │  straight  │ └──────▲──────┘ │   straight from │ └──────▲──────┘ │
│        │        │  from      │        │        │   Google / SC   │        │        │
│  adapter│       │  Google/SC │  adapter│       │      CDNs       │  adapter│       │
│        │        │   CDNs     │        │        │                 │        │        │
│ ┌──────▼──────┐ │            │ ┌──────▼──────┐ │                 │ ┌──────▼──────┐ │
│ │ sync engine │ │            │ │ sync engine │ │                 │ │ sync engine │ │
│ │  1 Hz loop  │ │            │ │  1 Hz loop  │ │                 │ │  1 Hz loop  │ │
│ └──────▲──────┘ │            │ └──────▲──────┘ │                 │ └──────▲──────┘ │
└────────┼────────┘            └────────┼────────┘                 └────────┼────────┘
         │                              │                                   │
         └──────────────┬───────────────┴─────────────────┬─────────────────┘
                        │                                 │
                 ┌──────▼─────────────────────────────────▼──────┐
                 │   Supabase Realtime   channel "room:ABCD"     │
                 │   Broadcast (sync msgs)  +  Presence (seats)  │
                 │   anon key only · no table · no RLS · no fn   │
                 └───────────────────────────────────────────────┘
```

Note what is **not** in that diagram: no server of ours in the audio path, no server in the
message path, and no database. `/api/time` is a single JSON GET, invoked ~5× per user per minute.

---

## Message protocol

One broadcast event, `sync`, with a discriminated payload. Every message carries
`{v, type, actorId, at}`; control messages also carry `seq`.

| type | sent by | when | payload |
|---|---|---|---|
| `hello` | any | on subscribe | — (asks for current state) |
| `state` | **anchor only** | in reply to `hello` | full `RoomState` + queue |
| `ctrl` | any | play / pause / seek / skip / prev / stop / track change / queue edit | `kind`, `isPlaying`, `positionMs`, `trackIndex`, `queue?` |
| `tick` | **anchor only** | 1 Hz while playing | `positionMs`, `trackIndex` — re-anchors the timeline |
| `ready` | any | after cueing a new track | `trackId` |
| `start` | initiator | once all `ready` (or 5 s timeout) | `trackId`, `startAt`, `fromPositionMs` |

Volume is **never** in any message.

### The timeline

All clients compute the same function:

```
expectedPositionMs(now) = anchor.positionMs + (correctedNow() - anchor.at)     if playing
                        = anchor.positionMs                                     if paused
```

`anchor` is updated by `ctrl` (a deliberate action) and re-anchored by `tick` (absorbs accumulated
error). Because every client evaluates the identical expression against a clock corrected to the
same `/api/time` origin, they agree without further negotiation.

---

## Why there is an "anchor" but no host

CLAUDE.md requires that everyone has equal control, and they do — **any** client can emit `ctrl`,
and all clients apply it identically.

But if all three broadcast their *measured* position at 1 Hz, each one corrects toward the others
and the room oscillates — the classic three-clocks problem. So exactly one client is the **timeline
reference**: the present member with the lexicographically smallest `clientId`. It is computed
independently by every client from converged presence state, so it needs no election protocol and
re-derives instantly when someone leaves.

The anchor's only privileges are: emit `tick`, answer `hello`, and advance the queue on track end
(so three clients don't all emit a skip). It has no privilege over play/pause/seek/queue editing.

---

## Conflict resolution (CLAUDE.md §4's "most likely bug")

Three defenses, layered:

1. **Echo suppression.** `broadcast: { self: false }` on the channel, *and* an explicit
   `msg.actorId === myId → drop` check. The second is not redundant: self-suppression is scoped to
   a channel *instance*, so a reconnect that rebuilds the channel will echo the old instance's
   sends back at you.

2. **Monotonic `seq` with a deterministic tiebreak.** Each client tracks `(lastSeq, lastActor)`.
   Emitting uses `seq = lastSeq + 1`. A message is applied iff

   ```
   seq > lastSeq  ||  (seq === lastSeq && actorId > lastActor)
   ```

   Two clients acting simultaneously produce the same `seq`; the higher `actorId` wins **on every
   client**, so the room converges to one state rather than ping-ponging. This is what makes
   acceptance test 6 (both windows spamming play/pause) settle.

3. **No echo from effects.** Player commands issued while applying a remote message are wrapped in
   an `applyingRemote` guard, and broadcasts are emitted *only* from user-intent handlers — never
   from a player event callback. A player callback firing a broadcast is the loop that eats the app.

---

## Reconciliation loop (1 Hz)

```
every 1000 ms, for a non-anchor client:

  if stalled()                      -> HOLD    (see ad handling)
  drift = |localPosition - expectedPosition(correctedNow())|

  drift <  150 ms                   -> nothing
  150 <= drift <= 400 ms            -> needs 2 consecutive samples, then
                                       volume-duck 60 ms -> seekTo(expected, false) -> restore
                                       (5 s cooldown)
  drift >  400 ms                   -> seekTo(expected, true) immediately
```

The middle tier does **not** use `playbackRate` — see PHASE0.md §3 for why that is impossible on
all three engines, and what replaced it.

**Ad / stall hold.** `state === PLAYING` for > 2 s while the playhead advanced < 0.5 s means an ad
or a buffering stall. The client stops broadcasting position, stops correcting, buffers the latest
inbound `ctrl`, and shows amber. On exit it applies the buffered event plus one hard seek.

**Background tabs.** Timer throttling would normally degrade this, but a tab playing audio is
exempt from Chrome's intensive throttling. The loop is also written against timestamps rather than
accumulated ticks, so a delayed callback produces a late correction, never a wrong one. A
`visibilitychange → visible` transition forces an immediate reconcile.

---

## Synchronized start barrier

```
  initiator            everyone (incl. initiator)          initiator
 ───────────          ──────────────────────────          ──────────
  ctrl{track}  ──────►  cue source, stay paused
                        broadcast ready{trackId}  ──────►  collect readies
                                                           all in? or 5 s elapsed?
                        ◄──────────────────────────────── start{startAt = now+1500}
  at startAt (absolute, clock-corrected): play()
```

If `start` arrives after `startAt` has already passed, the client seeks to
`fromPositionMs + (now − startAt)` and plays immediately instead. A client that misses the barrier
entirely is caught by the drift loop within a second.

---

## Presence and the 3-seat cap

There is no compare-and-swap in Presence, so the cap cannot be enforced atomically. Instead every
client independently sorts the converged presence state by `(joinedAt, clientId)` — a **total**
order, because `clientId` breaks the tie when two clocks agree — and any client finding itself at
index ≥ 3 untracks itself and shows "room's full". Deterministic on every client, no race.

---

## File map

```
app/
  layout.tsx             fonts, theme, toast host
  globals.css            Tailwind v4 @theme design tokens — the whole palette lives here
  page.tsx               landing: pick a name, create or join
  room/[code]/page.tsx   the room
  api/time/route.ts      { t: Date.now() }  — the clock reference
lib/
  types.ts               RoomState, Track, SyncMessage
  identity.ts            username validation, avatar colour/emoji, localStorage
  clock.ts               NTP handshake, correctedNow()
  sources.ts             URL parsing + keyless oEmbed metadata + playlist expansion
  realtime.ts            Supabase channel: subscribe, broadcast, presence, reconnect
  store.ts               Zustand store (+ subscribeWithSelector for the out-of-React loop)
  sync.ts                THE SYNC ENGINE: seq, barrier, reconciliation, anchor election
  players/
    types.ts             PlayerAdapter interface
    youtube.ts           IFrame API adapter
    soundcloud.ts        Widget API adapter
components/
  ui.tsx                 Button / Card primitives (the chunky press-down physics)
  JoinGate.tsx           "Tap to join the vibe" — satisfies the autoplay gesture
  NowPlaying.tsx         artwork, title, source badge, mascot
  ProgressBar.tsx        isolated subscriber — the only thing that re-renders at 1 Hz
  SyncIndicator.tsx      green pulse / amber correcting
  Controls.tsx           play, pause, skip, prev, stop, scrub
  Queue.tsx              Reorder.Group drag-to-reorder
  AddToQueue.tsx         paste box + Spotify match picker
  Presence.tsx           avatars of who's listening
  Mascot.tsx             SVG cassette, coded not drawn
  Toasts.tsx             "mina skipped ⏭️" attribution
  EmptyStates.tsx        empty queue / room full / solo listener
```

## Performance

- The player component never re-renders on progress. Position lives in a `MotionValue` driven by
  a rAF loop outside React; `ProgressBar` is the only subscriber.
- Position broadcasts are throttled to 1 Hz and sent immediately on discrete events.
- Player SDK `<script>` tags are injected lazily, the first time a source of that type appears.

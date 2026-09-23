# 🎧 Musika

A tiny listening room for you and two friends. Paste a link, everybody hears the same song at the
same second.

No accounts, no passwords, no database. Rooms evaporate when the last person leaves — that is
deliberate.

---

## How it works, in one paragraph

Audio never touches our server and never passes between peers. Each browser loads its **own**
YouTube or SoundCloud embed and plays it locally; the only thing that crosses the network is a
small JSON object saying where the playhead should be. Clocks are aligned with an NTP-style
handshake, and a 1 Hz loop nudges each player back into line. Full design notes are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the research behind every technology choice is in
[docs/PHASE0.md](docs/PHASE0.md).

---

## Setup

### 1. Install

```bash
npm install
```

Node 20.9+ is required. Node 22 is what this was built and tested on.

### 2. Get Supabase keys (required, free, ~3 minutes)

Supabase is used **only** as a message relay. No tables, no schema, no SQL — its Realtime
Broadcast and Presence channels are called straight from the browser.

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **New project**. Any name, any region near your friends, any database password (you will
   never use it).
3. Wait ~2 minutes for it to provision.
4. Go to **Project Settings → Data API**.
5. Copy the **Project URL** → this is `NEXT_PUBLIC_SUPABASE_URL`.
6. Copy the **anon / public** key (labelled `publishable` on newer projects) →
   this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

> **Do not** turn off *Allow public access to channels* in Project Settings → Realtime. It is on by
> default, and it is what lets the app work with no server and no auth.

### 3. Get a YouTube API key (optional — skip this happily)

Everything works without it. It only enables automatic Spotify→YouTube matching and pre-play
durations. See `.env.example` for what it costs you.

1. [Google Cloud Console](https://console.cloud.google.com) → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **Credentials → Create credentials → API key**.
4. **Edit the key → Application restrictions → Websites (HTTP referrers)** and add
   `http://localhost:3000/*` plus your deployed domain.
5. **API restrictions → Restrict key → YouTube Data API v3**.

### 4. Configure and run

```bash
cp .env.example .env.local     # then paste your keys in
npm run check                  # verifies the connection before you go hunting
npm run dev
```

Open <http://localhost:3000>.

> **The one mistake everybody makes:** `NEXT_PUBLIC_SUPABASE_URL` must be the bare **Project URL**
> — `https://<ref>.supabase.co` — with **no path**. The dashboard also shows a REST endpoint
> ending in `/rest/v1/`; copying that one builds a broken WebSocket address and the room sits on
> "reconnecting…" forever with no other clue. The app now strips a stray path defensively, and
> `npm run check` tells you outright.

`npm run check` creates a client, joins a channel, tracks presence and round-trips a broadcast —
exactly what the app does — then reports which step failed.

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) and import it.
3. Framework preset auto-detects as **Next.js**. Leave the build settings alone.
4. Expand **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_YOUTUBE_API_KEY` *(only if you made one)*
5. Click **Deploy**.
6. If you made a YouTube key, go back to Google Cloud and add your new
   `https://your-app.vercel.app/*` to the key's referrer list.

That is the whole deploy. The free tier is more than enough: Vercel serves static files and one
tiny JSON route, and the WebSocket goes browser→Supabase directly, never through Vercel.

### Keeping a free Supabase project awake (recommended)

Free Supabase projects **pause after about a week without database activity**, and Realtime
traffic does not count as activity. If that happens, rooms silently stop syncing until you hit
*Resume* in the dashboard.

To avoid it, run this once in the Supabase **SQL Editor**:

```sql
create table if not exists public.heartbeat (id int primary key, at timestamptz default now());
insert into public.heartbeat (id) values (1) on conflict do nothing;
alter table public.heartbeat enable row level security;
create policy "anyone can read heartbeat" on public.heartbeat for select using (true);
```

Musika reads one row from it on load, which is enough to reset the inactivity timer. The app works
fine without this — it just may need a manual resume every so often.

---

## Testing that it actually works

Open two windows side by side. **Use two normal windows, not one window with two tabs** — actually,
two tabs is fine too: identity is stored per-tab precisely so you can test alone. Use a private
window for a third listener if you want to test the cap.

| # | Test | What should happen |
|---|---|---|
| 1 | Both windows join room `ABCD`, paste a YouTube link | Both start together — well inside 250 ms |
| 2 | Pause in window A | B pauses almost instantly, with a toast: *"mina paused ⏸️"* |
| 3 | Drag A's volume slider | B is completely unaffected. Volume is never broadcast |
| 4 | Open a third window mid-song | It jumps straight to the live position, not the next track |
| 5 | Open a fourth window | *"room's full 😢"* |
| 6 | Mash play/pause in both windows at once | Settles on one state within a second. No ping-pong |
| 7 | Turn off A's wifi for 10 s, turn it back on | *"reconnecting…"*, then rejoins and re-syncs itself |
| 8 | Paste a Spotify track link | With a key: a "which one is this?" picker. Without: a friendly explainer |
| 9 | Paste a YouTube playlist link | Expands into individual queue items |
| 10 | Leave it running 10 minutes | The sync dot stays green; drift stays under 150 ms |

For #10, the sync badge is the instrument: green means under 150 ms, amber shows the live drift
figure while it corrects, blue means it is holding through an ad.

---

## Honest limitations

These are real, and none of them are fixable from inside a browser-only app. They are listed here
rather than buried.

**Ads.** YouTube can play ads on embedded videos, and an embedding site cannot turn them off.
Since the November 2020 Terms update YouTube may monetize *any* video, including from channels not
in the Partner Program — so you cannot even pre-screen a link. If one listener gets a 20-second
pre-roll and another does not, they will be 20 seconds apart. Musika detects the stall, stops
fighting it, shows *"ad playing — catching up"*, and does one clean seek when the ad ends. Only a
YouTube Premium account on the listener's own browser removes ads. We use `youtube-nocookie.com`,
which makes ads non-personalized but does not remove them.

**Spotify is never actually played.** Spotify's playback SDK requires Premium on *every listener's*
account, which is a non-starter for a three-friend app. So a Spotify link is resolved to its title
and matched to a YouTube video instead, labelled *"matched from Spotify"*.

**Spotify does not tell us the artist.** Its public oEmbed endpoint returns a title and artwork and
nothing else — no artist, no duration, no track list. So matching a song called *"Alive"* is
genuinely ambiguous, and Musika asks you to pick from five candidates rather than guessing. Spotify
albums and playlists cannot be expanded at all, for the same reason.

**Some videos refuse to be embedded.** Uploaders can disable off-site playback. Musika shows a
message and skips to the next track.

**Short links don't work.** `spotify.link` serves a JavaScript interstitial rather than a redirect,
and `on.soundcloud.com` redirects without CORS headers. Neither can be followed from a browser.
Open them and paste the full address instead.

**Playlist durations.** Without a YouTube API key, track durations appear only once a track has
loaded. Playlist expansion itself works fine with no key at all.

**Anyone who guesses your room code can walk in.** Codes are 4 characters and the Supabase key is
public by design. The only gate is the 3-person cap. This is a private app for friends, so per the
project brief there is deliberately no auth, no rate limiting, and no moderation.

**Mobile is good, not perfect.** iOS is strict about programmatic audio, and iOS ignores
programmatic volume changes on media elements — use the hardware buttons there.

---

## Project layout

```
app/          routes: landing, /room/[code], and one /api/time JSON endpoint
components/   the UI
lib/          clock, sources, realtime, store, and sync — the interesting parts
lib/sync.ts   the sync engine: seq ordering, start barrier, drift correction
docs/         Phase 0 research and the architecture decision
```

## Scripts

```bash
npm run dev        # development
npm run build      # production build
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm test           # pure-logic self-tests (convergence rules, URL parsing)
npm run check      # diagnose the Supabase connection
```

import { correctedNow } from './clock'
import { RoomChannel, type ConnectionStatus } from './realtime'
import { SoundCloudPlayer } from './players/soundcloud'
import { YouTubePlayer } from './players/youtube'
import type { PlayerAdapter, PlayerEvent } from './players/types'
import {
  DRIFT_CONFIRM_SAMPLES,
  DRIFT_HARD_SEEK_MS,
  DRIFT_IGNORE_MS,
  MAX_MEMBERS,
  MICRO_SEEK_COOLDOWN_MS,
  MICRO_SEEK_DUCK_MS,
  PROTOCOL_VERSION,
  READY_TIMEOUT_MS,
  START_BARRIER_LEAD_MS,
  acceptsEvent,
  electAnchor,
  emptyRoomState,
  seatOrder,
  type CtrlKind,
  type Member,
  type RoomState,
  type SourceType,
  type OutboundMessage,
  type SyncMessage,
  type Track,
} from './types'

export type SyncPhase = 'idle' | 'cueing' | 'waiting' | 'playing'
export type SyncHealth = 'locked' | 'correcting' | 'holding'

export interface SyncCallbacks {
  onRoom: (state: RoomState) => void
  onMembers: (members: Member[]) => void
  onStatus: (status: ConnectionStatus) => void
  onHealth: (health: SyncHealth, driftMs: number) => void
  onToast: (text: string, emoji: string) => void
  onRoomFull: () => void
  onPlayerError: (message: string) => void
  /** Local volume, 0-100. Read (never broadcast) so micro-seeks can duck and restore it. */
  getVolume: () => number
}

const RECONCILE_INTERVAL_MS = 1000
const STALL_WINDOW_MS = 2000
const STALL_ADVANCE_MS = 500

export class SyncEngine {
  private channel: RoomChannel
  private player: PlayerAdapter | null = null
  private playerType: SourceType | null = null
  private unsubscribePlayer: (() => void) | null = null

  private room: RoomState
  private members: Member[] = []

  /** Conflict resolution: the highest (seq, actorId) we have applied. */
  private lastSeq = 0
  private lastActor = ''

  private phase: SyncPhase = 'idle'
  private hydrated = false

  // --- start barrier ---
  private barrierTrackId: string | null = null
  private barrierInitiator: string | null = null
  private barrierStartedAt = 0
  private readyClients = new Set<string>()
  private barrierTimer: ReturnType<typeof setTimeout> | null = null
  private startTimer: ReturnType<typeof setTimeout> | null = null
  private startFired = false

  // --- drift ---
  private loopTimer: ReturnType<typeof setInterval> | null = null
  private overThresholdSamples = 0
  private lastMicroSeekAt = 0
  private duckTimer: ReturnType<typeof setTimeout> | null = null

  // --- stall / ad detection ---
  private stalled = false
  private lastSamplePos = 0
  private lastSampleAt = 0
  private bufferedCtrl: SyncMessage | null = null

  // --- runaway guard for a queue full of dead links ---
  private autoAdvances: number[] = []

  private helloTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(
    private code: string,
    private me: Member,
    private container: HTMLElement,
    private cb: SyncCallbacks,
  ) {
    this.room = emptyRoomState(me.clientId)
    this.channel = new RoomChannel({
      code,
      me,
      onMessage: (m) => this.handleMessage(m),
      onMembers: (m) => this.handleMembers(m),
      onStatus: (s) => this.handleStatus(s),
    })
  }

  /* ---------------------------------------------------------------- *
   * lifecycle
   * ---------------------------------------------------------------- */

  start(): void {
    this.channel.connect()
    this.loopTimer = setInterval(() => this.reconcile(), RECONCILE_INTERVAL_MS)
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  destroy(): void {
    this.destroyed = true
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.loopTimer) clearInterval(this.loopTimer)
    if (this.barrierTimer) clearTimeout(this.barrierTimer)
    if (this.startTimer) clearTimeout(this.startTimer)
    if (this.helloTimer) clearTimeout(this.helloTimer)
    if (this.duckTimer) clearTimeout(this.duckTimer)
    this.unsubscribePlayer?.()
    this.player?.destroy()
    this.player = null
    this.channel.close()
  }

  /** Background tabs get throttled timers; reconcile the moment we're visible again. */
  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.reconcile()
  }

  private handleStatus(status: ConnectionStatus) {
    this.cb.onStatus(status)
    if (status === 'connected') {
      // Ask whoever is already here what's playing. Idempotent — safe to repeat on reconnect.
      this.send({ type: 'hello' })
      if (this.helloTimer) clearTimeout(this.helloTimer)
      this.helloTimer = setTimeout(() => {
        // Nobody answered: either we're first, or the anchor is slow. Either way, stop waiting.
        this.hydrated = true
      }, 2500)
    }
  }

  /* ---------------------------------------------------------------- *
   * presence, seats, anchor election
   * ---------------------------------------------------------------- */

  private handleMembers(members: Member[]) {
    const ordered = seatOrder(members)
    const seatIndex = ordered.findIndex((m) => m.clientId === this.me.clientId)

    if (seatIndex >= MAX_MEMBERS) {
      // Every client computes this identically, so the overflow member evicts itself. No CAS needed.
      void this.channel.releaseSeat()
      this.cb.onRoomFull()
      return
    }

    const seated = ordered.slice(0, MAX_MEMBERS)
    const previous = new Set(this.members.map((m) => m.clientId))
    this.members = seated
    this.cb.onMembers(seated)

    for (const m of seated) {
      if (m.clientId !== this.me.clientId && !previous.has(m.clientId) && previous.size > 0) {
        this.cb.onToast(`${m.username} joined`, m.emoji)
      }
    }

    // A pending barrier may now be satisfiable with fewer people in the room.
    this.maybeFireStart()
  }

  /**
   * The timeline reference. Not a host: it cannot do anything the others can't. It exists only so
   * that exactly one client's measured position defines "now", instead of three clients
   * correcting toward each other and oscillating.
   */
  private anchorId(): string {
    return electAnchor(this.members, this.me.clientId)
  }

  private isAnchor(): boolean {
    return this.anchorId() === this.me.clientId
  }

  /* ---------------------------------------------------------------- *
   * messaging
   * ---------------------------------------------------------------- */

  private send(partial: OutboundMessage): void {
    this.channel.send({
      v: PROTOCOL_VERSION,
      actorId: this.me.clientId,
      at: correctedNow(),
      ...partial,
    } as SyncMessage)
  }

  private accepts(seq: number, actorId: string): boolean {
    return acceptsEvent({ seq, actorId }, { seq: this.lastSeq, actorId: this.lastActor })
  }

  private handleMessage(msg: SyncMessage) {
    if (this.destroyed) return
    // Echo suppression. broadcast.self is already false, but that is scoped to a channel
    // instance — a rebuilt channel will happily replay our old sends at us.
    if (msg.actorId === this.me.clientId) return

    switch (msg.type) {
      case 'hello':
        if (this.isAnchor() && this.hydrated) {
          this.send({ type: 'state', state: this.room })
        }
        break

      case 'state':
        if (!this.hydrated) {
          this.hydrated = true
          if (this.helloTimer) clearTimeout(this.helloTimer)
          this.lastSeq = msg.state.seq
          this.lastActor = msg.state.actorId
          this.room = msg.state
          this.cb.onRoom(this.room)
          // Late joiner: go straight to the live position, never wait for the next track.
          void this.adoptCurrentTrack(true)
        }
        break

      case 'ctrl': {
        if (!this.accepts(msg.seq, msg.actorId)) return
        this.attribute(msg.actorId, msg.kind, msg.state)
        if (this.stalled) {
          // Mid-ad, playVideo/pauseVideo would control the ad, not the content. Hold it.
          this.bufferedCtrl = msg
          this.lastSeq = msg.seq
          this.lastActor = msg.actorId
          this.room = msg.state
          this.cb.onRoom(this.room)
          return
        }
        this.lastSeq = msg.seq
        this.lastActor = msg.actorId
        this.applyRemoteState(msg.state, msg.kind)
        break
      }

      case 'tick':
        this.applyTick(msg)
        break

      case 'ready':
        if (msg.trackId === this.barrierTrackId) {
          this.readyClients.add(msg.actorId)
          this.maybeFireStart()
        }
        break

      case 'start':
        if (msg.trackId === this.barrierTrackId || msg.trackId === this.room.trackId) {
          this.scheduleStart(msg.startAt, msg.fromPositionMs, msg.trackId)
        }
        break
    }
  }

  /**
   * Attribution toasts. Only for other people's actions — narrating your own clicks back at you
   * is noise. Without this, things change for no visible reason and the room feels haunted.
   */
  private attribute(actorId: string, kind: CtrlKind, next: RoomState) {
    const who = this.members.find((m) => m.clientId === actorId)
    if (!who) return
    const name = who.username

    switch (kind) {
      case 'play':
        this.cb.onToast(`${name} hit play`, '▶️')
        break
      case 'pause':
        this.cb.onToast(`${name} paused`, '⏸️')
        break
      case 'skip':
        this.cb.onToast(`${name} skipped`, '⏭️')
        break
      case 'prev':
        this.cb.onToast(`${name} went back`, '⏮️')
        break
      case 'stop':
        this.cb.onToast(`${name} stopped the music`, '⏹️')
        break
      case 'seek':
        this.cb.onToast(`${name} scrubbed`, '⏩')
        break
      case 'track': {
        const title = next.queue[next.trackIndex]?.title
        this.cb.onToast(title ? `${name} put on ${title}` : `${name} changed the track`, '🎵')
        break
      }
      case 'queue': {
        const added = next.queue.length - this.room.queue.length
        if (added > 0) {
          this.cb.onToast(
            added === 1 ? `${name} queued a track` : `${name} queued ${added} tracks`,
            '➕',
          )
        } else if (added < 0) {
          this.cb.onToast(`${name} removed a track`, '🗑️')
        } else {
          this.cb.onToast(`${name} shuffled the queue`, '🔀')
        }
        break
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * applying state
   * ---------------------------------------------------------------- */

  private applyRemoteState(next: RoomState, kind: CtrlKind) {
    const previousTrackId = this.room.trackId
    const wasPlaying = this.room.isPlaying
    this.room = next
    this.cb.onRoom(this.room)

    if (next.trackId !== previousTrackId) {
      void this.adoptCurrentTrack(false)
      return
    }

    if (kind === 'seek') {
      this.player?.seek(next.positionMs, true)
      this.resetDriftWindow()
    }

    if (next.isPlaying !== wasPlaying) {
      if (next.isPlaying) {
        this.player?.seek(this.expectedPosition(), true)
        this.player?.play()
        this.phase = 'playing'
      } else {
        this.player?.pause()
      }
      this.resetDriftWindow()
    }
  }

  private applyTick(msg: Extract<SyncMessage, { type: 'tick' }>) {
    // Ticks are advisory: they re-anchor the timeline but never reorder against ctrl.
    if (msg.actorId !== this.anchorId()) return
    if (msg.trackId !== this.room.trackId) return
    if (msg.seq < this.lastSeq) return

    this.room = {
      ...this.room,
      positionMs: msg.positionMs,
      emittedAtServerMs: msg.at,
      isPlaying: msg.isPlaying,
    }
  }

  /** Where the playhead should be right now, computed identically by every client. */
  private expectedPosition(at: number = correctedNow()): number {
    if (!this.room.isPlaying) return this.room.positionMs
    return this.room.positionMs + (at - this.room.emittedAtServerMs)
  }

  /* ---------------------------------------------------------------- *
   * track changes and the start barrier
   * ---------------------------------------------------------------- */

  private async ensureAdapter(type: SourceType): Promise<PlayerAdapter> {
    if (this.player && this.playerType === type) return this.player

    this.unsubscribePlayer?.()
    this.player?.destroy()
    this.container.replaceChildren()

    const player =
      type === 'youtube' ? new YouTubePlayer(this.container) : new SoundCloudPlayer(this.container)
    this.player = player
    this.playerType = type
    this.unsubscribePlayer = player.subscribe((e) => this.onPlayerEvent(e))
    return player
  }

  /**
   * Cue whatever the room says is current, then either join the start barrier or, for a late
   * joiner, jump straight to the live position.
   */
  private async adoptCurrentTrack(seekLive: boolean): Promise<void> {
    const track = this.currentTrack()
    if (!track) {
      this.phase = 'idle'
      this.player?.pause()
      return
    }

    this.phase = 'cueing'
    this.barrierTrackId = track.id
    this.barrierInitiator = this.room.actorId
    this.barrierStartedAt = correctedNow()
    this.startFired = false
    this.readyClients = new Set([this.me.clientId])
    this.resetDriftWindow()

    const startAt = seekLive ? this.expectedPosition() : this.room.positionMs
    const player = await this.ensureAdapter(track.sourceType)
    if (this.destroyed) return
    await player.cue(track, Math.max(0, startAt))
    if (this.destroyed) return
    player.setVolume(this.cb.getVolume())

    if (!this.room.isPlaying) {
      this.phase = 'idle'
      return
    }

    if (seekLive) {
      // Mid-song arrival: no barrier, just land on the live position immediately.
      player.seek(this.expectedPosition(), true)
      player.play()
      this.phase = 'playing'
      return
    }

    this.phase = 'waiting'
    this.send({ type: 'ready', trackId: track.id })

    if (this.barrierTimer) clearTimeout(this.barrierTimer)
    this.barrierTimer = setTimeout(() => this.maybeFireStart(true), READY_TIMEOUT_MS)
    this.maybeFireStart()
  }

  /** Only the client that initiated the track change fires the barrier. */
  private maybeFireStart(force = false) {
    if (this.startFired) return
    if (!this.barrierTrackId) return
    if (this.barrierInitiator !== this.me.clientId) return
    if (this.phase !== 'waiting') return

    const everyoneReady = this.members.every((m) => this.readyClients.has(m.clientId))
    const timedOut = force || correctedNow() - this.barrierStartedAt > READY_TIMEOUT_MS
    if (!everyoneReady && !timedOut) return

    this.startFired = true
    const startAt = correctedNow() + START_BARRIER_LEAD_MS
    const fromPositionMs = this.room.positionMs
    this.send({
      type: 'start',
      trackId: this.barrierTrackId,
      startAt,
      fromPositionMs,
    })
    this.scheduleStart(startAt, fromPositionMs, this.barrierTrackId)
  }

  private scheduleStart(startAt: number, fromPositionMs: number, trackId: string) {
    if (this.startTimer) clearTimeout(this.startTimer)
    const delay = startAt - correctedNow()

    const begin = () => {
      if (this.destroyed || this.room.trackId !== trackId) return
      // Anchor the shared timeline to the barrier instant, so everyone extrapolates from the
      // same origin regardless of when their own timer actually fired.
      this.room = {
        ...this.room,
        positionMs: fromPositionMs,
        emittedAtServerMs: startAt,
        isPlaying: true,
      }
      this.cb.onRoom(this.room)
      this.phase = 'playing'
      this.resetDriftWindow()

      const target = this.expectedPosition()
      if (Math.abs(target - (this.player?.getPositionMs() ?? 0)) > DRIFT_IGNORE_MS) {
        this.player?.seek(target, true)
      }
      this.player?.play()
    }

    if (delay > 0) this.startTimer = setTimeout(begin, delay)
    else begin() // the message arrived late — catch up rather than waiting a whole track
  }

  private currentTrack(): Track | null {
    const { queue, trackIndex } = this.room
    if (trackIndex < 0 || trackIndex >= queue.length) return null
    return queue[trackIndex]
  }

  /* ---------------------------------------------------------------- *
   * player events
   * ---------------------------------------------------------------- */

  private onPlayerEvent(e: PlayerEvent) {
    // Nothing here ever broadcasts a ctrl except a genuine track-end advance. A player callback
    // that echoes state back onto the wire is the loop that eats the app.
    switch (e.type) {
      case 'ended':
        if (this.isAnchor()) this.advanceAfterEnd()
        break
      case 'error':
        this.cb.onPlayerError(e.error.message)
        if (e.error.fatal && this.isAnchor()) this.advanceAfterEnd()
        break
      default:
        break
    }
  }

  private advanceAfterEnd() {
    // A queue full of dead links would otherwise spin through itself at full speed.
    const now = Date.now()
    this.autoAdvances = this.autoAdvances.filter((t) => now - t < 10_000)
    if (this.autoAdvances.length >= 5) {
      this.cb.onToast('too many unplayable tracks in a row', '😵')
      this.emitCtrl('pause', (s) => ({ ...s, isPlaying: false }))
      return
    }
    this.autoAdvances.push(now)

    const next = this.room.trackIndex + 1
    if (next >= this.room.queue.length) {
      this.emitCtrl('stop', (s) => ({
        ...s,
        isPlaying: false,
        positionMs: 0,
      }))
      return
    }
    this.selectIndex(next, 'track')
  }

  /* ---------------------------------------------------------------- *
   * reconciliation loop
   * ---------------------------------------------------------------- */

  private resetDriftWindow() {
    this.overThresholdSamples = 0
    this.lastSamplePos = this.player?.getPositionMs() ?? 0
    this.lastSampleAt = Date.now()
  }

  private reconcile() {
    if (this.destroyed || !this.player) return

    /* Self-heal: if the player is holding a different track from the one the room says is
     * current, a track change was missed — most likely it arrived while we were stalled on an
     * ad, where inbound control events are buffered rather than applied. Re-adopt and seek live
     * rather than silently playing the wrong song. */
    if (
      this.phase !== 'cueing' &&
      this.room.trackId &&
      this.player.getCuedTrackId() !== null &&
      this.player.getCuedTrackId() !== this.room.trackId
    ) {
      void this.adoptCurrentTrack(true)
      return
    }

    if (this.phase !== 'playing' || !this.room.isPlaying) {
      this.cb.onHealth('locked', 0)
      return
    }

    const position = this.player.getPositionMs()
    const wallElapsed = Date.now() - this.lastSampleAt
    const advanced = position - this.lastSamplePos

    /* --- stall / ad hold --------------------------------------------------- */
    if (wallElapsed >= STALL_WINDOW_MS) {
      const wasStalled = this.stalled
      this.stalled = advanced < STALL_ADVANCE_MS
      this.lastSamplePos = position
      this.lastSampleAt = Date.now()

      if (wasStalled && !this.stalled) {
        // Ad or buffering is over: apply whatever we held, then one hard correction.
        const held = this.bufferedCtrl
        this.bufferedCtrl = null
        if (held && held.type === 'ctrl') {
          // `this.room` was already advanced to the held state while stalled, so a diff against
          // it would see no track change. Compare against what the player actually holds.
          if (this.player.getCuedTrackId() !== held.state.trackId) {
            void this.adoptCurrentTrack(true)
            return
          }
          this.applyRemoteState(held.state, held.kind)
        }
        this.player.seek(this.expectedPosition(), true)
        this.overThresholdSamples = 0
      }
    }

    if (this.stalled) {
      this.cb.onHealth('holding', 0)
      return
    }

    /* --- drift ------------------------------------------------------------- */
    const expected = this.expectedPosition()
    const drift = position - expected
    const magnitude = Math.abs(drift)

    // The anchor defines the timeline, so it re-anchors from its own player — but only while it
    // is in good shape. A freshly-unstalled anchor corrects itself first rather than yanking
    // everyone else back to where its ad left it.
    if (this.isAnchor() && magnitude < DRIFT_IGNORE_MS) {
      this.room = {
        ...this.room,
        positionMs: position,
        emittedAtServerMs: correctedNow(),
      }
      this.send({
        type: 'tick',
        seq: this.lastSeq,
        trackId: this.room.trackId,
        positionMs: position,
        isPlaying: true,
      })
      this.cb.onHealth('locked', 0)
      return
    }

    if (magnitude < DRIFT_IGNORE_MS) {
      this.overThresholdSamples = 0
      this.cb.onHealth('locked', drift)
      return
    }

    if (magnitude > DRIFT_HARD_SEEK_MS) {
      this.player.seek(expected, true)
      this.overThresholdSamples = 0
      this.cb.onHealth('correcting', drift)
      return
    }

    /* --- tier 2: volume-ducked micro-seek ---------------------------------- *
     * playbackRate nudging is impossible here (see docs/PHASE0.md §3): YouTube rounds 0.97 and
     * 1.03 both to 1.0, and SoundCloud has no rate API at all. A short volume duck around a
     * buffered seek is the closest achievable thing to an inaudible correction.                */
    this.overThresholdSamples += 1
    this.cb.onHealth('correcting', drift)

    const confirmed = this.overThresholdSamples >= DRIFT_CONFIRM_SAMPLES
    const cooledDown = Date.now() - this.lastMicroSeekAt > MICRO_SEEK_COOLDOWN_MS
    if (!confirmed || !cooledDown) return

    this.overThresholdSamples = 0
    this.lastMicroSeekAt = Date.now()
    this.microSeek(expected)
  }

  private microSeek(target: number) {
    const player = this.player
    if (!player) return
    const volume = this.cb.getVolume()

    player.setVolume(0)
    // allowSeekAhead:false keeps this inside the buffered range — no refetch, no rebuffer.
    player.seek(target, false)
    if (this.duckTimer) clearTimeout(this.duckTimer)
    this.duckTimer = setTimeout(() => {
      player.setVolume(volume)
    }, MICRO_SEEK_DUCK_MS)
  }

  /* ---------------------------------------------------------------- *
   * local intent -> broadcast
   * ---------------------------------------------------------------- */

  private emitCtrl(kind: CtrlKind, mutate: (state: RoomState) => RoomState) {
    const base = mutate(this.room)
    this.lastSeq += 1
    this.lastActor = this.me.clientId

    const next: RoomState = {
      ...base,
      seq: this.lastSeq,
      actorId: this.me.clientId,
      emittedAtServerMs: correctedNow(),
    }

    const previousTrackId = this.room.trackId
    const wasPlaying = this.room.isPlaying
    this.room = next
    this.cb.onRoom(next)
    this.send({ type: 'ctrl', seq: next.seq, kind, state: next })

    // Apply locally along exactly the same paths a remote client would take.
    if (next.trackId !== previousTrackId) {
      void this.adoptCurrentTrack(false)
      return
    }
    if (kind === 'seek') {
      this.player?.seek(next.positionMs, true)
      this.resetDriftWindow()
    }
    if (next.isPlaying !== wasPlaying) {
      if (next.isPlaying) {
        this.player?.play()
        this.phase = this.currentTrack() ? 'playing' : 'idle'
      } else {
        this.player?.pause()
      }
      this.resetDriftWindow()
    }
  }

  private withTrack(state: RoomState, index: number): RoomState {
    const track = state.queue[index] ?? null
    return {
      ...state,
      trackIndex: track ? index : -1,
      trackId: track?.id ?? null,
      sourceType: track?.sourceType ?? null,
      sourceUrl: track?.sourceUrl ?? null,
      positionMs: 0,
    }
  }

  /* ----- public actions -------------------------------------------------- */

  togglePlay(): void {
    if (!this.currentTrack()) {
      if (this.room.queue.length > 0) this.selectIndex(0, 'track')
      return
    }
    const playing = !this.room.isPlaying
    this.emitCtrl(playing ? 'play' : 'pause', (s) => ({
      ...s,
      isPlaying: playing,
      positionMs: this.player?.getPositionMs() ?? s.positionMs,
    }))
  }

  seekTo(positionMs: number): void {
    this.emitCtrl('seek', (s) => ({ ...s, positionMs: Math.max(0, positionMs) }))
  }

  skip(): void {
    const next = this.room.trackIndex + 1
    if (next >= this.room.queue.length) {
      this.emitCtrl('stop', (s) => ({ ...this.withTrack(s, -1), isPlaying: false }))
      return
    }
    this.selectIndex(next, 'skip')
  }

  previous(): void {
    // Restart the current track first, like every music player ever.
    if ((this.player?.getPositionMs() ?? 0) > 3000) {
      this.seekTo(0)
      return
    }
    const prev = this.room.trackIndex - 1
    if (prev < 0) {
      this.seekTo(0)
      return
    }
    this.selectIndex(prev, 'prev')
  }

  stop(): void {
    this.emitCtrl('stop', (s) => ({ ...s, isPlaying: false, positionMs: 0 }))
  }

  selectIndex(index: number, kind: CtrlKind = 'track'): void {
    this.emitCtrl(kind, (s) => ({ ...this.withTrack(s, index), isPlaying: true }))
  }

  addTracks(tracks: Track[]): void {
    if (tracks.length === 0) return
    const wasEmpty = this.room.queue.length === 0
    this.emitCtrl('queue', (s) => {
      const queue = [...s.queue, ...tracks]
      if (wasEmpty) {
        return { ...this.withTrack({ ...s, queue }, 0), isPlaying: true }
      }
      return { ...s, queue }
    })
  }

  removeTrack(trackId: string): void {
    const index = this.room.queue.findIndex((t) => t.id === trackId)
    if (index < 0) return

    this.emitCtrl('queue', (s) => {
      const queue = s.queue.filter((t) => t.id !== trackId)
      if (index < s.trackIndex) {
        // Everything shifted down by one; keep pointing at the same song.
        return { ...s, queue, trackIndex: s.trackIndex - 1 }
      }
      if (index === s.trackIndex) {
        const nextIndex = Math.min(index, queue.length - 1)
        return { ...this.withTrack({ ...s, queue }, nextIndex), isPlaying: s.isPlaying }
      }
      return { ...s, queue }
    })
  }

  reorderQueue(queue: Track[]): void {
    const currentId = this.room.trackId
    this.emitCtrl('queue', (s) => ({
      ...s,
      queue,
      trackIndex: currentId ? queue.findIndex((t) => t.id === currentId) : s.trackIndex,
    }))
  }

  /* ----- read-only accessors for the UI ---------------------------------- */

  getRoom(): RoomState {
    return this.room
  }

  getPositionMs(): number {
    if (!this.player) return 0
    return this.phase === 'playing' ? this.player.getPositionMs() : this.room.positionMs
  }

  getDurationMs(): number {
    const fromPlayer = this.player?.getDurationMs() ?? 0
    if (fromPlayer > 0) return fromPlayer
    return this.currentTrack()?.durationMs ?? 0
  }

  setVolume(volume: number): void {
    this.player?.setVolume(volume)
  }

  getAnchorId(): string {
    return this.anchorId()
  }
}

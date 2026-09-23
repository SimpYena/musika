import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from './env'
import type { Member, SyncMessage } from './types'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed'

let client: SupabaseClient | null = null

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

function getClient(): SupabaseClient {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars are missing')

  client = createClient(normalizeSupabaseUrl(url), key, {
    auth: { persistSession: false },
    // Default is 10/s. A track change can burst play + seek + 3 readies in one second.
    realtime: { params: { eventsPerSecond: 20 } },
  })
  return client
}

/**
 * Free Supabase projects pause after ~1 week without *database* activity — Realtime traffic does
 * not count. One trivial select on load resets that timer. Silently ignored if the optional table
 * doesn't exist, so the app works without any SQL being run.
 */
export async function pokeKeepAlive(): Promise<void> {
  if (!supabaseConfigured()) return
  try {
    await getClient().from('heartbeat').select('id').limit(1)
  } catch {
    /* table is optional */
  }
}

export interface RoomChannelOptions {
  code: string
  me: Member
  onMessage: (message: SyncMessage) => void
  onMembers: (members: Member[]) => void
  onStatus: (status: ConnectionStatus) => void
}

export class RoomChannel {
  private channel: RealtimeChannel | null = null
  private closed = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private options: RoomChannelOptions) {}

  connect(): void {
    if (this.closed) return
    this.teardownChannel()
    this.options.onStatus(this.retries === 0 ? 'connecting' : 'reconnecting')

    const supabase = getClient()
    const channel = supabase.channel(`room:${this.options.code}`, {
      config: {
        // self:false already suppresses our own echoes, but the sync engine still checks actorId:
        // suppression is per channel *instance*, so a rebuilt channel can echo the old one's sends.
        broadcast: { self: false, ack: false },
        presence: { key: this.options.me.clientId },
      },
    })

    // Presence handlers must be registered BEFORE subscribe() — realtime-js only enables presence
    // if it sees a handler at subscribe time, and track() silently no-ops otherwise.
    channel
      .on('broadcast', { event: 'sync' }, ({ payload }) => {
        this.options.onMessage(payload as SyncMessage)
      })
      .on('presence', { event: 'sync' }, () => this.publishMembers(channel))
      .on('presence', { event: 'join' }, () => this.publishMembers(channel))
      .on('presence', { event: 'leave' }, () => this.publishMembers(channel))
      .subscribe((status) => {
        if (this.closed) return
        if (status === 'SUBSCRIBED') {
          this.retries = 0
          this.options.onStatus('connected')
          void channel.track(this.options.me)
          this.publishMembers(channel)
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // realtime-js auto-reconnects the socket, but channels are known to get stuck after
          // these states. Rebuild from scratch rather than trusting recovery.
          this.scheduleReconnect()
        }
      })

    this.channel = channel
  }

  private publishMembers(channel: RealtimeChannel) {
    const state = channel.presenceState<Member>()
    const members: Member[] = []
    const seen = new Set<string>()
    // presenceState() gives an ARRAY of metas per key — a reconnect can leave two for one person.
    for (const metas of Object.values(state)) {
      for (const meta of metas) {
        if (!meta?.clientId || seen.has(meta.clientId)) continue
        seen.add(meta.clientId)
        members.push({
          clientId: meta.clientId,
          username: meta.username,
          color: meta.color,
          emoji: meta.emoji,
          joinedAt: meta.joinedAt,
        })
      }
    }
    this.options.onMembers(members)
  }

  private scheduleReconnect() {
    if (this.closed || this.retryTimer) return
    this.retries += 1
    if (this.retries > 12) {
      this.options.onStatus('failed')
      return
    }
    this.options.onStatus('reconnecting')
    const base = Math.min(1000 * 2 ** (this.retries - 1), 10_000)
    const jitter = Math.random() * 400
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, base + jitter)
  }

  send(message: SyncMessage): void {
    if (!this.channel) return
    void this.channel.send({ type: 'broadcast', event: 'sync', payload: message })
  }

  /** Give up our seat without tearing down the socket — used when the room turns out to be full. */
  async releaseSeat(): Promise<void> {
    try {
      await this.channel?.untrack()
    } catch {
      /* already gone */
    }
  }

  private teardownChannel() {
    if (!this.channel) return
    try {
      void getClient().removeChannel(this.channel)
    } catch {
      /* already removed */
    }
    this.channel = null
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.teardownChannel()
  }
}

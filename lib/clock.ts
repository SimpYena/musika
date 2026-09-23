/**
 * NTP-style clock synchronisation.
 *
 * Client clocks routinely differ by hundreds of ms, which would wreck every timestamp in the sync
 * protocol. We measure the offset against /api/time and correct every timestamp we read or write.
 *
 * Handshake: 5 pings, each measuring round-trip time. For one ping,
 *
 *     offset = t_server + rtt/2 - t_client_received
 *
 * We take the median, which throws away the samples that got stuck behind a slow request. Re-run
 * every 60 s to track drift between the two clocks.
 */

const PING_COUNT = 5
const RESYNC_INTERVAL_MS = 60_000
const PING_TIMEOUT_MS = 4000

let clockOffset = 0
let synced = false
let lastError: string | null = null
let timer: ReturnType<typeof setInterval> | null = null

/** Wall-clock time corrected to the room's shared reference. Use this for every protocol timestamp. */
export function correctedNow(): number {
  return Date.now() + clockOffset
}

export function getClockOffset(): number {
  return clockOffset
}

export function isClockSynced(): boolean {
  return synced
}

export function getClockError(): string | null {
  return lastError
}

async function ping(): Promise<{ offset: number; rtt: number } | null> {
  const t0 = Date.now()
  try {
    const controller = new AbortController()
    const abort = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    const res = await fetch('/api/time', {
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(abort)
    if (!res.ok) return null
    const { t } = (await res.json()) as { t: number }
    const t1 = Date.now()
    const rtt = t1 - t0
    // Assume the request and the response each took half the round trip.
    return { offset: t + rtt / 2 - t1, rtt }
  } catch {
    return null
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Run the handshake once. Safe to call repeatedly. */
export async function syncClock(): Promise<boolean> {
  const samples: { offset: number; rtt: number }[] = []
  for (let i = 0; i < PING_COUNT; i++) {
    const s = await ping()
    if (s) samples.push(s)
  }

  if (samples.length === 0) {
    lastError = "couldn't reach the clock"
    // Keep whatever offset we had rather than lurching back to 0 mid-session.
    return false
  }

  // Low-RTT samples are the trustworthy ones — a slow round trip is usually asymmetric, which
  // breaks the rtt/2 assumption. Keep the better half, then take the median of those.
  const byRtt = [...samples].sort((a, b) => a.rtt - b.rtt)
  const keep = byRtt.slice(0, Math.max(1, Math.ceil(byRtt.length / 2)))

  clockOffset = median(keep.map((s) => s.offset))
  synced = true
  lastError = null
  return true
}

/** Start the handshake and keep it fresh. Returns a cleanup function. */
export function startClock(): () => void {
  void syncClock()
  if (timer) clearInterval(timer)
  timer = setInterval(() => void syncClock(), RESYNC_INTERVAL_MS)

  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncClock()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisible)
  }
}

'use client'

import { useApp } from '@/lib/store'

/**
 * Green pulse under 150 ms of drift, amber while correcting, blue while holding for an ad or a
 * buffering stall, and a calm reconnecting state when the channel drops.
 */
export function SyncIndicator() {
  const health = useApp((s) => s.health)
  const driftMs = useApp((s) => s.driftMs)
  const status = useApp((s) => s.status)

  const reconnecting = status === 'reconnecting' || status === 'connecting'
  const failed = status === 'failed'

  const { color, label } = failed
    ? { color: 'var(--color-coral)', label: "can't reach the room" }
    : reconnecting
      ? { color: 'var(--color-ink-soft)', label: 'reconnecting…' }
      : health === 'holding'
        ? { color: '#60A5FA', label: 'ad playing — catching up' }
        : health === 'correcting'
          ? { color: 'var(--color-sunshine)', label: `nudging ${Math.abs(Math.round(driftMs))}ms` }
          : { color: 'var(--color-mint)', label: 'in sync' }

  const animate = !failed && (health === 'locked' || reconnecting)

  return (
    <div
      className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] border-[3px] border-ink px-3 py-1.5"
      style={{ background: 'var(--color-paper-raised)' }}
      aria-live="polite"
    >
      <span
        className={`block h-2.5 w-2.5 rounded-full ${animate ? 'pulse-dot' : ''}`}
        style={{ background: color }}
      />
      <span className="text-xs font-extrabold text-ink">{label}</span>
    </div>
  )
}

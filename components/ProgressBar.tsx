'use client'

import { useRef, useState } from 'react'
import { usePlayhead } from '@/lib/store'
import { formatTime } from './ui'

/**
 * The only component that re-renders on progress ticks.
 *
 * It subscribes to `usePlayhead` and nothing else, which is what keeps the player and Now Playing
 * cards still while the bar animates (CLAUDE.md §8).
 */
export function ProgressBar({
  onSeek,
  disabled,
}: {
  onSeek: (ms: number) => void
  disabled: boolean
}) {
  const positionMs = usePlayhead((s) => s.positionMs)
  const durationMs = usePlayhead((s) => s.durationMs)

  const trackRef = useRef<HTMLDivElement>(null)
  const [scrubMs, setScrubMs] = useState<number | null>(null)

  const shown = scrubMs ?? positionMs
  const pct = durationMs > 0 ? Math.min(100, Math.max(0, (shown / durationMs) * 100)) : 0

  const msFromEvent = (clientX: number): number => {
    const el = trackRef.current
    if (!el || durationMs <= 0) return 0
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * durationMs
  }

  const beginScrub = (clientX: number) => {
    if (disabled || durationMs <= 0) return
    setScrubMs(msFromEvent(clientX))

    const move = (e: PointerEvent) => setScrubMs(msFromEvent(e.clientX))
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const target = msFromEvent(e.clientX)
      setScrubMs(null)
      onSeek(target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="w-full">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000) || 0}
        aria-valuenow={Math.round(shown / 1000)}
        aria-valuetext={`${formatTime(shown)} of ${formatTime(durationMs)}`}
        onPointerDown={(e) => {
          e.preventDefault()
          beginScrub(e.clientX)
        }}
        onKeyDown={(e) => {
          if (disabled || durationMs <= 0) return
          if (e.key === 'ArrowRight') onSeek(Math.min(durationMs, positionMs + 5000))
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, positionMs - 5000))
        }}
        className={`relative h-5 w-full rounded-[var(--radius-pill)] border-[3px] border-ink ${
          disabled ? 'cursor-default opacity-60' : 'cursor-pointer'
        }`}
        style={{ background: 'var(--color-paper-sunk)' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-[var(--radius-pill)]"
          style={{
            width: `${pct}%`,
            background: 'var(--color-lilac)',
            transition: scrubMs === null ? 'width 220ms linear' : 'none',
          }}
        />
        {!disabled && durationMs > 0 && (
          <div
            className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-[3px] border-ink bg-sunshine"
            style={{
              left: `calc(${pct}% - 10px)`,
              transition: scrubMs === null ? 'left 220ms linear' : 'none',
            }}
          />
        )}
      </div>

      <div className="mt-2 flex justify-between text-xs font-extrabold text-ink-soft tabular-nums">
        <span>{formatTime(shown)}</span>
        <span>{durationMs > 0 ? formatTime(durationMs) : '--:--'}</span>
      </div>
    </div>
  )
}

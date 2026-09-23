'use client'

import {
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerSimpleXIcon,
  StopIcon,
} from '@phosphor-icons/react'
import { useApp } from '@/lib/store'
import { Button } from './ui'

export function Controls({
  onPlayPause,
  onSkip,
  onPrevious,
  onStop,
  disabled,
}: {
  onPlayPause: () => void
  onSkip: () => void
  onPrevious: () => void
  onStop: () => void
  disabled: boolean
}) {
  const isPlaying = useApp((s) => s.room.isPlaying)

  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        tone="paper"
        icon
        onClick={onPrevious}
        disabled={disabled}
        aria-label="Previous track"
      >
        <SkipBackIcon size={24} weight="fill" />
      </Button>

      <Button
        tone={isPlaying ? 'sun' : 'mint'}
        onClick={onPlayPause}
        disabled={disabled}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className="h-[64px] w-[64px] px-0 py-0"
      >
        {isPlaying ? <PauseIcon size={30} weight="fill" /> : <PlayIcon size={30} weight="fill" />}
      </Button>

      <Button tone="paper" icon onClick={onSkip} disabled={disabled} aria-label="Skip track">
        <SkipForwardIcon size={24} weight="fill" />
      </Button>

      <Button
        tone="paper"
        icon
        onClick={onStop}
        disabled={disabled}
        aria-label="Stop"
        className="hidden sm:inline-flex"
      >
        <StopIcon size={22} weight="fill" />
      </Button>
    </div>
  )
}

/** Volume is per-person and never leaves this browser. */
export function VolumeControl({ onChange }: { onChange: (volume: number) => void }) {
  const volume = useApp((s) => s.volume)
  const muted = useApp((s) => s.muted)
  const setVolume = useApp((s) => s.setVolume)
  const setMuted = useApp((s) => s.setMuted)

  const apply = (next: number, nextMuted: boolean) => {
    setVolume(next)
    setMuted(nextMuted)
    onChange(nextMuted ? 0 : next)
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => apply(volume, !muted)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-ink"
        style={{ background: 'var(--color-paper-raised)', boxShadow: 'var(--shadow-chunk-sm)' }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
      >
        {muted ? (
          <SpeakerSimpleXIcon size={20} weight="fill" />
        ) : (
          <SpeakerHighIcon size={20} weight="fill" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={100}
        value={muted ? 0 : volume}
        onChange={(e) => apply(Number(e.target.value), false)}
        aria-label="Volume"
        className="h-2 w-full min-w-[90px] cursor-pointer appearance-none rounded-[var(--radius-pill)] border-2 border-ink"
        style={{
          background: `linear-gradient(to right, var(--color-lilac) ${muted ? 0 : volume}%, var(--color-paper-sunk) ${muted ? 0 : volume}%)`,
        }}
      />
      <span className="w-8 shrink-0 text-right text-xs font-extrabold text-ink-soft tabular-nums">
        {muted ? 0 : volume}
      </span>
    </div>
  )
}

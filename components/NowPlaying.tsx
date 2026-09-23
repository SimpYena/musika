'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import type { Track } from '@/lib/types'
import { Mascot } from './Mascot'
import { SourceBadge, spring } from './ui'

export function NowPlaying({
  track,
  playerSlot,
}: {
  track: Track | null
  playerSlot: React.ReactNode
}) {
  const isPlaying = useApp((s) => s.room.isPlaying)
  const health = useApp((s) => s.health)

  const mood = !track ? 'lonely' : health === 'holding' ? 'surprised' : isPlaying ? 'playing' : 'paused'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        {/* Artwork. The iframe lives behind it, sized 1x1 and invisible — we only ever need its
            audio, and hiding it keeps YouTube's own chrome out of our design. */}
        <div className="relative shrink-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={track?.id ?? 'empty'}
              initial={{ opacity: 0, x: 40, rotate: 6 }}
              animate={{ opacity: 1, x: 0, rotate: 0 }}
              exit={{ opacity: 0, x: -40, rotate: -6 }}
              transition={spring}
              className={isPlaying && track ? 'bobbing' : ''}
            >
              {track?.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={track.thumbnail}
                  alt=""
                  width={132}
                  height={132}
                  className="h-[108px] w-[108px] rounded-[var(--radius-chunk)] border-[3px] border-ink object-cover sm:h-[132px] sm:w-[132px]"
                  style={{ boxShadow: 'var(--shadow-chunk)' }}
                />
              ) : (
                <div
                  className="flex h-[108px] w-[108px] items-center justify-center rounded-[var(--radius-chunk)] border-[3px] border-ink sm:h-[132px] sm:w-[132px]"
                  style={{
                    background: 'var(--color-lilac-soft)',
                    boxShadow: 'var(--shadow-chunk)',
                  }}
                >
                  <Mascot mood="lonely" size={72} />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="min-w-0 flex-1 pt-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={track?.id ?? 'empty'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={spring}
            >
              <h2 className="font-display text-xl leading-tight font-bold text-ink sm:text-2xl">
                {track?.title ?? 'nothing playing'}
              </h2>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink-soft">
                {track ? track.artist || 'unknown artist' : 'the room is yours to start'}
              </p>
              {track && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SourceBadge sourceType={track.sourceType} matchedFrom={track.matchedFrom} />
                  <span className="text-[11px] font-bold text-ink-soft">
                    added by {track.addedBy}
                  </span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="hidden shrink-0 sm:block">
          <Mascot mood={mood} size={84} />
        </div>
      </div>

      {/* The actual embed. Kept mounted and effectively invisible: destroying it between tracks
          would lose the autoplay gesture and add seconds to every change. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          overflow: 'hidden',
          left: -9999,
          top: 0,
        }}
      >
        {playerSlot}
      </div>
    </div>
  )
}

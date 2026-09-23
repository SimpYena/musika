'use client'

import { motion } from 'motion/react'

export type Mood = 'playing' | 'paused' | 'surprised' | 'lonely'

/**
 * Musi, a cassette with opinions. Built in code rather than shipped as an asset so the eyes and
 * reels can react to playback state.
 */
export function Mascot({ mood, size = 96 }: { mood: Mood; size?: number }) {
  const playing = mood === 'playing'
  const asleep = mood === 'paused'
  const surprised = mood === 'surprised'

  return (
    <motion.svg
      width={size}
      height={size * 0.72}
      viewBox="0 0 120 86"
      fill="none"
      role="img"
      aria-label={
        playing
          ? 'Musi the cassette, bobbing along'
          : asleep
            ? 'Musi the cassette, fast asleep'
            : surprised
              ? 'Musi the cassette, startled'
              : 'Musi the cassette, waiting for friends'
      }
      animate={
        playing
          ? { y: [0, -5, 0], rotate: [-1.5, 1.5, -1.5] }
          : surprised
            ? { rotate: [0, -8, 6, 0], y: [0, -8, 0] }
            : { y: 0, rotate: 0 }
      }
      transition={
        playing
          ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.35, ease: 'easeOut' }
      }
    >
      {/* body */}
      <rect
        x="3"
        y="8"
        width="114"
        height="70"
        rx="16"
        fill="var(--color-sunshine)"
        stroke="var(--color-ink)"
        strokeWidth="4"
      />
      {/* label panel */}
      <rect
        x="16"
        y="20"
        width="88"
        height="34"
        rx="9"
        fill="var(--color-paper-raised)"
        stroke="var(--color-ink)"
        strokeWidth="3.5"
      />

      {/* reels */}
      <motion.g
        animate={playing ? { rotate: 360 } : { rotate: 0 }}
        transition={
          playing ? { duration: 2.4, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }
        }
        style={{ originX: '37px', originY: '37px' }}
      >
        <circle
          cx="37"
          cy="37"
          r="9"
          fill="var(--color-coral)"
          stroke="var(--color-ink)"
          strokeWidth="3.5"
        />
        <rect x="35.5" y="29" width="3" height="16" rx="1.5" fill="var(--color-ink)" />
        <rect x="29" y="35.5" width="16" height="3" rx="1.5" fill="var(--color-ink)" />
      </motion.g>

      <motion.g
        animate={playing ? { rotate: 360 } : { rotate: 0 }}
        transition={
          playing ? { duration: 2.4, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }
        }
        style={{ originX: '83px', originY: '37px' }}
      >
        <circle
          cx="83"
          cy="37"
          r="9"
          fill="var(--color-mint)"
          stroke="var(--color-ink)"
          strokeWidth="3.5"
        />
        <rect x="81.5" y="29" width="3" height="16" rx="1.5" fill="var(--color-ink)" />
        <rect x="75" y="35.5" width="16" height="3" rx="1.5" fill="var(--color-ink)" />
      </motion.g>

      {/* eyes — closed when asleep, wide when startled */}
      {asleep ? (
        <>
          <path
            d="M32 66 q6 6 12 0"
            stroke="var(--color-ink)"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M76 66 q6 6 12 0"
            stroke="var(--color-ink)"
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
          />
          <text x="96" y="20" fontSize="15" fontWeight="700" fill="var(--color-ink)">
            z
          </text>
        </>
      ) : (
        <>
          <circle cx="38" cy="66" r={surprised ? 6 : 4.2} fill="var(--color-ink)" />
          <circle cx="82" cy="66" r={surprised ? 6 : 4.2} fill="var(--color-ink)" />
        </>
      )}

      {/* mouth */}
      {surprised ? (
        <ellipse
          cx="60"
          cy="68"
          rx="5"
          ry="6.5"
          fill="var(--color-ink)"
        />
      ) : (
        <path
          d={asleep ? 'M54 68 q6 3 12 0' : 'M52 66 q8 8 16 0'}
          stroke="var(--color-ink)"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </motion.svg>
  )
}

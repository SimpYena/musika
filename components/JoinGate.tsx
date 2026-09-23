'use client'

import { motion } from 'motion/react'
import { Mascot } from './Mascot'
import { Button, Pop } from './ui'

/**
 * Browsers refuse programmatic audio before a user gesture, and that gesture is also what
 * delegates autoplay permission into the player iframe. So entry is gated behind one big
 * friendly tap rather than silently failing on load.
 */
export function JoinGate({
  code,
  username,
  onJoin,
}: {
  code: string
  username: string
  onJoin: () => void
}) {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center"
      style={{ background: 'var(--color-paper)' }}
    >
      <Pop>
        <Mascot mood="paused" size={150} />
      </Pop>

      <Pop delay={0.05}>
        <p className="text-sm font-extrabold tracking-[0.2em] text-ink-soft uppercase">
          room {code}
        </p>
        <h1 className="font-display mt-1 text-3xl font-bold text-ink">
          hey {username} 👋
        </h1>
      </Pop>

      <Pop delay={0.1}>
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Button tone="lilac" onClick={onJoin} className="px-8 py-5 text-lg">
            Tap to join the vibe 🎧
          </Button>
        </motion.div>
      </Pop>

      <Pop delay={0.15}>
        <p className="max-w-xs text-xs font-semibold text-ink-soft">
          One tap wakes up the speakers — browsers insist on it before any sound can play.
        </p>
      </Pop>
    </main>
  )
}

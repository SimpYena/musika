'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useApp } from '@/lib/store'
import { resolveDisplayNames } from '@/lib/identity'
import { MAX_MEMBERS } from '@/lib/types'
import { spring } from './ui'

export function Avatar({
  color,
  emoji,
  name,
  size = 40,
  dimmed = false,
}: {
  color: string
  emoji: string
  name: string
  size?: number
  dimmed?: boolean
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border-[3px] border-ink"
      style={{
        background: color,
        width: size,
        height: size,
        fontSize: size * 0.45,
        boxShadow: 'var(--shadow-chunk-sm)',
        opacity: dimmed ? 0.5 : 1,
      }}
      title={name}
      aria-label={name}
    >
      <span aria-hidden>{emoji}</span>
    </div>
  )
}

export function Presence({ meId }: { meId: string }) {
  const members = useApp((s) => s.members)
  const names = resolveDisplayNames(members)
  const freeSeats = Math.max(0, MAX_MEMBERS - members.length)

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence initial={false}>
        {members.map((m) => (
          <motion.div
            key={m.clientId}
            layout
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={spring}
            className="relative"
          >
            <Avatar
              color={m.color}
              emoji={m.emoji}
              name={names.get(m.clientId) ?? m.username}
            />
            {m.clientId === meId && (
              <span
                className="absolute -bottom-1 -right-1 rounded-full border-2 border-ink px-1 text-[9px] font-extrabold text-ink"
                style={{ background: 'var(--color-paper-raised)' }}
              >
                you
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      {Array.from({ length: freeSeats }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[3px] border-dashed border-ink-soft text-ink-soft"
          aria-hidden
        >
          <span className="text-lg leading-none">+</span>
        </div>
      ))}
    </div>
  )
}

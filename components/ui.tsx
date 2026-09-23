'use client'

import { motion } from 'motion/react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Tone = 'lilac' | 'mint' | 'coral' | 'sun' | 'paper'

const TONE_CLASS: Record<Tone, string> = {
  lilac: 'btn-lilac',
  mint: 'btn-mint',
  coral: 'btn-coral',
  sun: 'btn-sun',
  paper: 'btn-paper',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone
  icon?: boolean
  children?: ReactNode
}

export function Button({
  tone = 'lilac',
  icon = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={`btn ${TONE_CLASS[tone]} ${icon ? 'btn-icon' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card ${className}`}>{children}</div>
}

/** Spring presets — everything stays under 400ms, per CLAUDE.md §6. */
export const spring = { type: 'spring', visualDuration: 0.28, bounce: 0.35 } as const
export const springSoft = { type: 'spring', visualDuration: 0.32, bounce: 0.2 } as const

export function Pop({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...spring, delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function SourceBadge({
  sourceType,
  matchedFrom,
}: {
  sourceType: 'youtube' | 'soundcloud'
  matchedFrom?: 'spotify'
}) {
  const label = matchedFrom
    ? 'matched from Spotify'
    : sourceType === 'youtube'
      ? 'YouTube'
      : 'SoundCloud'
  const tone = matchedFrom
    ? 'bg-mint-soft'
    : sourceType === 'youtube'
      ? 'bg-coral-soft'
      : 'bg-sunshine-soft'

  return (
    <span
      className={`${tone} inline-flex shrink-0 items-center rounded-[var(--radius-pill)] border-2 border-ink px-2.5 py-1 text-[11px] font-extrabold tracking-wide text-ink uppercase`}
    >
      {label}
    </span>
  )
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

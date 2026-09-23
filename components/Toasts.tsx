'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { useApp } from '@/lib/store'
import { spring } from './ui'

/**
 * Action attribution. This matters more than it looks: without it, things change for no visible
 * reason and the room feels haunted.
 */
export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.id), 2800))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={spring}
            className="pointer-events-auto flex items-center gap-2 rounded-[var(--radius-pill)] border-[3px] border-ink px-4 py-2.5 font-extrabold text-ink"
            style={{
              background: 'var(--color-paper-raised)',
              boxShadow: 'var(--shadow-chunk-sm)',
            }}
          >
            <span aria-hidden>{toast.emoji}</span>
            <span className="text-sm">{toast.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

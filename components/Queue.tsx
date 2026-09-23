'use client'

import { Reorder, useDragControls } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { DotsSixVerticalIcon, TrashIcon } from '@phosphor-icons/react'
import type { Track } from '@/lib/types'
import { EmptyQueue } from './EmptyStates'
import { SourceBadge, formatTime } from './ui'

export function Queue({
  queue,
  currentIndex,
  onSelect,
  onRemove,
  onReorder,
}: {
  queue: Track[]
  currentIndex: number
  onSelect: (index: number) => void
  onRemove: (trackId: string) => void
  onReorder: (queue: Track[]) => void
}) {
  // Reorder fires on every drag frame; broadcasting that would flood the channel. Keep a local
  // copy while dragging and commit once on release.
  const [items, setItems] = useState(queue)
  const dragging = useRef(false)

  useEffect(() => {
    if (!dragging.current) setItems(queue)
  }, [queue])

  if (queue.length === 0) return <EmptyQueue />

  return (
    <Reorder.Group
      axis="y"
      values={items}
      onReorder={setItems}
      as="ul"
      className="flex flex-col gap-2.5"
    >
      {items.map((track) => (
        <QueueRow
          key={track.id}
          track={track}
          isCurrent={queue[currentIndex]?.id === track.id}
          onSelect={() => {
            const index = queue.findIndex((t) => t.id === track.id)
            if (index >= 0) onSelect(index)
          }}
          onRemove={() => onRemove(track.id)}
          onDragStart={() => {
            dragging.current = true
          }}
          onDragEnd={() => {
            dragging.current = false
            onReorder(items)
          }}
        />
      ))}
    </Reorder.Group>
  )
}

function QueueRow({
  track,
  isCurrent,
  onSelect,
  onRemove,
  onDragStart,
  onDragEnd,
}: {
  track: Track
  isCurrent: boolean
  onSelect: () => void
  onRemove: () => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.25 }}
      className="list-none"
    >
      <div
        className="flex items-center gap-3 rounded-[var(--radius-chunk)] border-[3px] border-ink p-2.5"
        style={{
          background: isCurrent ? 'var(--color-sunshine-soft)' : 'var(--color-paper-raised)',
          boxShadow: isCurrent ? 'var(--shadow-chunk)' : 'var(--shadow-chunk-sm)',
        }}
      >
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            controls.start(e)
          }}
          className="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-ink-soft active:cursor-grabbing"
          aria-label={`Reorder ${track.title}`}
        >
          <DotsSixVerticalIcon size={20} weight="bold" />
        </button>

        <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          {track.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.thumbnail}
              alt=""
              width={52}
              height={52}
              loading="lazy"
              className="h-[52px] w-[52px] shrink-0 rounded-[14px] border-[3px] border-ink object-cover"
            />
          ) : (
            <div className="h-[52px] w-[52px] shrink-0 rounded-[14px] border-[3px] border-ink bg-lilac-soft" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-ink">{track.title}</p>
            <p className="truncate text-xs font-semibold text-ink-soft">
              {track.artist || 'unknown artist'}
              {track.durationMs ? ` · ${formatTime(track.durationMs)}` : ''}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              <SourceBadge sourceType={track.sourceType} matchedFrom={track.matchedFrom} />
              <span className="truncate text-[10px] font-bold text-ink-soft">
                added by {track.addedBy}
              </span>
            </div>
          </div>
        </button>

        <button
          onClick={onRemove}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-ink"
          style={{ background: 'var(--color-coral-soft)' }}
          aria-label={`Remove ${track.title} from the queue`}
        >
          <TrashIcon size={17} weight="fill" />
        </button>
      </div>
    </Reorder.Item>
  )
}

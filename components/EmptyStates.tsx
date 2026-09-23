'use client'

import Link from 'next/link'
import { Mascot } from './Mascot'
import { Button } from './ui'

export function EmptyQueue() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Mascot mood="paused" size={104} />
      <p className="font-display text-xl font-bold text-ink">Musi is having a nap</p>
      <p className="max-w-[22rem] text-sm font-semibold text-ink-soft">
        Paste a YouTube or SoundCloud link up there and the room wakes up. Playlists work too.
      </p>
    </div>
  )
}

export function LonelyListener() {
  return (
    <div
      className="flex items-center gap-3 rounded-[var(--radius-chunk)] border-[3px] border-dashed border-ink-soft px-4 py-3"
      style={{ background: 'var(--color-paper-sunk)' }}
    >
      <Mascot mood="lonely" size={54} />
      <div>
        <p className="text-sm font-extrabold text-ink">Just you so far</p>
        <p className="text-xs font-semibold text-ink-soft">
          Send the room code to a friend — two more can squeeze in.
        </p>
      </div>
    </div>
  )
}

export function RoomFull() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center"
      style={{ background: 'var(--color-paper)' }}
    >
      <Mascot mood="surprised" size={140} />
      <h1 className="font-display text-3xl font-bold text-ink">room&apos;s full 😢</h1>
      <p className="max-w-sm font-semibold text-ink-soft">
        Three is the magic number in here. Ask one of them to tap out, or start a room of your own.
      </p>
      <Link href="/">
        <Button tone="lilac">Start my own room</Button>
      </Link>
    </main>
  )
}

export function NotConfigured() {
  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center"
      style={{ background: 'var(--color-paper)' }}
    >
      <Mascot mood="surprised" size={130} />
      <h1 className="font-display text-2xl font-bold text-ink">Musika isn&apos;t plugged in yet</h1>
      <p className="max-w-md text-sm font-semibold text-ink-soft">
        The realtime keys are missing, so rooms can&apos;t sync. Add{' '}
        <code className="rounded border-2 border-ink px-1 font-bold">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
        and{' '}
        <code className="rounded border-2 border-ink px-1 font-bold">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{' '}
        to <code className="rounded border-2 border-ink px-1 font-bold">.env.local</code>, then
        restart. The README walks through it.
      </p>
    </main>
  )
}

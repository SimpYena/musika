'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckIcon, LinkSimpleIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { AddToQueue } from '@/components/AddToQueue'
import { Controls, VolumeControl } from '@/components/Controls'
import { JoinGate } from '@/components/JoinGate'
import { LonelyListener, NotConfigured, RoomFull } from '@/components/EmptyStates'
import { NowPlaying } from '@/components/NowPlaying'
import { Presence } from '@/components/Presence'
import { ProgressBar } from '@/components/ProgressBar'
import { Queue } from '@/components/Queue'
import { SyncIndicator } from '@/components/SyncIndicator'
import { Toasts } from '@/components/Toasts'
import { Card } from '@/components/ui'
import { startClock, syncClock } from '@/lib/clock'
import {
  getClientId,
  isValidRoomCode,
  loadUsername,
  randomColor,
  randomEmoji,
} from '@/lib/identity'
import { pokeKeepAlive, supabaseConfigured } from '@/lib/realtime'
import { hydrateLocalPrefs, useApp, usePlayhead } from '@/lib/store'
import { SyncEngine } from '@/lib/sync'
import type { Member, Track } from '@/lib/types'

export function RoomClient({ code }: { code: string }) {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [joined, setJoined] = useState(false)
  const [username, setUsername] = useState('')
  const [dark, setDark] = useState(false)
  const [copied, setCopied] = useState(false)

  const playerHostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<SyncEngine | null>(null)

  const room = useApp((s) => s.room)
  const members = useApp((s) => s.members)
  const roomFull = useApp((s) => s.roomFull)

  useEffect(() => {
    setMounted(true)
    hydrateLocalPrefs()
    const stored = loadUsername()
    if (!stored) {
      router.replace('/')
      return
    }
    setUsername(stored)
    const prefersDark =
      window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    setDark(prefersDark)
  }, [router])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, [dark])

  /* ---- bring the room up once the user has tapped through the gate ---- */
  useEffect(() => {
    if (!joined || !username || !playerHostRef.current) return

    const stopClock = startClock()
    void pokeKeepAlive()

    const me: Member = {
      clientId: getClientId(),
      username,
      color: randomColor(),
      emoji: randomEmoji(),
      joinedAt: Date.now(),
    }

    const app = useApp.getState()

    const engine = new SyncEngine(code, me, playerHostRef.current, {
      onRoom: (state) => useApp.getState().setRoom(state),
      onMembers: (list) => useApp.getState().setMembers(list),
      onStatus: (status) => useApp.getState().setStatus(status),
      onHealth: (health, drift) => useApp.getState().setHealth(health, drift),
      onToast: (text, emoji) => useApp.getState().pushToast(text, emoji),
      onRoomFull: () => useApp.getState().setRoomFull(true),
      onPlayerError: (message) => useApp.getState().pushToast(message, '⚠️'),
      getVolume: () => {
        const s = useApp.getState()
        return s.muted ? 0 : s.volume
      },
    })

    engineRef.current = engine
    engine.setVolume(app.muted ? 0 : app.volume)

    // The clock handshake needs to land before the first timestamp is written.
    void syncClock().then(() => engine.start())

    /* Drive the progress bar from outside React at 4 Hz. Nothing else subscribes to this store,
       so the player and Now Playing cards never re-render on a tick. */
    const playhead = setInterval(() => {
      usePlayhead.getState().set(engine.getPositionMs(), engine.getDurationMs())
    }, 250)

    return () => {
      clearInterval(playhead)
      stopClock()
      engine.destroy()
      engineRef.current = null
      useApp.getState().reset()
    }
  }, [joined, username, code])

  const handleAdd = useCallback((tracks: Track[]) => {
    engineRef.current?.addTracks(tracks)
    useApp.getState().pushToast(
      tracks.length === 1 ? 'added to the queue' : `added ${tracks.length} tracks`,
      '➕',
    )
  }, [])

  const handleVolume = useCallback((volume: number) => {
    engineRef.current?.setVolume(volume)
  }, [])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      useApp.getState().pushToast('could not copy — select the URL instead', '😅')
    }
  }

  if (!mounted) return null
  if (!supabaseConfigured()) return <NotConfigured />
  if (!isValidRoomCode(code)) {
    return (
      <main
        className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: 'var(--color-paper)' }}
      >
        <h1 className="font-display text-2xl font-bold text-ink">that room code looks wrong</h1>
        <p className="text-sm font-semibold text-ink-soft">
          Codes are 4 characters, no O, I, L, 0 or 1.
        </p>
        <Link href="/" className="btn btn-lilac">
          Back to the start
        </Link>
      </main>
    )
  }
  if (!username) return null
  if (roomFull) return <RoomFull />
  if (!joined) {
    return <JoinGate code={code} username={username} onJoin={() => setJoined(true)} />
  }

  const currentTrack =
    room.trackIndex >= 0 && room.trackIndex < room.queue.length
      ? room.queue[room.trackIndex]
      : null
  const hasTrack = currentTrack !== null

  return (
    <main className="min-h-dvh pb-28" style={{ background: 'var(--color-paper)' }}>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-5">
        {/* header */}
        <header className="flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl font-bold text-ink">
            musika
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={copyLink}
              className="flex items-center gap-1.5 rounded-[var(--radius-pill)] border-[3px] border-ink px-3 py-1.5 font-display text-sm font-bold tracking-[0.15em] text-ink"
              style={{
                background: 'var(--color-sunshine)',
                boxShadow: 'var(--shadow-chunk-sm)',
              }}
              aria-label={`Room code ${code}. Copy invite link`}
            >
              {copied ? <CheckIcon size={15} weight="bold" /> : <LinkSimpleIcon size={15} weight="bold" />}
              {code}
            </button>
            <button
              onClick={() => setDark((d) => !d)}
              className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-ink text-ink"
              style={{ background: 'var(--color-paper-raised)' }}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <SunIcon size={18} weight="fill" /> : <MoonIcon size={18} weight="fill" />}
            </button>
          </div>
        </header>

        {/* who's here */}
        <div className="flex items-center justify-between gap-3">
          <Presence meId={getClientId()} />
          <SyncIndicator />
        </div>

        {members.length === 1 && <LonelyListener />}

        {/* now playing */}
        <Card className="flex flex-col gap-4 p-4">
          <NowPlaying track={currentTrack} playerSlot={<div ref={playerHostRef} />} />
          <ProgressBar
            disabled={!hasTrack}
            onSeek={(ms) => engineRef.current?.seekTo(ms)}
          />
          <Controls
            disabled={room.queue.length === 0}
            onPlayPause={() => engineRef.current?.togglePlay()}
            onSkip={() => engineRef.current?.skip()}
            onPrevious={() => engineRef.current?.previous()}
            onStop={() => engineRef.current?.stop()}
          />
          <VolumeControl onChange={handleVolume} />
        </Card>

        {/* queue */}
        <AddToQueue onAdd={handleAdd} username={username} />

        <section aria-label="Queue" className="flex flex-col gap-2 pb-4">
          {room.queue.length > 0 && (
            <h2 className="px-1 text-xs font-extrabold tracking-wide text-ink-soft uppercase">
              up next · {room.queue.length}
            </h2>
          )}
          <Queue
            queue={room.queue}
            currentIndex={room.trackIndex}
            onSelect={(index) => engineRef.current?.selectIndex(index)}
            onRemove={(id) => engineRef.current?.removeTrack(id)}
            onReorder={(next) => engineRef.current?.reorderQueue(next)}
          />
        </section>
      </div>

      <Toasts />
    </main>
  )
}

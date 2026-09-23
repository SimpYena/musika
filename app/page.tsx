'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowRightIcon, SparkleIcon } from '@phosphor-icons/react'
import { Mascot } from '@/components/Mascot'
import { Button, Card, Pop } from '@/components/ui'
import {
  generateRoomCode,
  isValidRoomCode,
  loadUsername,
  normalizeRoomCode,
  randomColor,
  randomEmoji,
  saveUsername,
  validateUsername,
} from '@/lib/identity'
import { supabaseConfigured } from '@/lib/realtime'
import { NotConfigured } from '@/components/EmptyStates'

export default function LandingPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [emoji, setEmoji] = useState('🎧')
  const [color, setColor] = useState('#C9BCFF')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setName(loadUsername())
    setEmoji(randomEmoji())
    setColor(randomColor())
  }, [])

  if (mounted && !supabaseConfigured()) return <NotConfigured />

  const go = (target: string) => {
    const check = validateUsername(name)
    if (!check.ok) {
      setError(check.error ?? 'that name will not do')
      return
    }
    saveUsername(name.trim())
    router.push(target)
  }

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-5 py-10"
      style={{ background: 'var(--color-paper)' }}
    >
      <div className="flex w-full max-w-md flex-col gap-6">
        <Pop className="flex flex-col items-center gap-3 text-center">
          <Mascot mood="playing" size={132} />
          <h1 className="font-display text-4xl font-bold tracking-tight text-ink">musika</h1>
          <p className="max-w-xs text-sm font-semibold text-ink-soft">
            A tiny room for you and two friends. Same song, same second.
          </p>
        </Pop>

        <Pop delay={0.06}>
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-xl"
                style={{ background: color, boxShadow: 'var(--shadow-chunk-sm)' }}
                aria-hidden
              >
                {emoji}
              </div>
              <div className="flex-1">
                <label htmlFor="name" className="sr-only">
                  Your name
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  placeholder="what should we call you?"
                  className="input-chunk"
                  maxLength={16}
                  autoComplete="off"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs font-extrabold text-coral">
                {error}
              </p>
            )}

            <Button tone="lilac" onClick={() => go(`/room/${generateRoomCode()}`)}>
              <SparkleIcon size={20} weight="fill" />
              Start a room
            </Button>

            <div className="flex items-center gap-3">
              <span className="h-[3px] flex-1 rounded-full bg-ink/15" />
              <span className="text-xs font-extrabold text-ink-soft uppercase">or join one</span>
              <span className="h-[3px] flex-1 rounded-full bg-ink/15" />
            </div>

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!isValidRoomCode(code)) {
                  setError('room codes are 4 characters, like FT7K')
                  return
                }
                go(`/room/${code}`)
              }}
            >
              <label htmlFor="code" className="sr-only">
                Room code
              </label>
              <input
                id="code"
                value={code}
                onChange={(e) => {
                  setCode(normalizeRoomCode(e.target.value))
                  setError(null)
                }}
                placeholder="CODE"
                className="input-chunk flex-1 text-center font-display text-xl tracking-[0.3em] uppercase"
                maxLength={4}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                tone="mint"
                type="submit"
                icon
                disabled={code.length !== 4}
                aria-label="Join room"
              >
                <ArrowRightIcon size={24} weight="bold" />
              </Button>
            </form>
          </Card>
        </Pop>

        <Pop delay={0.12}>
          <p className="text-center text-[11px] font-semibold text-ink-soft">
            Up to 3 listeners. Rooms disappear when everyone leaves — that&apos;s on purpose.
          </p>
        </Pop>
      </div>
    </main>
  )
}

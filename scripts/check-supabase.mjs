/**
 * Connection doctor.
 *
 *   npm run check
 *
 * Does exactly what the app does — creates a client, joins a room channel, tracks presence — and
 * reports which step failed. Far faster than guessing from a "reconnecting…" badge.
 */

import { createClient } from '@supabase/supabase-js'
import { normalizeSupabaseUrl } from '../lib/env.ts'

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function die(message, hint) {
  console.error(`\n  ✗ ${message}`)
  if (hint) console.error(`    ${hint}`)
  process.exit(1)
}

if (!rawUrl || !key) {
  die(
    'NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set',
    'Copy .env.example to .env.local and fill both in.',
  )
}

const url = normalizeSupabaseUrl(rawUrl)

console.log('\n  Musika connection check')
console.log('  ───────────────────────')
console.log(`  project   ${url}`)
console.log(`  key       ${key.slice(0, 16)}… (${key.length} chars)`)

if (url !== rawUrl.trim().replace(/\/+$/, '')) {
  console.log(`\n  ! your URL had a path on it and was trimmed to the project origin`)
  console.log(`    set NEXT_PUBLIC_SUPABASE_URL=${url}`)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } },
})

const channel = supabase.channel('room:CHECK', {
  config: { broadcast: { self: true }, presence: { key: 'doctor' } },
})

let settled = false
const finish = (ok, message, hint) => {
  if (settled) return
  settled = true
  if (ok) {
    console.log(`\n  ✓ ${message}\n`)
    process.exit(0)
  }
  die(message, hint)
}

setTimeout(
  () =>
    finish(
      false,
      'timed out waiting for the realtime channel',
      'Is the project paused? Free projects pause after ~1 week idle — check the Supabase dashboard.',
    ),
  15000,
)

channel
  .on('presence', { event: 'sync' }, () => {})
  .on('broadcast', { event: 'ping' }, () => {
    finish(true, 'connected, subscribed, presence tracked, and a broadcast round-tripped')
  })
  .subscribe(async (status, err) => {
    console.log(`  status    ${status}`)
    if (status === 'SUBSCRIBED') {
      await channel.track({ clientId: 'doctor' })
      await channel.send({ type: 'broadcast', event: 'ping', payload: { t: Date.now() } })
      return
    }
    if (status === 'CHANNEL_ERROR') {
      finish(
        false,
        `channel error${err ? `: ${err.message}` : ''}`,
        'Usually a bad key, or "Allow public access to channels" turned off in Project Settings → Realtime.',
      )
    }
    if (status === 'TIMED_OUT') {
      finish(false, 'channel timed out', 'Check the project URL and that the project is not paused.')
    }
  })

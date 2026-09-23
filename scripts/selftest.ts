/**
 * Self-test for the pure logic — the parts that decide whether the room converges.
 *
 *   node --experimental-strip-types scripts/selftest.ts
 *
 * Deliberately dependency-free: no test runner, no DOM. Everything here is a pure function.
 */

import { acceptsEvent, electAnchor, seatOrder, type Member } from '../lib/types.ts'
import {
  isValidRoomCode,
  normalizeRoomCode,
  resolveDisplayNames,
  validateUsername,
} from '../lib/identity.ts'
import { parseSourceUrl } from '../lib/parse.ts'
import { normalizeSupabaseUrl } from '../lib/env.ts'

let passed = 0
let failed = 0

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${name}\n        expected ${b}\n        actual   ${a}`)
  }
}

function group(name: string) {
  console.log(`\n${name}`)
}

/* ------------------------------------------------------------------ */
group('conflict resolution — the ping-pong guard')

check('newer seq wins', acceptsEvent({ seq: 5, actorId: 'a' }, { seq: 4, actorId: 'z' }), true)
check('older seq loses', acceptsEvent({ seq: 3, actorId: 'z' }, { seq: 4, actorId: 'a' }), false)
check('same seq, higher actor wins', acceptsEvent({ seq: 4, actorId: 'z' }, { seq: 4, actorId: 'a' }), true)
check('same seq, lower actor loses', acceptsEvent({ seq: 4, actorId: 'a' }, { seq: 4, actorId: 'z' }), false)
check('identical event is not reapplied', acceptsEvent({ seq: 4, actorId: 'm' }, { seq: 4, actorId: 'm' }), false)

// Acceptance test 6: two clients act at the same instant with the same seq. Both must end up on
// the SAME state, whichever order the messages happen to arrive in.
{
  const eventA = { seq: 7, actorId: 'aaa' }
  const eventB = { seq: 7, actorId: 'bbb' }

  // Client A applied its own event first, then hears B's.
  let appliedOnA = eventA
  if (acceptsEvent(eventB, appliedOnA)) appliedOnA = eventB

  // Client B applied its own first, then hears A's.
  let appliedOnB = eventB
  if (acceptsEvent(eventA, appliedOnB)) appliedOnB = eventA

  check('simultaneous actions converge', appliedOnA.actorId, appliedOnB.actorId)
  check('…and the higher actorId is the winner', appliedOnA.actorId, 'bbb')
}

// A replayed burst must not oscillate: applying the same messages repeatedly is a no-op.
{
  let applied = { seq: 2, actorId: 'm' }
  const burst = [
    { seq: 1, actorId: 'x' },
    { seq: 2, actorId: 'a' },
    { seq: 2, actorId: 'm' },
  ]
  for (let round = 0; round < 3; round++) {
    for (const msg of burst) if (acceptsEvent(msg, applied)) applied = msg
  }
  check('replayed old messages change nothing', applied, { seq: 2, actorId: 'm' })
}

/* ------------------------------------------------------------------ */
group('seats and anchor election')

function member(clientId: string, joinedAt: number): Member {
  return { clientId, joinedAt, username: clientId, color: '#fff', emoji: '🎧' }
}

{
  // Two clients whose clocks report the exact same millisecond — joinedAt alone is not a total
  // order, so without the clientId tiebreak the seat assignment could differ between clients.
  const tied = [member('ccc', 100), member('aaa', 100), member('bbb', 100)]
  check('tied join times order by clientId', seatOrder(tied).map((m) => m.clientId), ['aaa', 'bbb', 'ccc'])
  check('earlier join still wins', seatOrder([member('zzz', 50), member('aaa', 99)]).map((m) => m.clientId), ['zzz', 'aaa'])

  // Every client sorts identically, so the 4th person always evicts themselves.
  const four = [member('d', 4), member('a', 1), member('c', 3), member('b', 2)]
  const order = seatOrder(four).map((m) => m.clientId)
  check('4th seat is deterministic', order[3], 'd')
  check('first three seats are stable', order.slice(0, 3), ['a', 'b', 'c'])
}

{
  const members = [member('mmm', 10), member('aaa', 99), member('zzz', 1)]
  check('anchor is lowest clientId, not earliest join', electAnchor(members, 'fallback'), 'aaa')
  check('anchor falls back when alone', electAnchor([], 'me'), 'me')
  // Anchor must re-derive with no negotiation when it leaves.
  check('anchor re-derives on leave', electAnchor(members.filter((m) => m.clientId !== 'aaa'), 'x'), 'mmm')
}

/* ------------------------------------------------------------------ */
group('usernames and room codes')

check('rejects too short', validateUsername('a').ok, false)
check('rejects too long', validateUsername('a'.repeat(17)).ok, false)
check('rejects punctuation', validateUsername('mi na!').ok, false)
check('accepts underscores and digits', validateUsername('mina_99').ok, true)
check('mild profanity filter', validateUsername('shithead').ok, false)
check('does not flag innocent words', validateUsername('scunthorpe').ok, true)

check('normalises case', normalizeRoomCode('ft7k'), 'FT7K')
// 0, O, 1, I and L are never generated, so there is nothing to fold them onto — they are dropped
// and the resulting short code fails validation with a friendly message.
check('drops ambiguous glyphs', normalizeRoomCode('F0O1L'), 'F')
check('keeps a clean code intact', normalizeRoomCode('f-t/7 k'), 'FT7K')
check('trims to four', normalizeRoomCode('ABCDEFGH'), 'ABCD')
check('valid code', isValidRoomCode('FT7K'), true)
check('rejects ambiguous chars', isValidRoomCode('FT0K'), false)
check('rejects wrong length', isValidRoomCode('FTK'), false)

{
  const dupes = [member('b', 1), member('a', 2), member('c', 3)]
  dupes[0].username = 'mina'
  dupes[1].username = 'mina'
  dupes[2].username = 'jake'
  const names = resolveDisplayNames(dupes)
  check('collision gets a number', [names.get('a'), names.get('b'), names.get('c')], ['mina', 'mina2', 'jake'])
}

/* ------------------------------------------------------------------ */
group('URL parsing')

const kindOf = (u: string) => parseSourceUrl(u).kind

check('watch url', parseSourceUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), {
  kind: 'yt-video',
  videoId: 'dQw4w9WgXcQ',
  startSec: 0,
})
check('youtu.be short', kindOf('https://youtu.be/dQw4w9WgXcQ'), 'yt-video')
check('shorts', kindOf('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'yt-video')
check('live', kindOf('https://www.youtube.com/live/dQw4w9WgXcQ'), 'yt-video')
check('music.youtube', kindOf('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), 'yt-video')
check('m.youtube', kindOf('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), 'yt-video')
check('no scheme', kindOf('youtube.com/watch?v=dQw4w9WgXcQ'), 'yt-video')
check('timestamp seconds', parseSourceUrl('https://youtu.be/dQw4w9WgXcQ?t=90').kind, 'yt-video')
check('timestamp parsed', (parseSourceUrl('https://youtu.be/dQw4w9WgXcQ?t=90') as { startSec: number }).startSec, 90)
check('timestamp 1h2m3s', (parseSourceUrl('https://youtu.be/dQw4w9WgXcQ?t=1h2m3s') as { startSec: number }).startSec, 3723)
check('playlist', kindOf('https://www.youtube.com/playlist?list=PLabcdefghij'), 'yt-playlist')
check('video in playlist', kindOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij'), 'yt-video-in-playlist')

check('soundcloud track', kindOf('https://soundcloud.com/artist/some-track'), 'sc-track')
check('soundcloud set', kindOf('https://soundcloud.com/artist/sets/some-set'), 'sc-set')
check('soundcloud short is flagged', kindOf('https://on.soundcloud.com/1nJdL'), 'sc-short')

check('spotify track', parseSourceUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), {
  kind: 'sp',
  spKind: 'track',
  id: '4cOdK2wGLETKBW3PvgPWqT',
  url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
})
check(
  'spotify localised /intl-de/ link',
  parseSourceUrl('https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT').kind,
  'sp',
)
check('spotify uri', parseSourceUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT').kind, 'sp')
check('spotify legacy playlist uri', parseSourceUrl('spotify:user:me:playlist:4cOdK2wGLETKBW3PvgPWqT').kind, 'sp')
check('spotify album', (parseSourceUrl('https://open.spotify.com/album/4cOdK2wGLETKBW3PvgPWqT') as { spKind: string }).spKind, 'album')
check('spotify short is flagged', kindOf('https://spotify.link/abc123'), 'sp-short')

check('garbage', kindOf('hello world'), 'unknown')
check('unrelated site', kindOf('https://example.com/song.mp3'), 'unknown')
check('empty', kindOf(''), 'unknown')

/* ------------------------------------------------------------------ */
group('supabase url normalisation')

const PROJECT = 'https://abcdefghijklmnop.supabase.co'
check('plain project url is untouched', normalizeSupabaseUrl(PROJECT), PROJECT)
// The mistake this exists to absorb: copying the REST endpoint from the dashboard.
check('strips the REST path', normalizeSupabaseUrl(`${PROJECT}/rest/v1/`), PROJECT)
check('strips a trailing slash', normalizeSupabaseUrl(`${PROJECT}/`), PROJECT)
check('strips a realtime path', normalizeSupabaseUrl(`${PROJECT}/realtime/v1`), PROJECT)
check('trims whitespace', normalizeSupabaseUrl(`  ${PROJECT}  `), PROJECT)
check('leaves nonsense alone rather than throwing', normalizeSupabaseUrl('not-a-url'), 'not-a-url')

/* ------------------------------------------------------------------ */
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)

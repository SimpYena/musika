import type { Member } from './types'

const USERNAME_KEY = 'musika:username'
const VOLUME_KEY = 'musika:volume'
const MUTED_KEY = 'musika:muted'
const CLIENT_KEY = 'musika:clientId'

/** Pastel avatar palette. Each is paired with deep ink text, so all of these pass AA. */
export const AVATAR_COLORS = [
  '#FFB5C2', // blush
  '#B5E8D5', // mint
  '#C9BCFF', // lilac
  '#FFE08A', // sunshine
  '#A8D8FF', // sky
  '#FFC9A3', // peach
  '#D4F59B', // lime
  '#FFB8E6', // bubblegum
] as const

export const AVATAR_EMOJIS = [
  '🎧', '🌸', '🍉', '🦊', '🐸', '🌙', '⭐', '🍄',
  '🐙', '🪐', '🍒', '🦜', '🧃', '🐝', '🌵', '🍡',
] as const

/**
 * Deliberately mild, per CLAUDE.md §5 — this is a private room for three friends, not a
 * moderation system. It catches the handful of words you would not want as a display name and
 * stops there.
 */
const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'slut', 'whore', 'nigger', 'nigga',
  'faggot', 'retard', 'rape', 'nazi', 'hitler',
]

/**
 * Substring matching has the Scunthorpe problem: perfectly ordinary words contain blocked ones.
 * Since this is a private room for three friends, a false positive is far more annoying than a
 * false negative — so known-innocent words are checked first and let through.
 */
const ALLOWED = [
  'scunthorpe', 'penistone', 'lightwater', 'clitheroe', 'assassin', 'assess',
  'grape', 'grapes', 'therapist', 'shiitake', 'cockburn', 'analysis', 'classic',
]

export interface UsernameCheck {
  ok: boolean
  error?: string
}

export function validateUsername(raw: string): UsernameCheck {
  const name = raw.trim()
  if (name.length < 2) return { ok: false, error: 'a little longer than that (2+ characters)' }
  if (name.length > 16) return { ok: false, error: "that's a lot of name (16 max)" }
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    return { ok: false, error: 'letters, numbers and _ only' }
  }
  const flat = name.toLowerCase().replace(/[^a-z]/g, '')
  const innocent = ALLOWED.some((word) => flat.includes(word))
  if (!innocent && BLOCKED.some((word) => flat.includes(word))) {
    return { ok: false, error: "let's pick something else 😅" }
  }
  return { ok: true }
}

function randomOf<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

export function randomColor(): string {
  return randomOf(AVATAR_COLORS)
}

export function randomEmoji(): string {
  return randomOf(AVATAR_EMOJIS)
}

/** 4-character room code with the ambiguous glyphs removed: no 0/O, no 1/I/L. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

export function generateRoomCode(): string {
  let code = ''
  const buf = new Uint32Array(4)
  crypto.getRandomValues(buf)
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]
  }
  return code
}

/**
 * Codes are generated from an alphabet with no 0/O and no 1/I/L, so there is no "did they mean
 * O or 0" case to fold — anything outside the alphabet simply never appears in a real code.
 * Drop stray characters and let validation give a friendly error.
 */
export function normalizeRoomCode(raw: string): string {
  return [...raw.trim().toUpperCase()]
    .filter((c) => CODE_ALPHABET.includes(c))
    .join('')
    .slice(0, 4)
}

export function isValidRoomCode(code: string): boolean {
  return code.length === 4 && [...code].every((c) => CODE_ALPHABET.includes(c))
}

/**
 * Per-TAB identity.
 *
 * This deliberately uses sessionStorage rather than localStorage: two tabs of the same browser
 * must count as two distinct members, otherwise the presence cap sees one person and the
 * two-window acceptance tests are impossible to run.
 */
export function getClientId(): string {
  if (typeof window === 'undefined') return ''
  let id = sessionStorage.getItem(CLIENT_KEY)
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_KEY, id)
  }
  return id
}

/** Per-BROWSER identity — shared across tabs on purpose, so you only type your name once. */
export function loadUsername(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(USERNAME_KEY) ?? ''
}

export function saveUsername(name: string): void {
  localStorage.setItem(USERNAME_KEY, name)
}

export function loadVolume(): number {
  if (typeof window === 'undefined') return 80
  const raw = localStorage.getItem(VOLUME_KEY)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 80
}

export function saveVolume(volume: number): void {
  localStorage.setItem(VOLUME_KEY, String(volume))
}

export function loadMuted(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(MUTED_KEY) === '1'
}

export function saveMuted(muted: boolean): void {
  localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
}

/**
 * Resolve display-name collisions inside a room by appending a number, so the second `mina`
 * shows up as `mina2`. Order is stabilised by clientId so every client derives the same labels.
 */
export function resolveDisplayNames(members: Member[]): Map<string, string> {
  const out = new Map<string, string>()
  const seen = new Map<string, number>()
  const ordered = [...members].sort((a, b) => a.clientId.localeCompare(b.clientId))

  for (const m of ordered) {
    const key = m.username.toLowerCase()
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    out.set(m.clientId, count === 1 ? m.username : `${m.username}${count}`)
  }
  return out
}

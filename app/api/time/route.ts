import { NextResponse } from 'next/server'

/**
 * The room's reference clock.
 *
 * Supabase Realtime broadcast frames carry no server timestamp (see docs/PHASE0.md §4), so the
 * NTP-style handshake in lib/clock.ts needs an authoritative origin. This is a plain JSON GET —
 * not a long-lived connection — so it sits comfortably inside the Vercel serverless constraint.
 * It is hit ~5 times per user per minute.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { t: Date.now() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}

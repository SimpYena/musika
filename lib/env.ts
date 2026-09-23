/**
 * Environment/config normalisation. Pure and dependency-free so it stays directly testable.
 */

/**
 * Reduce whatever was pasted into NEXT_PUBLIC_SUPABASE_URL to the bare project origin.
 *
 * The Supabase dashboard shows several URLs and it is easy to copy the REST endpoint
 * (`https://<ref>.supabase.co/rest/v1/`) instead of the Project URL. supabase-js builds the
 * Realtime socket address by appending to this string, so a stray path silently produces
 * `wss://<ref>.supabase.co/rest/v1/realtime/v1` — which can never connect, and surfaces only as
 * a permanent "reconnecting…" with no other clue. Strip the path rather than let that happen.
 */
export function normalizeSupabaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed
  }
}

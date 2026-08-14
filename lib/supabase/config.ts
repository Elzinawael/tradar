/**
 * Supabase environment configuration.
 *
 * TRADAR is designed to run in two modes:
 *
 *   1. Configured   — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                     are present; authentication and persistence are live.
 *   2. Unconfigured — the variables are absent; the app still builds, boots and
 *                     renders its empty states instead of crashing.
 *
 * Mode 2 keeps the project runnable for anyone who clones the repository
 * without credentials, and keeps `next build` green in CI. Every data accessor
 * checks `isSupabaseConfigured()` before touching the network.
 *
 * Only the anon (publishable) key is ever referenced here. The service-role key
 * must never be imported into application code — it bypasses RLS.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""

/** True when both public Supabase variables are present. */
export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
}

/**
 * Human-readable reason the app is running without a backend. Rendered in the
 * UI so a missing `.env.local` is obvious rather than silently confusing.
 */
export const SUPABASE_SETUP_HINT =
  "Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key."

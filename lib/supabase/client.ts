"use client"

import { createBrowserClient } from "@supabase/ssr"
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "./config"

/**
 * Browser Supabase client (client components only).
 *
 * Returns null when Supabase is not configured so callers can degrade
 * gracefully instead of throwing at module load.
 */
export function createClient() {
  if (!isSupabaseConfigured()) return null
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "./config"

/**
 * Server Supabase client for Server Components, Server Actions and Route
 * Handlers. Reads and refreshes the auth session from cookies.
 *
 * Returns null when Supabase is not configured.
 *
 * Note: in a Server Component the cookie store is read-only, so `setAll` may
 * throw. That is expected and safe to ignore — middleware is responsible for
 * refreshing the session cookie on every request.
 */
export async function createClient() {
  if (!isSupabaseConfigured()) return null

  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component — middleware handles the refresh.
        }
      },
    },
  })
}

/** The currently authenticated user, or null. */
export async function getCurrentUser() {
  const supabase = await createClient()
  if (!supabase) return null

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}

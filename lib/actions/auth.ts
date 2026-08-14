"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { isSupabaseConfigured } from "@/lib/supabase/config"
import type { AuthActionState } from "./state"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8

function validate(
  email: string,
  password: string,
): string | null {
  if (!email || !EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address."
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

/** Safe internal redirect target — prevents open-redirect via ?redirectTo=. */
function safeRedirect(value: FormDataEntryValue | null): string {
  const raw = typeof value === "string" ? value : ""
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw
  return "/dashboard"
}

export async function signIn(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return {
      error:
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      message: null,
    }
  }

  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")

  const invalid = validate(email, password)
  if (invalid) return { error: invalid, message: null }

  const supabase = await createClient()
  if (!supabase) return { error: "Authentication is unavailable.", message: null }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Deliberately generic: do not reveal whether the address is registered.
    return { error: "Invalid email or password.", message: null }
  }

  revalidatePath("/", "layout")
  redirect(safeRedirect(formData.get("redirectTo")))
}

export async function signUp(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (!isSupabaseConfigured()) {
    return {
      error:
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
      message: null,
    }
  }

  const email = String(formData.get("email") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const fullName = String(formData.get("name") ?? "").trim()

  const invalid = validate(email, password)
  if (invalid) return { error: invalid, message: null }

  const supabase = await createClient()
  if (!supabase) return { error: "Authentication is unavailable.", message: null }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName || null } },
  })

  if (error) {
    return { error: error.message, message: null }
  }

  // When email confirmation is enabled Supabase returns a user without a
  // session; the account exists but must be verified first.
  if (data.user && !data.session) {
    return {
      error: null,
      message: "Check your inbox to confirm your email address, then log in.",
    }
  }

  revalidatePath("/", "layout")
  redirect("/dashboard")
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  if (supabase) {
    await supabase.auth.signOut()
  }
  revalidatePath("/", "layout")
  redirect("/login")
}

"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type { SettingsActionState } from "./state"

export async function updateProfile(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured.",
      message: null,
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "You must be signed in.", message: null, fieldErrors: {} }
  }

  const fullName = String(formData.get("fullName") ?? "").trim().slice(0, 120)
  const timezone = String(formData.get("timezone") ?? "").trim().slice(0, 64)

  // Validate against the runtime's own tz database rather than a hard-coded
  // list, so any zone the browser offers is accepted.
  let validZone = "UTC"
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone })
      validZone = timezone
    } catch {
      return {
        error: "Please correct the highlighted fields.",
        message: null,
        fieldErrors: { timezone: "Unrecognised timezone." },
      }
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName || null, timezone: validZone })
    .eq("id", user.id)

  if (error) {
    return { error: error.message, message: null, fieldErrors: {} }
  }

  revalidatePath("/settings")
  revalidatePath("/", "layout")
  return { error: null, message: "Profile updated.", fieldErrors: {} }
}

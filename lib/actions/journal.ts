"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { JournalActionState } from "./state"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TEXT = 10000

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim().slice(0, MAX_TEXT)
}

/**
 * Creates or updates the entry for a given day.
 *
 * Journal entries are unique per (user, date) in the schema, so this upserts
 * on that constraint rather than requiring the UI to know whether today's
 * entry already exists.
 */
export async function saveJournalEntry(
  _prev: JournalActionState,
  formData: FormData,
): Promise<JournalActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so entries cannot be saved.",
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const entryDate = String(formData.get("entryDate") ?? "").trim()
  if (!ISO_DATE.test(entryDate)) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { entryDate: "A valid date is required." },
    }
  }

  const mood = String(formData.get("mood") ?? "").trim()

  const { error } = await supabase.from("journal_entries").upsert(
    {
      user_id: user.id,
      entry_date: entryDate,
      pre_market_plan: text(formData, "preMarketPlan"),
      session_notes: text(formData, "sessionNotes"),
      post_market_review: text(formData, "postMarketReview"),
      lessons: text(formData, "lessons"),
      mood: mood && mood !== "none" ? mood : null,
    },
    { onConflict: "user_id,entry_date" },
  )

  if (error) return { error: error.message, fieldErrors: {} }

  revalidatePath("/journal")
  redirect(`/journal?date=${entryDate}`)
}

export async function deleteJournalEntry(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  await supabase.from("journal_entries").delete().eq("id", id)

  revalidatePath("/journal")
  redirect("/journal")
}

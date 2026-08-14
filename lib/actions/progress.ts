"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Records whether a discipline rule was honoured on a given day.
 *
 * Upserts on (rule_id, completion_date) so repeatedly toggling a rule updates
 * one row instead of accumulating duplicates.
 */
export async function toggleProgressRule(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const ruleId = String(formData.get("ruleId") ?? "").trim()
  const date = String(formData.get("date") ?? "").trim()
  const completed = String(formData.get("completed") ?? "") === "true"

  if (!ruleId || !ISO_DATE.test(date)) return

  await supabase.from("progress_completions").upsert(
    {
      user_id: user.id,
      rule_id: ruleId,
      completion_date: date,
      completed,
    },
    { onConflict: "rule_id,completion_date" },
  )

  revalidatePath("/progress")
}

export async function addProgressRule(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const label = String(formData.get("label") ?? "").trim().slice(0, 200)
  if (!label) return

  const { count } = await supabase
    .from("progress_rules")
    .select("id", { count: "exact", head: true })

  await supabase.from("progress_rules").insert({
    user_id: user.id,
    label,
    sort_order: (count ?? 0) + 1,
  })

  revalidatePath("/progress")
}

export async function deleteProgressRule(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  await supabase.from("progress_rules").delete().eq("id", id)
  revalidatePath("/progress")
}

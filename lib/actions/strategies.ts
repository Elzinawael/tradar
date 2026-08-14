"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { StrategyActionState } from "./state"

const MAX_TEXT = 10000

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim().slice(0, MAX_TEXT)
}

function buildRow(formData: FormData, userId: string) {
  const checklist = String(formData.get("checklist") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 50)

  return {
    user_id: userId,
    name: String(formData.get("name") ?? "").trim().slice(0, 200),
    description: text(formData, "description"),
    market: String(formData.get("market") ?? "").trim().slice(0, 100),
    timeframe: String(formData.get("timeframe") ?? "").trim().slice(0, 50),
    entry_rules: text(formData, "entryRules"),
    exit_rules: text(formData, "exitRules"),
    risk_rules: text(formData, "riskRules"),
    checklist,
    notes: text(formData, "notes"),
  }
}

export async function saveStrategy(
  _prev: StrategyActionState,
  formData: FormData,
): Promise<StrategyActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so strategies cannot be saved.",
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const row = buildRow(formData, user.id)
  if (!row.name) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { name: "A strategy name is required." },
    }
  }

  const id = String(formData.get("id") ?? "").trim()

  const { error } = id
    ? await supabase.from("strategies").update(row).eq("id", id)
    : await supabase.from("strategies").insert(row)

  if (error) return { error: error.message, fieldErrors: {} }

  revalidatePath("/strategies")
  redirect("/strategies")
}

export async function deleteStrategy(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  // Trades reference strategies with ON DELETE SET NULL, so history is kept.
  await supabase.from("strategies").delete().eq("id", id)

  revalidatePath("/strategies")
  revalidatePath("/trades")
  redirect("/strategies")
}

"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import type { SettingsActionState } from "./state"

/** ISO-4217-style code: three or four uppercase letters (covers USDT etc.). */
const CURRENCY = /^[A-Z]{3,4}$/

function parseAccount(formData: FormData) {
  const errors: Record<string, string> = {}

  const name = String(formData.get("name") ?? "").trim().slice(0, 120)
  if (!name) errors.name = "An account name is required."

  const currency = String(formData.get("currency") ?? "")
    .trim()
    .toUpperCase()
  if (!CURRENCY.test(currency)) {
    errors.currency = "Use a currency code such as USD or EUR."
  }

  const raw = String(formData.get("startingBalance") ?? "").trim()
  const startingBalance = raw === "" ? 0 : Number(raw)
  if (!Number.isFinite(startingBalance)) {
    errors.startingBalance = "Starting balance must be a number."
  } else if (startingBalance < 0) {
    errors.startingBalance = "Starting balance cannot be negative."
  }

  const broker = String(formData.get("broker") ?? "").trim().slice(0, 120)

  return {
    errors,
    value: { name, currency, startingBalance, broker: broker || null },
  }
}

export async function createAccount(
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

  const { errors, value } = parseAccount(formData)
  if (Object.keys(errors).length > 0) {
    return {
      error: "Please correct the highlighted fields.",
      message: null,
      fieldErrors: errors,
    }
  }

  // The first account a user creates becomes their default.
  const { count } = await supabase
    .from("trading_accounts")
    .select("id", { count: "exact", head: true })

  const { error } = await supabase.from("trading_accounts").insert({
    user_id: user.id,
    name: value.name,
    broker: value.broker,
    currency: value.currency,
    starting_balance: value.startingBalance,
    is_default: (count ?? 0) === 0,
  })

  if (error) {
    return { error: error.message, message: null, fieldErrors: {} }
  }

  revalidatePath("/settings")
  revalidatePath("/dashboard")
  return { error: null, message: `Created ${value.name}.`, fieldErrors: {} }
}

export async function updateAccount(
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

  const id = String(formData.get("id") ?? "").trim()
  if (!id) {
    return { error: "Missing account id.", message: null, fieldErrors: {} }
  }

  const { errors, value } = parseAccount(formData)
  if (Object.keys(errors).length > 0) {
    return {
      error: "Please correct the highlighted fields.",
      message: null,
      fieldErrors: errors,
    }
  }

  const { error } = await supabase
    .from("trading_accounts")
    .update({
      name: value.name,
      broker: value.broker,
      currency: value.currency,
      starting_balance: value.startingBalance,
    })
    .eq("id", id)

  if (error) {
    return { error: error.message, message: null, fieldErrors: {} }
  }

  // The starting balance seeds the equity curve, so analytics must refresh.
  revalidatePath("/settings")
  revalidatePath("/dashboard")
  revalidatePath("/reports")
  return { error: null, message: "Account updated.", fieldErrors: {} }
}

/** Marks one account default and clears the flag on the others. */
export async function setDefaultAccount(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  // Scoped to the caller by RLS; user_id is only used to target their rows.
  await supabase
    .from("trading_accounts")
    .update({ is_default: false })
    .eq("user_id", user.id)

  await supabase
    .from("trading_accounts")
    .update({ is_default: true })
    .eq("id", id)

  revalidatePath("/settings")
  revalidatePath("/dashboard")
}

/**
 * Deletes an account. Trades reference accounts with ON DELETE CASCADE, so the
 * account's trade history goes with it — the UI must confirm before calling
 * this, and the last remaining account cannot be removed.
 */
export async function deleteAccount(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  const { count } = await supabase
    .from("trading_accounts")
    .select("id", { count: "exact", head: true })

  // Refuse to remove the last account: trades require one.
  if ((count ?? 0) <= 1) return

  await supabase.from("trading_accounts").delete().eq("id", id)

  revalidatePath("/settings")
  revalidatePath("/dashboard")
  revalidatePath("/trades")
}

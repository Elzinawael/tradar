"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  computeDurationMinutes,
  computeRMultiple,
  computeTradePnl,
  deriveTradeStatus,
} from "@/lib/trade-math"
import type { TradeDirection } from "@/lib/types"
import type { TradeActionState } from "./state"

interface ParsedTrade {
  accountId: string
  strategyId: string | null
  symbol: string
  direction: TradeDirection
  entryPrice: number
  exitPrice: number | null
  stopPrice: number | null
  quantity: number
  fees: number
  openedAt: string
  closedAt: string | null
  tags: string[]
  notes: string
}

function optionalNumber(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim()
  if (value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Validates and normalises the trade form payload.
 * Returns either the parsed trade or a map of per-field messages.
 */
function parseTradeForm(
  formData: FormData,
): { ok: true; value: ParsedTrade } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {}

  const accountId = String(formData.get("accountId") ?? "").trim()
  if (!accountId) errors.accountId = "Select a trading account."

  const symbol = String(formData.get("symbol") ?? "")
    .trim()
    .toUpperCase()
  if (!symbol) errors.symbol = "Symbol is required."
  else if (symbol.length > 32) errors.symbol = "Symbol is too long."

  const directionRaw = String(formData.get("direction") ?? "").trim()
  if (directionRaw !== "long" && directionRaw !== "short") {
    errors.direction = "Choose long or short."
  }

  const entryPrice = optionalNumber(formData.get("entryPrice"))
  if (entryPrice === null) errors.entryPrice = "Entry price is required."
  else if (entryPrice <= 0) errors.entryPrice = "Entry price must be positive."

  const quantity = optionalNumber(formData.get("quantity"))
  if (quantity === null) errors.quantity = "Quantity is required."
  else if (quantity <= 0) errors.quantity = "Quantity must be positive."

  const exitPrice = optionalNumber(formData.get("exitPrice"))
  if (exitPrice !== null && exitPrice <= 0) {
    errors.exitPrice = "Exit price must be positive."
  }

  const stopPrice = optionalNumber(formData.get("stopPrice"))
  if (stopPrice !== null && stopPrice <= 0) {
    errors.stopPrice = "Stop price must be positive."
  }

  const feesValue = optionalNumber(formData.get("fees"))
  const fees = feesValue === null ? 0 : feesValue
  if (fees < 0) errors.fees = "Fees cannot be negative."

  const openedAtRaw = String(formData.get("openedAt") ?? "").trim()
  if (!openedAtRaw) errors.openedAt = "Entry date and time are required."
  const openedAt = openedAtRaw ? new Date(openedAtRaw) : null
  if (openedAt && Number.isNaN(openedAt.getTime())) {
    errors.openedAt = "Entry date is invalid."
  }

  const closedAtRaw = String(formData.get("closedAt") ?? "").trim()
  const closedAt = closedAtRaw ? new Date(closedAtRaw) : null
  if (closedAt && Number.isNaN(closedAt.getTime())) {
    errors.closedAt = "Exit date is invalid."
  }
  if (openedAt && closedAt && closedAt.getTime() < openedAt.getTime()) {
    errors.closedAt = "Exit time cannot be before entry time."
  }

  // A trade is only closed when both an exit price and an exit time exist.
  if (closedAt && exitPrice === null) {
    errors.exitPrice = "An exit price is required to close the trade."
  }
  if (exitPrice !== null && !closedAt) {
    errors.closedAt = "An exit time is required to close the trade."
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 20)

  const strategyRaw = String(formData.get("strategyId") ?? "").trim()

  return {
    ok: true,
    value: {
      accountId,
      strategyId: strategyRaw && strategyRaw !== "none" ? strategyRaw : null,
      symbol,
      direction: directionRaw as TradeDirection,
      entryPrice: entryPrice as number,
      exitPrice,
      stopPrice,
      quantity: quantity as number,
      fees,
      openedAt: (openedAt as Date).toISOString(),
      closedAt: closedAt ? closedAt.toISOString() : null,
      tags,
      notes: String(formData.get("notes") ?? "").trim().slice(0, 5000),
    },
  }
}

/** Builds the database row, deriving P&L, status, duration and R-multiple. */
function toRow(trade: ParsedTrade, userId: string) {
  const pnl = computeTradePnl({
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    fees: trade.fees,
  })

  const status = deriveTradeStatus(pnl, trade.exitPrice)

  return {
    user_id: userId,
    account_id: trade.accountId,
    strategy_id: trade.strategyId,
    symbol: trade.symbol,
    direction: trade.direction,
    entry_price: trade.entryPrice,
    exit_price: trade.exitPrice,
    quantity: trade.quantity,
    fees: trade.fees,
    pnl: pnl ?? 0,
    r_multiple: computeRMultiple({
      direction: trade.direction,
      entryPrice: trade.entryPrice,
      stopPrice: trade.stopPrice,
      quantity: trade.quantity,
      pnl,
    }),
    status,
    opened_at: trade.openedAt,
    closed_at: trade.closedAt,
    duration_minutes: computeDurationMinutes(trade.openedAt, trade.closedAt),
    tags: trade.tags,
    notes: trade.notes,
  }
}

export async function createTrade(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so trades cannot be saved.",
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const parsed = parseTradeForm(formData)
  if (!parsed.ok) {
    return { error: "Please correct the highlighted fields.", fieldErrors: parsed.errors }
  }

  const { error } = await supabase.from("trades").insert(toRow(parsed.value, user.id))

  if (error) return { error: error.message, fieldErrors: {} }

  revalidatePath("/trades")
  revalidatePath("/dashboard")
  redirect("/trades")
}

export async function updateTrade(
  _prev: TradeActionState,
  formData: FormData,
): Promise<TradeActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so trades cannot be saved.",
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return { error: "Missing trade id.", fieldErrors: {} }

  const parsed = parseTradeForm(formData)
  if (!parsed.ok) {
    return { error: "Please correct the highlighted fields.", fieldErrors: parsed.errors }
  }

  // RLS restricts this to the caller's own rows; the id filter is not the
  // security boundary, it only selects which of their rows to update.
  const { error } = await supabase
    .from("trades")
    .update(toRow(parsed.value, user.id))
    .eq("id", id)

  if (error) return { error: error.message, fieldErrors: {} }

  revalidatePath("/trades")
  revalidatePath(`/trades/${id}`)
  revalidatePath("/dashboard")
  redirect(`/trades/${id}`)
}

export async function deleteTrade(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  await supabase.from("trades").delete().eq("id", id)

  revalidatePath("/trades")
  revalidatePath("/dashboard")
  redirect("/trades")
}

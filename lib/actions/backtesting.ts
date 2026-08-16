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
import type { BacktestActionState } from "./state"

const STATUSES = ["draft", "running", "completed"] as const

function optionalNumber(raw: FormDataEntryValue | null): number | null {
  const value = String(raw ?? "").trim()
  if (value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function saveBacktestSession(
  _prev: BacktestActionState,
  formData: FormData,
): Promise<BacktestActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so sessions cannot be saved.",
      fieldErrors: {},
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const errors: Record<string, string> = {}

  const name = String(formData.get("name") ?? "").trim().slice(0, 200)
  if (!name) errors.name = "A session name is required."

  const initialBalance = optionalNumber(formData.get("initialBalance")) ?? 0
  if (initialBalance < 0) {
    errors.initialBalance = "Starting balance cannot be negative."
  }

  const riskPerTrade = optionalNumber(formData.get("riskPerTrade")) ?? 0
  if (riskPerTrade < 0 || riskPerTrade > 100) {
    errors.riskPerTrade = "Risk per trade is a percentage between 0 and 100."
  }

  const statusRaw = String(formData.get("status") ?? "draft").trim()
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw
    : "draft"

  if (Object.keys(errors).length > 0) {
    return { error: "Please correct the highlighted fields.", fieldErrors: errors }
  }

  const strategyRaw = String(formData.get("strategyId") ?? "").trim()

  const row = {
    user_id: user.id,
    name,
    symbol: String(formData.get("symbol") ?? "").trim().toUpperCase().slice(0, 32),
    timeframe: String(formData.get("timeframe") ?? "").trim().slice(0, 32),
    initial_balance: initialBalance,
    risk_per_trade: riskPerTrade,
    status,
    strategy_id: strategyRaw && strategyRaw !== "none" ? strategyRaw : null,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 10000),
  }

  const id = String(formData.get("id") ?? "").trim()

  if (id) {
    const { error } = await supabase
      .from("backtest_sessions")
      .update(row)
      .eq("id", id)
    if (error) return { error: error.message, fieldErrors: {} }

    revalidatePath("/backtesting")
    revalidatePath(`/backtesting/sessions/${id}`)
    redirect(`/backtesting/sessions/${id}`)
  }

  const { data, error } = await supabase
    .from("backtest_sessions")
    .insert(row)
    .select("id")
    .single()

  if (error || !data) {
    return { error: error?.message ?? "Could not create the session.", fieldErrors: {} }
  }

  revalidatePath("/backtesting")
  revalidatePath("/backtesting/sessions")
  redirect(`/backtesting/sessions/${data.id}`)
}

export async function deleteBacktestSession(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  // Simulated trades reference the session with ON DELETE CASCADE.
  await supabase.from("backtest_sessions").delete().eq("id", id)

  revalidatePath("/backtesting")
  revalidatePath("/backtesting/sessions")
  redirect("/backtesting/sessions")
}

// ---------------------------------------------------------------------------
// Simulated trades
// ---------------------------------------------------------------------------

/**
 * Validates a simulated trade and derives its financial values.
 *
 * P&L, status, hold time and R-multiple are always recomputed here with the
 * same lib/trade-math.ts helpers live trades use. Nothing calculated on the
 * client is trusted, so a simulated trade and a live trade with identical
 * inputs always produce identical numbers.
 */
function parseSimulatedTrade(formData: FormData) {
  const errors: Record<string, string> = {}

  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase()
  if (!symbol) errors.symbol = "Symbol is required."

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

  const takeProfit = optionalNumber(formData.get("takeProfit"))
  if (takeProfit !== null && takeProfit <= 0) {
    errors.takeProfit = "Take profit must be positive."
  }

  const fees = optionalNumber(formData.get("fees")) ?? 0
  if (fees < 0) errors.fees = "Fees cannot be negative."

  const openedRaw = String(formData.get("openedAt") ?? "").trim()
  if (!openedRaw) errors.openedAt = "Entry time is required."
  const openedAt = openedRaw ? new Date(openedRaw) : null
  if (openedAt && Number.isNaN(openedAt.getTime())) {
    errors.openedAt = "Entry time is invalid."
  }

  const closedRaw = String(formData.get("closedAt") ?? "").trim()
  const closedAt = closedRaw ? new Date(closedRaw) : null
  if (closedAt && Number.isNaN(closedAt.getTime())) {
    errors.closedAt = "Exit time is invalid."
  }
  if (openedAt && closedAt && closedAt.getTime() < openedAt.getTime()) {
    errors.closedAt = "Exit time cannot be before entry time."
  }

  // Mirrors the database constraint.
  if (closedAt && exitPrice === null) {
    errors.exitPrice = "An exit price is required to close the trade."
  }
  if (exitPrice !== null && !closedAt) {
    errors.closedAt = "An exit time is required to close the trade."
  }

  if (Object.keys(errors).length > 0) return { ok: false as const, errors }

  const direction = directionRaw as TradeDirection
  const pnl = computeTradePnl({
    direction,
    entryPrice: entryPrice as number,
    exitPrice,
    quantity: quantity as number,
    fees,
  })

  const strategyRaw = String(formData.get("strategyId") ?? "").trim()

  return {
    ok: true as const,
    value: {
      symbol,
      direction,
      entry_price: entryPrice as number,
      exit_price: exitPrice,
      stop_price: stopPrice,
      take_profit: takeProfit,
      quantity: quantity as number,
      fees,
      pnl: pnl ?? 0,
      r_multiple: computeRMultiple({
        direction,
        entryPrice: entryPrice as number,
        stopPrice,
        quantity: quantity as number,
        pnl,
      }),
      status: deriveTradeStatus(pnl, exitPrice),
      opened_at: (openedAt as Date).toISOString(),
      closed_at: closedAt ? closedAt.toISOString() : null,
      duration_minutes: computeDurationMinutes(
        (openedAt as Date).toISOString(),
        closedAt ? closedAt.toISOString() : null,
      ),
      strategy_id: strategyRaw && strategyRaw !== "none" ? strategyRaw : null,
      tags: String(formData.get("tags") ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      notes: String(formData.get("notes") ?? "").trim().slice(0, 5000),
    },
  }
}

export async function saveSimulatedTrade(
  _prev: BacktestActionState,
  formData: FormData,
): Promise<BacktestActionState> {
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

  const sessionId = String(formData.get("sessionId") ?? "").trim()
  if (!sessionId) return { error: "Missing session.", fieldErrors: {} }

  const parsed = parseSimulatedTrade(formData)
  if (!parsed.ok) {
    return { error: "Please correct the highlighted fields.", fieldErrors: parsed.errors }
  }

  const id = String(formData.get("id") ?? "").trim()

  // The database also enforces that session_id belongs to the caller, so a
  // forged session id is rejected even if this check were bypassed.
  const { error } = id
    ? await supabase
        .from("backtest_trades")
        .update({ ...parsed.value, session_id: sessionId })
        .eq("id", id)
    : await supabase.from("backtest_trades").insert({
        ...parsed.value,
        user_id: user.id,
        session_id: sessionId,
      })

  if (error) return { error: error.message, fieldErrors: {} }

  revalidatePath("/backtesting")
  revalidatePath(`/backtesting/sessions/${sessionId}`)
  redirect(`/backtesting/sessions/${sessionId}`)
}

export async function deleteSimulatedTrade(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  const sessionId = String(formData.get("sessionId") ?? "").trim()
  if (!id) return

  await supabase.from("backtest_trades").delete().eq("id", id)

  revalidatePath("/backtesting")
  if (sessionId) revalidatePath(`/backtesting/sessions/${sessionId}`)
  redirect(sessionId ? `/backtesting/sessions/${sessionId}` : "/backtesting/sessions")
}

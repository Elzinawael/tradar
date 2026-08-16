"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isTimeframe } from "@/lib/candles"
import {
  computeDurationMinutes,
  computeRMultiple,
  computeTradePnl,
  deriveTradeStatus,
} from "@/lib/trade-math"
import type { TradeDirection } from "@/lib/types"
import type { BacktestActionState } from "./state"

/**
 * Replay actions.
 *
 * The cursor lives in the database, not the browser. Advancing it is a server
 * action that clamps to the selected range, and a CHECK constraint enforces
 * the same bound at the storage layer — so the cursor cannot be pushed past
 * the historical window even by a forged request.
 */

export async function createReplaySession(
  _prev: BacktestActionState,
  formData: FormData,
): Promise<BacktestActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return { error: "Supabase is not configured.", fieldErrors: {} }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const errors: Record<string, string> = {}

  const sessionId = String(formData.get("sessionId") ?? "").trim()
  if (!sessionId) errors.sessionId = "Choose a backtest session."

  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase()
  if (!symbol) errors.symbol = "Choose a symbol."

  const timeframe = String(formData.get("timeframe") ?? "").trim()
  if (!isTimeframe(timeframe)) errors.timeframe = "Choose a timeframe."

  const fromRaw = String(formData.get("rangeStart") ?? "").trim()
  const toRaw = String(formData.get("rangeEnd") ?? "").trim()
  const start = new Date(fromRaw)
  const end = new Date(toRaw)

  if (!Number.isFinite(start.getTime())) errors.rangeStart = "Choose a start date."
  if (!Number.isFinite(end.getTime())) errors.rangeEnd = "Choose an end date."
  if (
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    end <= start
  ) {
    errors.rangeEnd = "The end must be after the start."
  }

  if (Object.keys(errors).length > 0) {
    return { error: "Please correct the highlighted fields.", fieldErrors: errors }
  }

  // The cursor starts at the beginning of the range: nothing is revealed yet.
  const { data, error } = await supabase
    .from("replay_sessions")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      symbol,
      timeframe,
      range_start: start.toISOString(),
      range_end: end.toISOString(),
      cursor_ts: start.toISOString(),
      speed: 1,
    })
    .select("id")
    .single()

  if (error || !data) {
    return { error: error?.message ?? "Could not start the replay.", fieldErrors: {} }
  }

  revalidatePath("/replay")
  redirect(`/replay/${data.id}`)
}

/**
 * Moves the cursor to an explicit bar timestamp.
 *
 * The value is clamped into [range_start, range_end] here, and the database
 * CHECK constraint rejects anything outside that window regardless.
 */
export async function setReplayCursor(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  const cursor = String(formData.get("cursorTs") ?? "").trim()
  if (!id || !cursor) return

  const { data: session } = await supabase
    .from("replay_sessions")
    .select("range_start, range_end")
    .eq("id", id)
    .maybeSingle()

  if (!session) return

  const target = new Date(cursor).getTime()
  const lower = new Date(session.range_start as string).getTime()
  const upper = new Date(session.range_end as string).getTime()
  if (!Number.isFinite(target)) return

  const clamped = new Date(Math.min(Math.max(target, lower), upper)).toISOString()

  await supabase
    .from("replay_sessions")
    .update({ cursor_ts: clamped })
    .eq("id", id)

  revalidatePath(`/replay/${id}`)
}

/** Restarts a replay from the beginning of its range. */
export async function resetReplay(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  const { data: session } = await supabase
    .from("replay_sessions")
    .select("range_start")
    .eq("id", id)
    .maybeSingle()

  if (!session) return

  await supabase
    .from("replay_sessions")
    .update({ cursor_ts: session.range_start as string })
    .eq("id", id)

  revalidatePath(`/replay/${id}`)
}

export async function setReplaySpeed(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  const raw = Number(String(formData.get("speed") ?? "1"))
  if (!id || !Number.isFinite(raw)) return

  const speed = Math.min(100, Math.max(0.25, raw))
  await supabase.from("replay_sessions").update({ speed }).eq("id", id)

  revalidatePath(`/replay/${id}`)
}

export async function deleteReplaySession(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  if (!id) return

  // Trades produced by the replay are kept; replay_id is set to null.
  await supabase.from("replay_sessions").delete().eq("id", id)

  revalidatePath("/replay")
  redirect("/replay")
}

/**
 * Records a trade placed during replay.
 *
 * Every financial value is derived here with the shared lib/trade-math.ts
 * helpers, never taken from the client. The trade is written to
 * backtest_trades with origin = 'replay' and linked to both the replay and its
 * backtest session, so it flows into that session's equity curve and
 * statistics through the existing analytics path.
 *
 * The entry price is not accepted from the browser either: it is read from the
 * candle at the cursor, so a trade cannot be filled at a price the market
 * never traded at during the visible window.
 */
export async function placeReplayTrade(
  _prev: BacktestActionState,
  formData: FormData,
): Promise<BacktestActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return { error: "Supabase is not configured.", fieldErrors: {} }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "You must be signed in.", fieldErrors: {} }

  const replayId = String(formData.get("replayId") ?? "").trim()
  if (!replayId) return { error: "Missing replay.", fieldErrors: {} }

  const { data: replay } = await supabase
    .from("replay_sessions")
    .select("id, session_id, symbol, timeframe, cursor_ts, range_end")
    .eq("id", replayId)
    .maybeSingle()

  if (!replay) return { error: "Replay not found.", fieldErrors: {} }

  const directionRaw = String(formData.get("direction") ?? "").trim()
  if (directionRaw !== "long" && directionRaw !== "short") {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { direction: "Choose long or short." },
    }
  }
  const direction = directionRaw as TradeDirection

  const numberOrNull = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim()
    if (raw === "") return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  const quantity = numberOrNull("quantity")
  const stopPrice = numberOrNull("stopPrice")
  const takeProfit = numberOrNull("takeProfit")
  const exitPrice = numberOrNull("exitPrice")
  const fees = numberOrNull("fees") ?? 0

  if (quantity === null || quantity <= 0) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { quantity: "Position size must be positive." },
    }
  }

  // Entry comes from the bar at the cursor, not from the client.
  const { data: entryCandle } = await supabase
    .from("candles")
    .select("ts, close")
    .eq("symbol", replay.symbol as string)
    .eq("timeframe", replay.timeframe as string)
    .lte("ts", replay.cursor_ts as string)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!entryCandle) {
    return {
      error: "There is no candle at the cursor to fill against.",
      fieldErrors: {},
    }
  }

  const entryPrice = Number(entryCandle.close)
  const openedAt = String(entryCandle.ts)

  const closedRaw = String(formData.get("closedAt") ?? "").trim()
  const closedAt = closedRaw ? new Date(closedRaw) : null
  const hasExit = exitPrice !== null && closedAt !== null

  if (exitPrice !== null && closedAt === null) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { closedAt: "An exit time is required to close the trade." },
    }
  }
  if (closedAt !== null && exitPrice === null) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { exitPrice: "An exit price is required to close the trade." },
    }
  }

  const pnl = hasExit
    ? computeTradePnl({ direction, entryPrice, exitPrice, quantity, fees })
    : null

  const closedIso = closedAt ? closedAt.toISOString() : null

  const { error } = await supabase.from("backtest_trades").insert({
    user_id: user.id,
    session_id: replay.session_id as string,
    replay_id: replay.id as string,
    origin: "replay",
    symbol: replay.symbol as string,
    direction,
    entry_price: entryPrice,
    exit_price: exitPrice,
    stop_price: stopPrice,
    take_profit: takeProfit,
    quantity,
    fees,
    pnl: pnl ?? 0,
    r_multiple: computeRMultiple({
      direction,
      entryPrice,
      stopPrice,
      quantity,
      pnl,
    }),
    status: deriveTradeStatus(pnl, exitPrice),
    opened_at: openedAt,
    closed_at: closedIso,
    duration_minutes: computeDurationMinutes(openedAt, closedIso),
    entry_candle_ts: openedAt,
    exit_candle_ts: closedIso,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 5000),
  })

  if (error) return { error: error.message, fieldErrors: {} }

  // The session's equity curve and statistics recompute from these trades.
  revalidatePath(`/replay/${replayId}`)
  revalidatePath(`/backtesting/sessions/${replay.session_id}`)
  revalidatePath("/backtesting")

  return { error: null, fieldErrors: {} }
}

"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { isTimeframe } from "@/lib/candles"
import {
  computeDurationMinutes,
  computePositionSize,
  computeRMultiple,
  computeTradePnl,
  deriveTradeStatus,
} from "@/lib/trade-math"
import { findExit, validateLevels } from "@/lib/replay-engine"
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

/** Shown whenever a replay already has a live position. */
const POSITION_ALREADY_OPEN =
  "Close the current position before opening a new trade."

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
 * Opens a replay position.
 *
 * This action means "open a position", not "create a trade with an exit". The
 * browser cannot supply an entry price, an exit price or an exit time:
 *
 *   - entry comes from the candle at the server-side cursor
 *   - quantity is derived from session equity, risk % and stop distance
 *   - exit is decided later by advanceReplay() from historical candles
 *
 * The trade is written to backtest_trades with status 'open', origin 'replay'
 * and a null exit, so it flows into the session's analytics through the same
 * path as every other trade.
 */
export async function openReplayPosition(
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

  // RLS scopes this select to the caller, so another user's replay is simply
  // not found rather than being operated on.
  const { data: replay } = await supabase
    .from("replay_sessions")
    .select("id, session_id, symbol, timeframe, cursor_ts")
    .eq("id", replayId)
    .maybeSingle()

  if (!replay) return { error: "Replay not found.", fieldErrors: {} }

  // One position at a time keeps the simulator honest: a stop is sized against
  // session equity, and stacking positions would silently multiply the risk.
  //
  // This is a fast path for a clear error message. It is NOT the guarantee —
  // a check followed by an insert is a race, and two requests arriving
  // together would both pass it. The partial unique index added in 0008 is the
  // actual authority, and the insert below handles its violation.
  const { count: openCount } = await supabase
    .from("backtest_trades")
    .select("id", { count: "exact", head: true })
    .eq("replay_id", replayId)
    .eq("status", "open")

  if ((openCount ?? 0) > 0) {
    return { error: POSITION_ALREADY_OPEN, fieldErrors: {} }
  }

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

  const stopPrice = numberOrNull("stopPrice")
  const takeProfit = numberOrNull("takeProfit")

  // Entry is the close of the bar at the cursor — never taken from the client.
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

  const levelErrors = validateLevels({
    direction,
    entryPrice,
    stopPrice,
    takeProfit,
  })
  if (Object.keys(levelErrors).length > 0) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: levelErrors,
    }
  }

  // Size is derived, never accepted: risk % of session equity over the stop
  // distance, using the shared helper manual entry also uses.
  const { balance, riskPercent } = await sessionRisk(
    supabase,
    replay.session_id as string,
  )

  const quantity = computePositionSize({
    direction,
    entryPrice,
    stopPrice,
    balance,
    riskPercent,
  })

  if (quantity === null) {
    return {
      error:
        "Position size could not be calculated. Check the stop is on the losing side of entry and the session has a balance.",
      fieldErrors: {},
    }
  }

  const { error } = await supabase.from("backtest_trades").insert({
    user_id: user.id,
    session_id: replay.session_id as string,
    replay_id: replay.id as string,
    origin: "replay",
    symbol: replay.symbol as string,
    direction,
    entry_price: entryPrice,
    exit_price: null,
    stop_price: stopPrice,
    take_profit: takeProfit,
    quantity,
    fees: 0,
    pnl: 0,
    r_multiple: null,
    status: "open",
    opened_at: openedAt,
    closed_at: null,
    duration_minutes: null,
    entry_candle_ts: openedAt,
    exit_candle_ts: null,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 5000),
  })

  if (error) {
    // 23505 = unique_violation. Raised by the partial unique index when a
    // concurrent request opened a position first, so the second caller gets
    // the same message as the fast path rather than a database error.
    if (error.code === "23505") {
      return { error: POSITION_ALREADY_OPEN, fieldErrors: {} }
    }
    return { error: error.message, fieldErrors: {} }
  }

  revalidatePath(`/replay/${replayId}`)
  revalidatePath(`/backtesting/sessions/${replay.session_id}`)
  revalidatePath("/backtesting")

  return { error: null, fieldErrors: {} }
}

/** Session equity and risk %, used for sizing. */
async function sessionRisk(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  sessionId: string,
): Promise<{ balance: number; riskPercent: number }> {
  const { data: session } = await supabase
    .from("backtest_sessions")
    .select("initial_balance, risk_per_trade")
    .eq("id", sessionId)
    .maybeSingle()

  const initial = Number(session?.initial_balance ?? 0)
  const riskPercent = Number(session?.risk_per_trade ?? 0) || 1

  // Equity = opening balance plus realised P&L on closed trades in this
  // session, so risk scales with the account as the backtest progresses.
  const { data: closed } = await supabase
    .from("backtest_trades")
    .select("pnl")
    .eq("session_id", sessionId)
    .neq("status", "open")

  const realised = (closed ?? []).reduce(
    (sum, row) => sum + Number((row as { pnl: unknown }).pnl ?? 0),
    0,
  )

  return { balance: initial + realised, riskPercent }
}

/**
 * Advances the replay cursor and evaluates any open position.
 *
 * This is the authoritative path for BOTH Step and Play. The cursor is read
 * from the database rather than trusted from the request, and only the bars
 * about to be revealed are fetched — the query is
 * `ts > cursor ORDER BY ts LIMIT bars`, so no candle beyond the new cursor is
 * ever loaded, let alone consulted.
 *
 * Each newly revealed bar is checked in chronological order and the FIRST
 * level touched closes the position, so a later bar cannot undo an earlier
 * exit.
 */
export async function advanceReplay(
  replayId: string,
  bars: number,
): Promise<{
  cursorTs: string | null
  atEnd: boolean
  closed: {
    reason: "stop" | "target"
    exitPrice: number
    pnl: number
    gapped: boolean
  } | null
  error: string | null
}> {
  const supabase = await createClient()
  if (!supabase) {
    return { cursorTs: null, atEnd: true, closed: null, error: "Supabase is not configured." }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { cursorTs: null, atEnd: true, closed: null, error: "You must be signed in." }
  }

  const { data: replay } = await supabase
    .from("replay_sessions")
    .select("id, session_id, symbol, timeframe, cursor_ts, range_end")
    .eq("id", replayId)
    .maybeSingle()

  if (!replay) {
    return { cursorTs: null, atEnd: true, closed: null, error: "Replay not found." }
  }

  const step = Math.min(500, Math.max(1, Math.floor(bars)))

  // Only the bars about to be revealed, bounded by the replay's own range end.
  const { data: nextRows } = await supabase
    .from("candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", replay.symbol as string)
    .eq("timeframe", replay.timeframe as string)
    .gt("ts", replay.cursor_ts as string)
    .lte("ts", replay.range_end as string)
    .order("ts", { ascending: true })
    .limit(step)

  const revealed = (nextRows ?? []).map((row) => ({
    ts: String((row as { ts: unknown }).ts),
    open: Number((row as { open: unknown }).open),
    high: Number((row as { high: unknown }).high),
    low: Number((row as { low: unknown }).low),
    close: Number((row as { close: unknown }).close),
    volume: null,
  }))

  if (revealed.length === 0) {
    return {
      cursorTs: String(replay.cursor_ts),
      atEnd: true,
      closed: null,
      error: null,
    }
  }

  const newCursor = revealed[revealed.length - 1].ts

  await supabase
    .from("replay_sessions")
    .update({ cursor_ts: newCursor })
    .eq("id", replayId)

  // Evaluate an open position against the bars just revealed.
  const { data: openTrade } = await supabase
    .from("backtest_trades")
    .select(
      "id, direction, entry_price, stop_price, take_profit, quantity, fees, opened_at",
    )
    .eq("replay_id", replayId)
    .eq("status", "open")
    .maybeSingle()

  let closed: {
    reason: "stop" | "target"
    exitPrice: number
    pnl: number
    gapped: boolean
  } | null = null

  if (openTrade) {
    const direction = String(openTrade.direction) as TradeDirection
    const stopPrice =
      openTrade.stop_price === null ? null : Number(openTrade.stop_price)
    const takeProfit =
      openTrade.take_profit === null ? null : Number(openTrade.take_profit)

    const hit = findExit({ direction, stopPrice, takeProfit }, revealed)

    if (hit) {
      const entryPrice = Number(openTrade.entry_price)
      const quantity = Number(openTrade.quantity)
      const fees = Number(openTrade.fees ?? 0)
      const exitPrice = hit.decision.exitPrice
      const openedAt = String(openTrade.opened_at)
      const exitTs = hit.candle.ts

      const pnl = computeTradePnl({
        direction,
        entryPrice,
        exitPrice,
        quantity,
        fees,
      })

      await supabase
        .from("backtest_trades")
        .update({
          exit_price: exitPrice,
          closed_at: exitTs,
          exit_candle_ts: exitTs,
          duration_minutes: computeDurationMinutes(openedAt, exitTs),
          pnl: pnl ?? 0,
          r_multiple: computeRMultiple({
            direction,
            entryPrice,
            stopPrice,
            quantity,
            pnl,
          }),
          status: deriveTradeStatus(pnl, exitPrice),
        })
        .eq("id", openTrade.id as string)

      closed = {
        reason: hit.decision.reason,
        exitPrice,
        pnl: pnl ?? 0,
        gapped: hit.decision.gapped,
      }
    }
  }

  revalidatePath(`/replay/${replayId}`)
  if (closed) {
    revalidatePath(`/backtesting/sessions/${replay.session_id}`)
    revalidatePath("/backtesting")
  }

  return {
    cursorTs: newCursor,
    atEnd: revealed.length < step,
    closed,
    error: null,
  }
}

/**
 * Closes an open position manually at the current bar's close.
 *
 * The exit price is read from the candle at the cursor, never accepted from
 * the client, so a manual close cannot be filled at a price the market did not
 * trade at.
 */
export async function closeReplayPosition(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const replayId = String(formData.get("replayId") ?? "").trim()
  if (!replayId) return

  const { data: replay } = await supabase
    .from("replay_sessions")
    .select("id, session_id, symbol, timeframe, cursor_ts")
    .eq("id", replayId)
    .maybeSingle()

  if (!replay) return

  const { data: openTrade } = await supabase
    .from("backtest_trades")
    .select("id, direction, entry_price, stop_price, quantity, fees, opened_at")
    .eq("replay_id", replayId)
    .eq("status", "open")
    .maybeSingle()

  if (!openTrade) return

  const { data: candle } = await supabase
    .from("candles")
    .select("ts, close")
    .eq("symbol", replay.symbol as string)
    .eq("timeframe", replay.timeframe as string)
    .lte("ts", replay.cursor_ts as string)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!candle) return

  const direction = String(openTrade.direction) as TradeDirection
  const entryPrice = Number(openTrade.entry_price)
  const quantity = Number(openTrade.quantity)
  const fees = Number(openTrade.fees ?? 0)
  const stopPrice =
    openTrade.stop_price === null ? null : Number(openTrade.stop_price)
  const exitPrice = Number(candle.close)
  const exitTs = String(candle.ts)
  const openedAt = String(openTrade.opened_at)

  const pnl = computeTradePnl({ direction, entryPrice, exitPrice, quantity, fees })

  await supabase
    .from("backtest_trades")
    .update({
      exit_price: exitPrice,
      closed_at: exitTs,
      exit_candle_ts: exitTs,
      duration_minutes: computeDurationMinutes(openedAt, exitTs),
      pnl: pnl ?? 0,
      r_multiple: computeRMultiple({
        direction,
        entryPrice,
        stopPrice,
        quantity,
        pnl,
      }),
      status: deriveTradeStatus(pnl, exitPrice),
    })
    .eq("id", openTrade.id as string)

  revalidatePath(`/replay/${replayId}`)
  revalidatePath(`/backtesting/sessions/${replay.session_id}`)
  revalidatePath("/backtesting")
}

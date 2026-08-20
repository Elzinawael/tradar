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
import {
  findExit,
  findOrderFill,
  validateLevels,
  validateOrderLevels,
  type OrderType,
} from "@/lib/replay-engine"
import {
  MAX_NOTES_LENGTH,
  normaliseMarketSession,
  normaliseSetup,
  normaliseTags,
} from "@/lib/classification"
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

  // --- classification -----------------------------------------------------
  // Validated server-side. strategy_id is additionally checked against the
  // caller by assert_owns_backtest_related(), so a forged id is rejected by the
  // database even if this code changed.
  const setup = normaliseSetup(String(formData.get("setup") ?? ""))
  if (setup === undefined) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { setup: "Setup is too long." },
    }
  }

  const marketSession = normaliseMarketSession(
    String(formData.get("marketSession") ?? ""),
  )
  if (marketSession === undefined) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { marketSession: "Market session is too long." },
    }
  }

  const tags = normaliseTags(String(formData.get("tags") ?? ""))

  const strategyRaw = String(formData.get("strategyId") ?? "").trim()
  const strategyId =
    strategyRaw && strategyRaw !== "none" ? strategyRaw : null

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
    strategy_id: strategyId,
    setup,
    market_session: marketSession,
    tags,
    notes: String(formData.get("notes") ?? "")
      .trim()
      .slice(0, MAX_NOTES_LENGTH),
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
  filled: { fillPrice: number; gapped: boolean } | null
  error: string | null
}> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      cursorTs: null,
      atEnd: true,
      closed: null,
      filled: null,
      error: "Supabase is not configured.",
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      cursorTs: null,
      atEnd: true,
      closed: null,
      filled: null,
      error: "You must be signed in.",
    }
  }

  const { data: replay } = await supabase
    .from("replay_sessions")
    .select("id, session_id, symbol, timeframe, cursor_ts, range_end")
    .eq("id", replayId)
    .maybeSingle()

  if (!replay) {
    return {
      cursorTs: null,
      atEnd: true,
      closed: null,
      filled: null,
      error: "Replay not found.",
    }
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
      filled: null,
      error: null,
    }
  }

  const newCursor = revealed[revealed.length - 1].ts

  await supabase
    .from("replay_sessions")
    .update({ cursor_ts: newCursor })
    .eq("id", replayId)

  // --- pending order matching -------------------------------------------
  //
  // Runs BEFORE the open-position check, so an order that fills on one of the
  // revealed bars can also be stopped out by a later bar in the same advance.
  // It reads `revealed` — the same array the reveal query produced — so no
  // additional candle is fetched and the look-ahead bound is unchanged.
  const fillResult = await matchPendingOrder(supabase, replayId, revealed)

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

    // If a pending order filled during this same advance, only bars from the
    // fill onward may close it — a bar that preceded the entry cannot.
    const evaluationWindow =
      fillResult && fillResult.tradeId === openTrade.id
        ? revealed.slice(fillResult.fillIndex + 1)
        : revealed

    const hit = findExit({ direction, stopPrice, takeProfit }, evaluationWindow)

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
          // Recorded from the reason the engine ACTED on, not inferred later
          // by comparing prices. A gap fill exits at the bar's open and so
          // matches neither level, which is exactly the case price comparison
          // used to get wrong.
          exit_reason:
            hit.decision.reason === "stop" ? "stop_loss" : "take_profit",
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
    filled: fillResult
      ? { fillPrice: fillResult.fillPrice, gapped: fillResult.gapped }
      : null,
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
      exit_reason: "manual",
    })
    .eq("id", openTrade.id as string)

  revalidatePath(`/replay/${replayId}`)
  revalidatePath(`/backtesting/sessions/${replay.session_id}`)
  revalidatePath("/backtesting")
}

// ---------------------------------------------------------------------------
// Pending orders
// ---------------------------------------------------------------------------

type ServerClient = NonNullable<Awaited<ReturnType<typeof createClient>>>

/** Shown whenever a replay already has a resting order. */
const ORDER_ALREADY_PENDING =
  "Cancel the pending order before placing a new one."

interface FillResult {
  tradeId: string
  fillPrice: number
  gapped: boolean
  /** Index within the revealed bars, so SL/TP is only checked after it. */
  fillIndex: number
}

/**
 * Matches the replay's pending order against newly revealed candles.
 *
 * Called from advanceReplay() with the SAME `revealed` array the reveal query
 * produced, so this introduces no additional candle read and cannot see past
 * the cursor. Bars are walked chronologically and the first qualifying bar
 * fills the order.
 *
 * Expiry is counted in revealed bars, never wall-clock time: inside a
 * simulation, replay time is the cursor.
 */
async function matchPendingOrder(
  supabase: ServerClient,
  replayId: string,
  revealed: { ts: string; open: number; high: number; low: number; close: number; volume: number | null }[],
): Promise<FillResult | null> {
  if (revealed.length === 0) return null

  const { data: order } = await supabase
    .from("replay_orders")
    .select(
      "id, user_id, session_id, strategy_id, symbol, direction, order_type, requested_price, stop_price, take_profit, quantity, expiry_bars, bars_elapsed, setup, market_session, tags, notes",
    )
    .eq("replay_id", replayId)
    .eq("status", "pending")
    .maybeSingle()

  if (!order) return null

  const direction = String(order.direction) as TradeDirection
  const stopPrice =
    order.stop_price === null ? null : Number(order.stop_price)
  const takeProfit =
    order.take_profit === null ? null : Number(order.take_profit)

  const hit = findOrderFill(
    {
      direction,
      orderType: String(order.order_type) as OrderType,
      requestedPrice:
        order.requested_price === null ? null : Number(order.requested_price),
      stopPrice,
      takeProfit,
    },
    revealed,
  )

  if (!hit) {
    // No fill on these bars: age the order and expire it if it has run out.
    const elapsed = Number(order.bars_elapsed ?? 0) + revealed.length
    const expiry = order.expiry_bars === null ? null : Number(order.expiry_bars)

    if (expiry !== null && elapsed >= expiry) {
      await supabase
        .from("replay_orders")
        .update({ status: "expired", bars_elapsed: elapsed })
        .eq("id", order.id as string)
    } else {
      await supabase
        .from("replay_orders")
        .update({ bars_elapsed: elapsed })
        .eq("id", order.id as string)
    }
    return null
  }

  // Expiry is checked against the bar the fill happened on: an order that
  // would have expired before that bar must not fill.
  const barsToFill = Number(order.bars_elapsed ?? 0) + hit.index + 1
  const expiry = order.expiry_bars === null ? null : Number(order.expiry_bars)
  if (expiry !== null && barsToFill > expiry) {
    await supabase
      .from("replay_orders")
      .update({ status: "expired", bars_elapsed: barsToFill })
      .eq("id", order.id as string)
    return null
  }

  const quantity = Number(order.quantity)
  const fillPrice = hit.outcome.fill.fillPrice
  const openedAt = hit.candle.ts

  // The conservative same-candle policy may close the position on the very bar
  // it opened on; the engine decided that, not this code.
  const immediate = hit.outcome.immediateExit
  const pnl = immediate
    ? computeTradePnl({
        direction,
        entryPrice: fillPrice,
        exitPrice: immediate.exitPrice,
        quantity,
        fees: 0,
      })
    : null

  const { data: trade, error } = await supabase
    .from("backtest_trades")
    .insert({
      user_id: order.user_id as string,
      session_id: order.session_id as string,
      replay_id: replayId,
      strategy_id: order.strategy_id as string | null,
      origin: "replay",
      symbol: order.symbol as string,
      direction,
      entry_price: fillPrice,
      exit_price: immediate ? immediate.exitPrice : null,
      stop_price: stopPrice,
      take_profit: takeProfit,
      quantity,
      fees: 0,
      pnl: pnl ?? 0,
      r_multiple: immediate
        ? computeRMultiple({
            direction,
            entryPrice: fillPrice,
            stopPrice,
            quantity,
            pnl,
          })
        : null,
      status: immediate ? deriveTradeStatus(pnl, immediate.exitPrice) : "open",
      opened_at: openedAt,
      closed_at: immediate ? openedAt : null,
      duration_minutes: immediate ? 0 : null,
      entry_candle_ts: openedAt,
      exit_candle_ts: immediate ? openedAt : null,
      exit_reason: immediate
        ? immediate.reason === "stop"
          ? "stop_loss"
          : "take_profit"
        : null,
      // Phase 3A classification carries across so nothing is lost when the
      // order becomes a position.
      setup: order.setup as string | null,
      market_session: order.market_session as string | null,
      tags: Array.isArray(order.tags) ? order.tags : [],
      notes: String(order.notes ?? ""),
    })
    .select("id")
    .single()

  if (error || !trade) return null

  await supabase
    .from("replay_orders")
    .update({
      status: "filled",
      filled_at: openedAt,
      fill_price: fillPrice,
      trade_id: trade.id as string,
      bars_elapsed: barsToFill,
    })
    .eq("id", order.id as string)

  return {
    tradeId: trade.id as string,
    fillPrice,
    gapped: hit.outcome.fill.gapped,
    // A position closed on its own filling bar needs no further evaluation.
    fillIndex: immediate ? revealed.length : hit.index,
  }
}

/**
 * Places a replay order.
 *
 * A market order fills immediately at the cursor candle's close through the
 * existing openReplayPosition() path. A limit or stop order rests until
 * advanceReplay() matches it against historical candles.
 *
 * The browser supplies the requested LEVEL only. It never supplies the fill
 * price, the fill time, or the quantity — size is recomputed here from session
 * equity and the stop distance, so submitting a different quantity has no
 * effect.
 */
export async function placeReplayOrder(
  _prev: BacktestActionState,
  formData: FormData,
): Promise<BacktestActionState> {
  const orderType = String(formData.get("orderType") ?? "market").trim()

  if (orderType === "market") {
    // Market orders keep the existing, already-tested code path.
    return openReplayPosition(_prev, formData)
  }

  if (orderType !== "limit" && orderType !== "stop") {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { orderType: "Choose market, limit or stop." },
    }
  }

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
    .select("id, session_id, symbol, timeframe, cursor_ts")
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

  const requestedPrice = numberOrNull("requestedPrice")
  const stopPrice = numberOrNull("stopPrice")
  const takeProfit = numberOrNull("takeProfit")

  // The current price comes from the cursor candle, not the browser.
  const { data: cursorCandle } = await supabase
    .from("candles")
    .select("ts, close")
    .eq("symbol", replay.symbol as string)
    .eq("timeframe", replay.timeframe as string)
    .lte("ts", replay.cursor_ts as string)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!cursorCandle) {
    return { error: "There is no candle at the cursor.", fieldErrors: {} }
  }

  const currentPrice = Number(cursorCandle.close)

  const levelErrors = validateOrderLevels({
    direction,
    orderType,
    requestedPrice,
    currentPrice,
    stopPrice,
    takeProfit,
  })
  if (Object.keys(levelErrors).length > 0) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: levelErrors,
    }
  }

  // Size is derived from the RESTING price, because that is where the position
  // would open and therefore what the stop distance is measured from.
  const { balance, riskPercent } = await sessionRisk(
    supabase,
    replay.session_id as string,
  )

  const quantity = computePositionSize({
    direction,
    entryPrice: requestedPrice as number,
    stopPrice,
    balance,
    riskPercent,
  })

  if (quantity === null) {
    return {
      error:
        "Position size could not be calculated. Check the stop is on the losing side of the order price.",
      fieldErrors: {},
    }
  }

  const setup = normaliseSetup(String(formData.get("setup") ?? ""))
  if (setup === undefined) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { setup: "Setup is too long." },
    }
  }
  const marketSession = normaliseMarketSession(
    String(formData.get("marketSession") ?? ""),
  )
  if (marketSession === undefined) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { marketSession: "Market session is too long." },
    }
  }

  const expiryRaw = String(formData.get("expiryBars") ?? "").trim()
  const expiryBars =
    expiryRaw === "" || expiryRaw === "none" ? null : Number(expiryRaw)
  if (expiryBars !== null && (!Number.isFinite(expiryBars) || expiryBars <= 0)) {
    return {
      error: "Please correct the highlighted fields.",
      fieldErrors: { expiryBars: "Expiry must be a positive number of bars." },
    }
  }

  const strategyRaw = String(formData.get("strategyId") ?? "").trim()

  const { error } = await supabase.from("replay_orders").insert({
    user_id: user.id,
    replay_id: replayId,
    session_id: replay.session_id as string,
    strategy_id: strategyRaw && strategyRaw !== "none" ? strategyRaw : null,
    symbol: replay.symbol as string,
    timeframe: replay.timeframe as string,
    direction,
    order_type: orderType,
    status: "pending",
    requested_price: requestedPrice,
    stop_price: stopPrice,
    take_profit: takeProfit,
    quantity,
    expiry_bars: expiryBars,
    setup,
    market_session: marketSession,
    tags: normaliseTags(String(formData.get("tags") ?? "")),
    notes: String(formData.get("notes") ?? "").trim().slice(0, MAX_NOTES_LENGTH),
  })

  if (error) {
    // 23505 = unique_violation from the one-pending-order index.
    if (error.code === "23505") {
      return { error: ORDER_ALREADY_PENDING, fieldErrors: {} }
    }
    return { error: error.message, fieldErrors: {} }
  }

  revalidatePath(`/replay/${replayId}`)
  return { error: null, fieldErrors: {} }
}

/**
 * Cancels a pending order.
 *
 * Ownership comes from RLS, and the status filter makes the update a no-op on
 * an order that already filled or was cancelled — so a replayed request cannot
 * cancel something twice or resurrect a filled order.
 */
export async function cancelReplayOrder(formData: FormData): Promise<void> {
  const supabase = await createClient()
  if (!supabase) return

  const id = String(formData.get("id") ?? "").trim()
  const replayId = String(formData.get("replayId") ?? "").trim()
  if (!id) return

  await supabase
    .from("replay_orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")

  if (replayId) revalidatePath(`/replay/${replayId}`)
}

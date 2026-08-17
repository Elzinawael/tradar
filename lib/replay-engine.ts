/**
 * Replay exit engine.
 *
 * Decides whether a candle closes an open position, from OHLC alone. Pure and
 * dependency-free so the rules can be unit tested and so the server is the
 * only place they run — the browser never decides an exit.
 *
 * ── SAME-CANDLE POLICY ────────────────────────────────────────────────────
 * When a single candle touches BOTH the stop and the target, OHLC does not say
 * which happened first: a bar records only open, high, low and close, not the
 * path between them. Rather than invent an ordering, TRADAR applies an
 * explicit, deterministic, conservative rule:
 *
 *     If both levels are touched in the same candle, the STOP is taken.
 *
 * This is risk-first. It cannot flatter a backtest: an ambiguous bar always
 * resolves to the losing outcome, so results are a floor rather than an
 * optimistic guess. Resolving it properly would need intra-bar data at a lower
 * timeframe, which TRADAR does not assume you have.
 *
 * ── GAPS ──────────────────────────────────────────────────────────────────
 * If a candle OPENS beyond a level, the fill happens at the open, not at the
 * level — that is where the market actually traded first. A long gapping below
 * its stop therefore loses more than one risk unit, which is what happens in
 * reality. Gap-through-stop is checked before gap-through-target, consistent
 * with the conservative rule above.
 */

import { computeRMultiple, computeTradePnl } from "./trade-math"
import type { TradeDirection } from "./types"
import type { Candle } from "./candles"

export type ExitReason = "stop" | "target"

export interface ExitDecision {
  reason: ExitReason
  /** The price the position is filled at. */
  exitPrice: number
  /** True when the bar opened beyond the level and filled at the open. */
  gapped: boolean
}

export interface OpenPosition {
  direction: TradeDirection
  stopPrice: number | null
  takeProfit: number | null
}

/**
 * Evaluates one candle against an open position.
 *
 * Returns null when neither level is reached, in which case the position stays
 * open and the next candle is evaluated.
 */
export function evaluateExit(
  position: OpenPosition,
  candle: Candle,
): ExitDecision | null {
  const { direction, stopPrice, takeProfit } = position
  const { open, high, low } = candle

  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low)) {
    return null
  }

  if (direction === "long") {
    // Gap through the stop: filled at the open, which is worse than the stop.
    if (stopPrice !== null && open <= stopPrice) {
      return { reason: "stop", exitPrice: open, gapped: true }
    }
    // Gap through the target: filled at the open, which is better than target.
    if (takeProfit !== null && open >= takeProfit) {
      return { reason: "target", exitPrice: open, gapped: true }
    }

    const stopHit = stopPrice !== null && low <= stopPrice
    const targetHit = takeProfit !== null && high >= takeProfit

    // Ambiguous bar: conservative policy takes the stop.
    if (stopHit) return { reason: "stop", exitPrice: stopPrice, gapped: false }
    if (targetHit) {
      return { reason: "target", exitPrice: takeProfit, gapped: false }
    }
    return null
  }

  // short
  if (stopPrice !== null && open >= stopPrice) {
    return { reason: "stop", exitPrice: open, gapped: true }
  }
  if (takeProfit !== null && open <= takeProfit) {
    return { reason: "target", exitPrice: open, gapped: true }
  }

  const stopHit = stopPrice !== null && high >= stopPrice
  const targetHit = takeProfit !== null && low <= takeProfit

  if (stopHit) return { reason: "stop", exitPrice: stopPrice, gapped: false }
  if (targetHit) {
    return { reason: "target", exitPrice: takeProfit, gapped: false }
  }
  return null
}

/**
 * Walks newly revealed candles in chronological order and returns the first
 * exit, together with the candle it occurred on.
 *
 * `candles` must contain ONLY bars at or before the replay cursor. The caller
 * is responsible for that bound — this function deliberately does not filter,
 * so there is exactly one place in the system that decides what is visible.
 */
export function findExit(
  position: OpenPosition,
  candles: Candle[],
): { decision: ExitDecision; candle: Candle } | null {
  for (const candle of candles) {
    const decision = evaluateExit(position, candle)
    if (decision) return { decision, candle }
  }
  return null
}

/**
 * Validates the levels of a proposed position.
 *
 * A stop must sit on the losing side of entry and a target on the winning
 * side; otherwise the order means the opposite of what the trader intends and
 * position sizing would be nonsense.
 */
export function validateLevels(params: {
  direction: TradeDirection
  entryPrice: number
  stopPrice: number | null
  takeProfit: number | null
}): Record<string, string> {
  const { direction, entryPrice, stopPrice, takeProfit } = params
  const errors: Record<string, string> = {}

  if (stopPrice === null) {
    errors.stopPrice = "A stop loss is required to size the position."
  } else if (direction === "long" && stopPrice >= entryPrice) {
    errors.stopPrice = "For a long, the stop must be below the entry price."
  } else if (direction === "short" && stopPrice <= entryPrice) {
    errors.stopPrice = "For a short, the stop must be above the entry price."
  }

  if (takeProfit !== null) {
    if (direction === "long" && takeProfit <= entryPrice) {
      errors.takeProfit = "For a long, the target must be above the entry price."
    } else if (direction === "short" && takeProfit >= entryPrice) {
      errors.takeProfit = "For a short, the target must be below the entry price."
    }
  }

  return errors
}

/**
 * Mark-to-market state of an open position.
 *
 * Deliberately delegates to the same helpers a closed trade uses: the
 * unrealized figure is simply what the P&L would be if the position closed at
 * the current price. There is no second formula to drift out of step.
 */
export interface UnrealizedState {
  /** P&L if closed at the current price. */
  pnl: number
  /** Cash at risk when the position was opened: |entry - stop| x quantity. */
  riskAmount: number | null
  /** Unrealized P&L expressed in units of the ORIGINAL risk. */
  rMultiple: number | null
}

/**
 * Values an open position at a price.
 *
 * `riskAmount` is computed from the entry and stop recorded when the position
 * was opened, never from current equity — R must stay comparable across a
 * session even as the balance moves, otherwise the same trade would report a
 * different R depending on when you looked at it.
 */
export function computeUnrealized(params: {
  direction: TradeDirection
  entryPrice: number
  stopPrice: number | null
  quantity: number
  currentPrice: number
  fees?: number
}): UnrealizedState {
  const { direction, entryPrice, stopPrice, quantity, currentPrice, fees = 0 } =
    params

  // Same helper as a realised close, with the current price as the exit.
  const pnl =
    computeTradePnl({
      direction,
      entryPrice,
      exitPrice: currentPrice,
      quantity,
      fees,
    }) ?? 0

  const riskPerUnit =
    stopPrice === null
      ? null
      : direction === "long"
        ? entryPrice - stopPrice
        : stopPrice - entryPrice

  const riskAmount =
    riskPerUnit !== null && riskPerUnit > 0
      ? Math.round(riskPerUnit * quantity * 100) / 100
      : null

  return {
    pnl,
    riskAmount,
    rMultiple: computeRMultiple({
      direction,
      entryPrice,
      stopPrice,
      quantity,
      pnl,
    }),
  }
}

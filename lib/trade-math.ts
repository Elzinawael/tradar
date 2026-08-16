/**
 * Trade-level calculations.
 *
 * Pure helpers that derive realised values from the raw inputs a trader
 * enters. Kept separate from lib/analytics.ts, which aggregates across many
 * trades, so single-trade maths can be unit tested and reused by the future
 * CSV importer and backtesting engine.
 */

import type { TradeDirection, TradeStatus } from "./types"

/**
 * Rounds a monetary amount to 2 decimal places.
 *
 * Binary floating point cannot represent most decimal fractions exactly, so
 * naive arithmetic produces artefacts: (1.11 - 1.10) * 10000 - 2.50 evaluates
 * to 97.50000000000009 rather than 97.50. The `pnl` column is numeric(18,2),
 * so Postgres stores 97.50 either way — rounding here means the value the UI
 * previews and the value the database keeps are identical, instead of
 * differing in the last digits.
 */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Gross P&L for a single closed position.
 *
 * Long:  (exit - entry) * quantity
 * Short: (entry - exit) * quantity
 *
 * Fees are subtracted when supplied. Returns null while the trade is still
 * open (no exit price), because unrealised P&L requires a live market price
 * that TRADAR does not yet ingest.
 */
export function computeTradePnl(params: {
  direction: TradeDirection
  entryPrice: number
  exitPrice: number | null
  quantity: number
  fees?: number
}): number | null {
  const { direction, entryPrice, exitPrice, quantity, fees = 0 } = params
  if (exitPrice === null || !Number.isFinite(exitPrice)) return null

  const delta =
    direction === "long" ? exitPrice - entryPrice : entryPrice - exitPrice

  return roundMoney(delta * quantity - fees)
}

/**
 * Classifies a trade from its realised P&L.
 * A trade without an exit price is still open regardless of P&L.
 */
export function deriveTradeStatus(
  pnl: number | null,
  exitPrice: number | null,
): TradeStatus {
  if (exitPrice === null || pnl === null) return "open"
  if (pnl > 0) return "win"
  if (pnl < 0) return "loss"
  return "breakeven"
}

/** Whole minutes held, or null when the trade is still open. */
export function computeDurationMinutes(
  openedAt: string,
  closedAt: string | null,
): number | null {
  if (!closedAt) return null
  const open = new Date(openedAt).getTime()
  const close = new Date(closedAt).getTime()
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null
  const minutes = Math.round((close - open) / 60000)
  return minutes >= 0 ? minutes : null
}

/**
 * R-multiple: realised P&L expressed in units of initial risk.
 *
 * Requires a stop price to define risk. Returns null when no stop was
 * recorded or the implied risk is zero, rather than dividing by zero.
 */
export function computeRMultiple(params: {
  direction: TradeDirection
  entryPrice: number
  stopPrice: number | null
  quantity: number
  pnl: number | null
}): number | null {
  const { direction, entryPrice, stopPrice, quantity, pnl } = params
  if (stopPrice === null || pnl === null) return null

  const riskPerUnit =
    direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice

  const risk = riskPerUnit * quantity
  if (!Number.isFinite(risk) || risk <= 0) return null

  // Rounded to 4 dp to match the numeric(10,4) r_multiple column. Without
  // this, a trade stopped out for exactly its risk returns -0.9999999999999991
  // rather than -1, so the displayed value disagreed with the stored one.
  return Math.round((pnl / risk + Number.EPSILON) * 1e4) / 1e4
}

/** Formats whole minutes as a compact human duration (e.g. "2h 15m"). */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—"
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`
}

/**
 * Risk-based position size.
 *
 * Answers: "if I am willing to lose `riskPercent` of `balance` on this trade,
 * and my stop is at `stopPrice`, how many units do I buy?"
 *
 *   riskAmount   = balance * riskPercent / 100
 *   riskPerUnit  = |entry - stop|
 *   quantity     = riskAmount / riskPerUnit
 *
 * Deterministic and side-effect free so replay, manual entry and any future
 * automation all size positions identically.
 *
 * Returns null rather than a misleading number when sizing is undefined:
 * no stop, a stop equal to entry (zero risk per unit, implying infinite size),
 * a non-positive balance, or a stop on the wrong side of entry — a long whose
 * stop sits above entry is not a stop, and sizing it would silently invert the
 * trader's intent.
 */
export function computePositionSize(params: {
  direction: TradeDirection
  entryPrice: number
  stopPrice: number | null
  balance: number
  riskPercent: number
}): number | null {
  const { direction, entryPrice, stopPrice, balance, riskPercent } = params

  if (stopPrice === null) return null
  if (!Number.isFinite(balance) || balance <= 0) return null
  if (!Number.isFinite(riskPercent) || riskPercent <= 0) return null
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return null

  // The stop must sit on the losing side of the entry.
  const riskPerUnit =
    direction === "long" ? entryPrice - stopPrice : stopPrice - entryPrice
  if (riskPerUnit <= 0) return null

  const riskAmount = (balance * riskPercent) / 100
  const quantity = riskAmount / riskPerUnit

  if (!Number.isFinite(quantity) || quantity <= 0) return null

  // 8 dp matches the numeric(18,8) quantity column.
  return Math.round(quantity * 1e8) / 1e8
}

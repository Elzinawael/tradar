/**
 * Entry / stop / target geometry for the Smart Trading Ticket.
 *
 * Pure and presentation-only: it measures the distances between prices the
 * user has entered and turns them into a reward-to-risk ratio and signed
 * percentages for display. It does NOT size positions, compute P&L or validate
 * the long/short relationship — `lib/trade-math.ts` and
 * `lib/replay-engine.ts` (`validateOrderLevels`) remain the source of truth
 * for those.
 */

import { normalizePrecision, roundToPrecision } from "./number-field.ts"

export interface PriceLevelGeometry {
  /** |entry − stop|, or null when either is missing. */
  riskDistance: number | null
  /** |target − entry|, or null when either is missing. */
  rewardDistance: number | null
  /** rewardDistance / riskDistance — the classic R:R. Null when undefined. */
  riskReward: number | null
  /** Signed % of the stop from entry (negative = below). */
  stopPercent: number | null
  /** Signed % of the target from entry. */
  targetPercent: number | null
}

export function priceLevelGeometry(params: {
  entry: number | null
  stop: number | null
  target: number | null
}): PriceLevelGeometry {
  const { entry, stop, target } = params

  const usableEntry =
    typeof entry === "number" && Number.isFinite(entry) && entry !== 0
      ? entry
      : null

  const riskDistance =
    usableEntry !== null && stop !== null && Number.isFinite(stop)
      ? Math.abs(usableEntry - stop)
      : null

  const rewardDistance =
    usableEntry !== null && target !== null && Number.isFinite(target)
      ? Math.abs(target - usableEntry)
      : null

  const riskReward =
    riskDistance !== null && riskDistance > 0 && rewardDistance !== null
      ? rewardDistance / riskDistance
      : null

  const stopPercent =
    usableEntry !== null && stop !== null && Number.isFinite(stop)
      ? ((stop - usableEntry) / usableEntry) * 100
      : null

  const targetPercent =
    usableEntry !== null && target !== null && Number.isFinite(target)
      ? ((target - usableEntry) / usableEntry) * 100
      : null

  return { riskDistance, rewardDistance, riskReward, stopPercent, targetPercent }
}

export type TradeDirection = "long" | "short"

/**
 * A deterministic default stop price when the user first enables one, a fixed
 * percentage of the entry on the losing side.
 *
 * FALLBACK ONLY: TRADAR has no ATR, tick-size or volatility model to size a
 * stop from, so this is a plain percentage — a starting point the user then
 * drags or types to their real level.
 */
export function suggestStop(
  entry: number,
  direction: TradeDirection,
  precision: number,
  distancePercent = 0.25,
): number {
  const p = normalizePrecision(precision)
  const factor = 1 - (direction === "long" ? 1 : -1) * (distancePercent / 100)
  return roundToPrecision(entry * factor, p)
}

/**
 * A deterministic default target price — twice the default stop distance, so
 * an enabled target starts at a 1:2 reward-to-risk. Same fallback caveat as
 * {@link suggestStop}.
 */
export function suggestTarget(
  entry: number,
  direction: TradeDirection,
  precision: number,
  distancePercent = 0.5,
): number {
  const p = normalizePrecision(precision)
  const factor = 1 + (direction === "long" ? 1 : -1) * (distancePercent / 100)
  return roundToPrecision(entry * factor, p)
}

/**
 * Reflects a price to the opposite side of `entry`, preserving its distance.
 * Used when the trade direction flips so a stop/target keeps the same risk
 * distance but moves to the correct side.
 */
export function mirrorAcross(
  entry: number,
  price: number,
  precision: number,
): number {
  return roundToPrecision(2 * entry - price, normalizePrecision(precision))
}

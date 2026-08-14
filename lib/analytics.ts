/**
 * TRADAR analytics engine.
 *
 * Pure, dependency-free functions that turn a list of trades into the
 * aggregate metrics described by `PerformanceSummary` in lib/types.ts.
 *
 * Keeping these pure (no I/O, no framework imports) means they can run on the
 * server, in a Server Action, or in a future worker, and can be unit tested
 * without a database.
 *
 * Conventions:
 *   * Only CLOSED trades (status !== "open") contribute to realised metrics.
 *   * `null` means "not computable yet" (e.g. win rate with no closed trades)
 *     rather than 0, so the UI can render an em dash instead of a misleading
 *     zero. This matches the existing dashboard behaviour.
 *   * Losses are stored as negative P&L; `grossLoss` is returned as a positive
 *     magnitude, which is the conventional profit-factor denominator.
 */

import type { DailyPnl, PerformanceSummary, Trade } from "./types"

/** A trade that has been resolved and therefore has realised P&L. */
export function isClosed(trade: Trade): boolean {
  return trade.status !== "open"
}

/** Local calendar date key (YYYY-MM-DD) for a timestamp. */
export function toDateKey(iso: string): string {
  const d = new Date(iso)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * The all-zero summary used when a user has no trades yet. Exported so the
 * data layer and tests share one definition.
 */
export const EMPTY_SUMMARY: PerformanceSummary = {
  netPnl: 0,
  grossProfit: 0,
  grossLoss: 0,
  accountBalance: 0,
  winRate: null,
  profitFactor: null,
  averageWin: 0,
  averageLoss: 0,
  averageTradePnl: 0,
  expectancy: null,
  largestProfit: 0,
  largestLoss: 0,
  maxDrawdown: 0,
  averageHoldMinutes: null,
  tradingDays: 0,
  winningDays: 0,
  losingDays: 0,
  breakevenDays: 0,
  consecutiveWins: 0,
  consecutiveLosses: 0,
  tradeCount: 0,
}

/**
 * Aggregates closed trades into daily P&L records, ordered oldest first.
 * Used by the equity curve and the P&L calendar.
 */
export function buildDailyPnl(trades: Trade[]): DailyPnl[] {
  const buckets = new Map<string, { pnl: number; trades: number }>()

  for (const trade of trades) {
    if (!isClosed(trade)) continue
    const key = toDateKey(trade.closedAt ?? trade.openedAt)
    const bucket = buckets.get(key) ?? { pnl: 0, trades: 0 }
    bucket.pnl += trade.pnl
    bucket.trades += 1
    buckets.set(key, bucket)
  }

  return Array.from(buckets.entries())
    .map(([date, { pnl, trades: count }]) => ({
      date,
      pnl: round2(pnl),
      trades: count,
      result:
        pnl > 0 ? ("win" as const) : pnl < 0 ? ("loss" as const) : ("breakeven" as const),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Maximum peak-to-trough decline of the cumulative equity curve, returned as a
 * positive magnitude. Seeded with the starting balance so the drawdown is
 * measured against real account equity rather than from zero.
 */
export function computeMaxDrawdown(
  daily: DailyPnl[],
  startingBalance = 0,
): number {
  let equity = startingBalance
  let peak = startingBalance
  let maxDrawdown = 0

  for (const day of daily) {
    equity += day.pnl
    if (equity > peak) peak = equity
    const drawdown = peak - equity
    if (drawdown > maxDrawdown) maxDrawdown = drawdown
  }

  return round2(maxDrawdown)
}

/** Longest run of consecutive winning and losing trades, in chronological order. */
export function computeStreaks(trades: Trade[]): {
  consecutiveWins: number
  consecutiveLosses: number
} {
  const ordered = trades
    .filter(isClosed)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.closedAt ?? a.openedAt).getTime() -
        new Date(b.closedAt ?? b.openedAt).getTime(),
    )

  let bestWins = 0
  let bestLosses = 0
  let runWins = 0
  let runLosses = 0

  for (const trade of ordered) {
    if (trade.pnl > 0) {
      runWins += 1
      runLosses = 0
      if (runWins > bestWins) bestWins = runWins
    } else if (trade.pnl < 0) {
      runLosses += 1
      runWins = 0
      if (runLosses > bestLosses) bestLosses = runLosses
    } else {
      // Breakeven trades interrupt both streaks without counting toward either.
      runWins = 0
      runLosses = 0
    }
  }

  return { consecutiveWins: bestWins, consecutiveLosses: bestLosses }
}

/**
 * Computes the full performance summary for a set of trades.
 *
 * @param trades           all trades (open ones are ignored for realised metrics)
 * @param startingBalance  the account's opening balance
 */
export function computePerformanceSummary(
  trades: Trade[],
  startingBalance = 0,
): PerformanceSummary {
  const closed = trades.filter(isClosed)

  if (closed.length === 0) {
    return { ...EMPTY_SUMMARY, accountBalance: round2(startingBalance) }
  }

  const wins = closed.filter((t) => t.pnl > 0)
  const losses = closed.filter((t) => t.pnl < 0)

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0)
  // Negative values; converted to a positive magnitude below.
  const grossLossRaw = losses.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(grossLossRaw)
  const netPnl = grossProfit + grossLossRaw

  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0
  // Kept negative so the UI can render it with its natural sign.
  const averageLoss = losses.length > 0 ? grossLossRaw / losses.length : 0

  const winRate = (wins.length / closed.length) * 100

  // Undefined when there are no losses: dividing by zero would imply infinity.
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null

  const winProbability = wins.length / closed.length
  const lossProbability = losses.length / closed.length
  const expectancy =
    winProbability * averageWin + lossProbability * Math.abs(averageLoss) * -1

  const pnls = closed.map((t) => t.pnl)
  const largestProfit = Math.max(0, ...pnls)
  const largestLoss = Math.min(0, ...pnls)

  const holdTimes = closed
    .map((t) => t.durationMinutes)
    .filter((d): d is number => typeof d === "number" && Number.isFinite(d))
  const averageHoldMinutes =
    holdTimes.length > 0
      ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length
      : null

  const daily = buildDailyPnl(closed)
  const winningDays = daily.filter((d) => d.result === "win").length
  const losingDays = daily.filter((d) => d.result === "loss").length
  const breakevenDays = daily.filter((d) => d.result === "breakeven").length

  const { consecutiveWins, consecutiveLosses } = computeStreaks(closed)

  return {
    netPnl: round2(netPnl),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    accountBalance: round2(startingBalance + netPnl),
    winRate: round2(winRate),
    profitFactor: profitFactor === null ? null : round2(profitFactor),
    averageWin: round2(averageWin),
    averageLoss: round2(averageLoss),
    averageTradePnl: round2(netPnl / closed.length),
    expectancy: round2(expectancy),
    largestProfit: round2(largestProfit),
    largestLoss: round2(largestLoss),
    maxDrawdown: computeMaxDrawdown(daily, startingBalance),
    averageHoldMinutes:
      averageHoldMinutes === null ? null : Math.round(averageHoldMinutes),
    tradingDays: daily.length,
    winningDays,
    losingDays,
    breakevenDays,
    consecutiveWins,
    consecutiveLosses,
    tradeCount: closed.length,
  }
}

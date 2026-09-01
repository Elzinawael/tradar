/**
 * Replay candle windowing.
 *
 * A replay never looks into the future (the look-ahead guard) and only ever
 * needs bars from some point of history up to the cursor. Loading the entire
 * requested range to the client breaks for large M1 datasets (a 90-day M1
 * range is ~130k bars). Instead the client holds a bounded window that ends at
 * the cursor and slides forward as the replay advances.
 *
 * Pure — the actual read happens in a server action / data function.
 */

import { TIMEFRAME_MINUTES, type Timeframe } from "../candles.ts"

/** History kept behind the cursor, in bars. ~5000 is generous for review. */
export const REPLAY_WINDOW_LOOKBACK_BARS = 5000

/** Hard ceiling on bars held client-side, regardless of timeframe or range. */
export const REPLAY_WINDOW_MAX_BARS = 9000

/**
 * The earliest timestamp the client window needs, given the cursor. Never
 * earlier than the replay's own range start.
 */
export function replayWindowStart(
  cursorTs: string,
  rangeStart: string,
  timeframe: Timeframe,
  lookbackBars: number = REPLAY_WINDOW_LOOKBACK_BARS,
): string {
  const cursorMs = new Date(cursorTs).getTime()
  const rangeStartMs = new Date(rangeStart).getTime()
  if (!Number.isFinite(cursorMs) || !Number.isFinite(rangeStartMs)) {
    return rangeStart
  }
  const barMs = (TIMEFRAME_MINUTES[timeframe] ?? 60) * 60_000
  const windowStartMs = Math.max(rangeStartMs, cursorMs - lookbackBars * barMs)
  return new Date(windowStartMs).toISOString()
}

/**
 * Merges a base window with bars revealed since, keeping the result sorted,
 * de-duplicated by timestamp and capped at {@link REPLAY_WINDOW_MAX_BARS}
 * (dropping the OLDEST when over the cap — the chart shows recent history).
 */
export function mergeWindow<T extends { ts: string }>(
  base: readonly T[],
  revealed: readonly T[],
  maxBars: number = REPLAY_WINDOW_MAX_BARS,
): T[] {
  if (revealed.length === 0 && base.length <= maxBars) return [...base]

  const byTs = new Map<string, T>()
  for (const bar of base) byTs.set(bar.ts, bar)
  for (const bar of revealed) byTs.set(bar.ts, bar)

  const merged = [...byTs.values()].sort(
    (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
  )
  return merged.length > maxBars ? merged.slice(merged.length - maxBars) : merged
}

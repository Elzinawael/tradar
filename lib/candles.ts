/**
 * Candle helpers.
 *
 * Pure functions for timeframe handling and OHLC aggregation, kept free of
 * I/O so they can be unit tested and reused by the importer, the backfill
 * tool and the replay engine.
 */

export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1"

export const TIMEFRAMES: Timeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"]

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  H1: 60,
  H4: 240,
  D1: 1440,
}

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  M1: "1 minute",
  M5: "5 minutes",
  M15: "15 minutes",
  H1: "1 hour",
  H4: "4 hours",
  D1: "1 day",
}

export function isTimeframe(value: string | undefined): value is Timeframe {
  return value !== undefined && (TIMEFRAMES as string[]).includes(value)
}

export interface Candle {
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/**
 * Aggregates lower-timeframe candles into higher-timeframe buckets.
 *
 * Bucket boundaries are anchored to the Unix epoch in UTC, so a given
 * timestamp always lands in the same bucket regardless of the viewer's
 * timezone — two users replaying the same range must see identical bars.
 *
 * Per bucket: open of the first candle, max high, min low, close of the last,
 * summed volume. Input need not be sorted. Empty buckets are omitted rather
 * than emitted as flat bars, because a gap in the market is not a bar.
 */
export function aggregateCandles(
  candles: Candle[],
  targetMinutes: number,
): Candle[] {
  if (targetMinutes <= 0 || candles.length === 0) return []

  const bucketMs = targetMinutes * 60_000
  const buckets = new Map<number, Candle[]>()

  for (const candle of candles) {
    const time = new Date(candle.ts).getTime()
    if (!Number.isFinite(time)) continue
    const key = Math.floor(time / bucketMs) * bucketMs
    const bucket = buckets.get(key)
    if (bucket) bucket.push(candle)
    else buckets.set(key, [candle])
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => {
      const ordered = group
        .slice()
        .sort(
          (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
        )
      const volumes = ordered
        .map((c) => c.volume)
        .filter((v): v is number => typeof v === "number")

      return {
        ts: new Date(key).toISOString(),
        open: ordered[0].open,
        high: Math.max(...ordered.map((c) => c.high)),
        low: Math.min(...ordered.map((c) => c.low)),
        close: ordered[ordered.length - 1].close,
        volume:
          volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) : null,
      }
    })
}

/**
 * Candles visible at a replay cursor.
 *
 * The single guard against look-ahead bias in the render path: only bars at or
 * before the cursor are ever returned, so a future bar cannot reach the chart
 * even if the client has prefetched it.
 */
export function visibleCandles(candles: Candle[], cursorTs: string): Candle[] {
  const cursor = new Date(cursorTs).getTime()
  if (!Number.isFinite(cursor)) return []
  return candles.filter((c) => new Date(c.ts).getTime() <= cursor)
}

/**
 * Advances a cursor by `steps` bars, clamped to the end of the range.
 *
 * The cursor can never move past the last available bar, so playback stops at
 * the end of the selected historical window instead of running into the
 * present.
 */
export function advanceCursor(
  candles: Candle[],
  cursorTs: string,
  steps: number,
): { cursorTs: string; atEnd: boolean; index: number } {
  if (candles.length === 0) {
    return { cursorTs, atEnd: true, index: -1 }
  }

  const cursor = new Date(cursorTs).getTime()
  let index = candles.findIndex((c) => new Date(c.ts).getTime() >= cursor)
  if (index === -1) index = candles.length - 1

  const next = Math.min(index + Math.max(0, Math.floor(steps)), candles.length - 1)

  return {
    cursorTs: candles[next].ts,
    atEnd: next >= candles.length - 1,
    index: next,
  }
}

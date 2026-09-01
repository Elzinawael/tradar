/**
 * Market data source abstraction.
 *
 * TRADAR has one canonical candle model (`Candle` from lib/candles). This file
 * defines the three ways that model is produced and consumed, so that Replay,
 * Backtesting, the live view and any chart library all sit on the same seam:
 *
 *        provider adapters + cache + normalization
 *                          │
 *                    canonical Candle
 *          ┌───────────────┼────────────────┐
 *   HistoricalDataSource   ReplayDataSource  RealtimeDataSource
 *          │               │ (simulated clock)      │ (wall clock)
 *          ▼               ▼                        ▼
 *     one-shot range   deterministic replay     live subscription
 *
 * LIVE MODE and REPLAY MODE never share a source: a `ReplayDataSource` reads
 * only from a fixed historical snapshot and a cursor, a `RealtimeDataSource`
 * reads only from the wall-clock stream. Mixing them is what this abstraction
 * exists to prevent.
 *
 * This file contains no I/O. The historical/realtime implementations live in
 * the service and the live manager; the replay implementation is pure and
 * lives here because it is just arithmetic over an array.
 */

import {
  advanceCursor,
  visibleCandles,
  type Candle,
  type Timeframe,
} from "../candles.ts"
import { assessCoverage, type CoverageReport } from "../replay/dataset.ts"

export type { Candle }

export type MarketDataMode = "historical" | "replay" | "realtime"

export interface MarketDataSourceMeta {
  readonly mode: MarketDataMode
  readonly symbol: string
  readonly timeframe: Timeframe
  /** Decimal places for this instrument's prices (display only). */
  readonly pricePrecision: number
}

// ---------------------------------------------------------------------------
// Historical
// ---------------------------------------------------------------------------

/**
 * A one-shot historical range. The implementation (in the service) checks the
 * cache, fills only the missing sub-ranges from a provider, persists and
 * returns the complete local dataset. Callers never see a provider.
 */
export interface HistoricalDataSource extends MarketDataSourceMeta {
  mode: "historical"
  getBars(from: Date, to: Date): Promise<Candle[]>
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export type RealtimeStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "disconnected"
  | "unavailable"

/**
 * A wall-clock stream. Emits fully-formed bars (or ticks folded into the
 * current bar) as they occur. Used only in LIVE mode.
 */
export interface RealtimeDataSource extends MarketDataSourceMeta {
  mode: "realtime"
  subscribe(handlers: {
    onBar: (bar: Candle) => void
    onStatus: (status: RealtimeStatus) => void
  }): () => void
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayAdvance {
  cursorTs: string
  atEnd: boolean
  /** Bars revealed by this advance (after the old cursor, up to the new one). */
  revealed: Candle[]
}

/**
 * A deterministic replay over a FIXED historical snapshot and a cursor.
 *
 * The snapshot is immutable for the life of the source: the same bars in, the
 * same replay out, every time. `barAt` / `priceAt` are the simulated "current
 * price" — always a stored close, never a live quote.
 *
 * The server remains authoritative for the persisted cursor and for evaluating
 * exits (lib/actions/replay). This client-side source is for rendering the
 * chart and previewing the order ticket.
 */
export interface ReplayDataSource extends MarketDataSourceMeta {
  mode: "replay"
  readonly range: { start: string; end: string }
  /** Every bar in the range — a stable reference for the session. */
  allBars(): readonly Candle[]
  /** Bars at or before `cursorTs` (the look-ahead-safe visible set). */
  barsUpTo(cursorTs: string): Candle[]
  /** The bar the cursor sits on. */
  barAt(cursorTs: string): Candle | null
  /** Simulated current price = the cursor bar's close. */
  priceAt(cursorTs: string): number | null
  /** Coverage of the requested range by the snapshot. */
  coverage(): CoverageReport
  /** Deterministically advance a cursor by `bars`, clamped to the range end. */
  advance(cursorTs: string, bars: number): ReplayAdvance
}

/**
 * Builds a ReplayDataSource from a snapshot the caller already loaded (the
 * replay page reads the range once and passes it down). Pure — no network, no
 * database, no clock.
 */
export function createReplayDataSource(params: {
  symbol: string
  timeframe: Timeframe
  pricePrecision: number
  range: { start: string; end: string }
  candles: Candle[]
}): ReplayDataSource {
  const { symbol, timeframe, pricePrecision, range } = params

  const startMs = new Date(range.start).getTime()
  const endMs = new Date(range.end).getTime()

  // Snapshot: sorted, de-duplicated by timestamp, clamped to the range.
  const seen = new Set<string>()
  const bars: Candle[] = params.candles
    .filter((c) => {
      const t = new Date(c.ts).getTime()
      if (!Number.isFinite(t) || t < startMs || t > endMs) return false
      if (seen.has(c.ts)) return false
      seen.add(c.ts)
      return true
    })
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())

  let cachedCoverage: CoverageReport | null = null

  return {
    mode: "replay",
    symbol,
    timeframe,
    pricePrecision,
    range,

    allBars() {
      return bars
    },

    barsUpTo(cursorTs: string) {
      return visibleCandles(bars, cursorTs)
    },

    barAt(cursorTs: string) {
      const visible = visibleCandles(bars, cursorTs)
      return visible[visible.length - 1] ?? null
    },

    priceAt(cursorTs: string) {
      const bar = this.barAt(cursorTs)
      return bar ? bar.close : null
    },

    coverage() {
      if (!cachedCoverage) {
        cachedCoverage = assessCoverage(bars, range, timeframe)
      }
      return cachedCoverage
    },

    advance(cursorTs: string, count: number) {
      const before = new Date(cursorTs).getTime()
      const { cursorTs: next, atEnd } = advanceCursor(bars, cursorTs, count)
      const nextMs = new Date(next).getTime()
      const revealed = bars.filter((c) => {
        const t = new Date(c.ts).getTime()
        return t > before && t <= nextMs
      })
      return { cursorTs: next, atEnd, revealed }
    },
  }
}

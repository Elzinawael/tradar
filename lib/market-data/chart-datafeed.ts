/**
 * Chart datafeed seam.
 *
 * A chart library — lightweight-charts today, TradingView Advanced Charts once
 * access is granted — is a PRESENTATION layer. It asks this seam for bars and
 * for updates; it never owns TRADAR's trading state (cursor, entry, SL, TP,
 * quantity, risk, session). Those stay in TRADAR's own state and server
 * actions.
 *
 * `ChartDatafeed` is deliberately shaped so a thin adapter can satisfy
 * TradingView's `IBasicDataFeed` (onReady / resolveSymbol / getBars /
 * subscribeBars / unsubscribeBars) by delegating to it. TradingView Advanced
 * Charts provides NO market data of its own — the integrator supplies all
 * historical and realtime bars through exactly this kind of adapter — so our
 * market-data backend can sit underneath it unchanged.
 *
 * See docs: https://www.tradingview.com/charting-library-docs/latest/connecting_data/datafeed-api/
 */

import type { Candle, Timeframe } from "../candles.ts"
import type { ReplayDataSource } from "./sources.ts"

export interface ChartSymbolInfo {
  symbol: string
  timeframe: Timeframe
  pricePrecision: number
  /** Session — crypto is 24x7, most others follow their exchange calendar. */
  session: "24x7" | "exchange"
}

export interface ChartBar {
  /** Unix seconds (TradingView's `Bar.time` is ms; the adapter multiplies). */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface ChartDatafeed {
  symbolInfo(): ChartSymbolInfo
  /** Bars in [from, to] (unix seconds), ascending. */
  getBars(range: { from: number; to: number }): Promise<ChartBar[]>
  /**
   * Subscribe to new/updated bars. In REPLAY mode the "realtime" bar is the one
   * the replay cursor has just revealed; in LIVE mode it is the wall-clock
   * stream. Returns an unsubscribe function.
   */
  subscribe(onBar: (bar: ChartBar) => void): () => void
}

function toChartBar(candle: Candle): ChartBar {
  return {
    time: Math.floor(new Date(candle.ts).getTime() / 1000),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume ?? undefined,
  }
}

/**
 * A datafeed backed by a replay snapshot and a cursor.
 *
 * `getCursor` returns TRADAR's authoritative cursor; `onCursorChange` lets the
 * caller (the replay player) drive the "realtime" callback when it advances the
 * replay, so the chart's most recent bar tracks the simulated clock without the
 * chart owning the clock.
 */
export function createReplayChartDatafeed(params: {
  source: ReplayDataSource
  getCursor: () => string
  registerCursorListener: (fn: (cursorTs: string) => void) => () => void
}): ChartDatafeed {
  const { source, getCursor, registerCursorListener } = params

  return {
    symbolInfo() {
      return {
        symbol: source.symbol,
        timeframe: source.timeframe,
        pricePrecision: source.pricePrecision,
        session: source.symbol.length > 0 ? "exchange" : "exchange",
      }
    },

    async getBars(range) {
      const cursor = getCursor()
      // Never reveal a bar past the cursor — the replay's look-ahead guard.
      const visible = source.barsUpTo(cursor)
      return visible
        .filter((c) => {
          const t = Math.floor(new Date(c.ts).getTime() / 1000)
          return t >= range.from && t <= range.to
        })
        .map(toChartBar)
    },

    subscribe(onBar) {
      return registerCursorListener((cursorTs) => {
        const bar = source.barAt(cursorTs)
        if (bar) onBar(toChartBar(bar))
      })
    },
  }
}

/**
 * PLACEHOLDER for the TradingView Advanced Charts adapter.
 *
 * Once Advanced Charts access is granted (it requires an application to
 * TradingView; the library must NOT be vendored from unofficial sources), add
 * `createTradingViewDatafeed(feed: ChartDatafeed): IBasicDataFeed` here. It
 * implements:
 *
 *   onReady(cb)            -> cb({ supported_resolutions, ... })
 *   resolveSymbol(name, cb)-> cb(librarySymbolInfo from feed.symbolInfo())
 *   getBars(symInfo, res, periodParams, onHistory, onError)
 *                          -> feed.getBars({ from: periodParams.from,
 *                                            to: periodParams.to })
 *                             then onHistory(bars, { noData: bars.length === 0 })
 *   subscribeBars(symInfo, res, onTick, uid, onReset)
 *                          -> feed.subscribe(onTick)
 *   unsubscribeBars(uid)   -> call the returned unsubscribe
 *
 * Nothing else in TRADAR changes: the datafeed is the only integration point.
 */

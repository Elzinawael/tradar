/**
 * Binance adapter.
 *
 * Wraps Binance's public klines endpoint, which needs no API key and no
 * account. Crypto only.
 *
 * This is a refactor of the fetch logic that previously lived inline in
 * lib/actions/candles.ts — same endpoint, same 1000-bar page size, same
 * bounded paging, same sanity filtering. It moved so Replay can ask the
 * service for data without knowing Binance exists.
 */

import { TIMEFRAME_MINUTES } from "@/lib/candles"
import { isSaneCandle, type MarketDataProvider } from "../provider"
import type { Candle, HistoricalRequest, ProviderCapabilities } from "../types"

/** Binance returns at most 1000 bars per request. */
const PAGE_LIMIT = 1000
const MAX_CANDLES = 200_000

const INTERVALS: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
}

const capabilities: ProviderCapabilities = {
  key: "binance",
  label: "Binance",
  historical: true,
  // The public REST endpoint is polled, not streamed. Marked false rather than
  // implying a live feed Tradar does not consume.
  realtime: false,
  categories: ["crypto"],
  timeframes: ["M1", "M5", "M15", "H1", "H4", "D1"],
  // No credentials required, so this adapter is always usable.
  configured: true,
  licensing: {
    // Binance's public endpoint is freely accessible, but redistribution is
    // still an operator decision rather than something this code may assume.
    historical: true,
    realtime: false,
    delayed: false,
    internalOnly: true,
    externalDisplay: false,
  },
}

export const binanceProvider: MarketDataProvider = {
  capabilities,

  async getHistoricalCandles(request: HistoricalRequest): Promise<Candle[]> {
    const { listing, timeframe, from, to } = request

    const interval = INTERVALS[timeframe]
    if (!interval) return []

    const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
    const collected: Candle[] = []

    let cursor = from.getTime()
    const end = to.getTime()
    const maxPages = Math.ceil(MAX_CANDLES / PAGE_LIMIT) + 1

    for (let page = 0; page < maxPages && cursor < end; page += 1) {
      const url = new URL("https://api.binance.com/api/v3/klines")
      url.searchParams.set("symbol", listing.providerSymbol)
      url.searchParams.set("interval", interval)
      url.searchParams.set("startTime", String(cursor))
      url.searchParams.set("endTime", String(end))
      url.searchParams.set("limit", String(PAGE_LIMIT))

      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) {
        throw new Error(
          `Binance returned ${response.status} for ${listing.providerSymbol}`,
        )
      }

      const payload: unknown = await response.json()
      if (!Array.isArray(payload) || payload.length === 0) break

      for (const entry of payload as unknown[][]) {
        // [openTime, open, high, low, close, volume, closeTime, ...]
        const candle: Candle = {
          ts: new Date(Number(entry[0])).toISOString(),
          open: Number(entry[1]),
          high: Number(entry[2]),
          low: Number(entry[3]),
          close: Number(entry[4]),
          volume: Number(entry[5]),
        }
        if (isSaneCandle(candle)) collected.push(candle)
      }

      const last = (payload as unknown[][])[payload.length - 1]
      const lastOpen = Number(last[0])
      if (!Number.isFinite(lastOpen)) break
      // Advance past the last bar received so a page cannot repeat forever.
      cursor = lastOpen + barMs
    }

    return collected
  },
}

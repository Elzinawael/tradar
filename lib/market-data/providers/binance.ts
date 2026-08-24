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
import type { LiveDisconnectKind, LiveTick } from "../live/types"
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
  // Binance publishes a genuine public WebSocket stream that needs no API key
  // and no account, so this is real streaming — not polling relabelled. It is
  // the only adapter in Tradar that can currently claim realtime.
  realtime: true,
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


// ---------------------------------------------------------------------------
// Live streaming
// ---------------------------------------------------------------------------

/**
 * Binance's public combined stream. No credentials, no account.
 *
 * The trade stream is used rather than a kline stream: a trade is an actual
 * execution, which is what a live PRICE means. Kline events would also work
 * but carry a partially-formed candle, and mixing those into Tradar's
 * historical candles is precisely the corruption this layer must avoid.
 */
const STREAM_BASE = "wss://stream.binance.com:9443/ws"

/**
 * Subscribes to live trades for one symbol.
 *
 * Returns an unsubscribe function that closes the socket. Errors are reported
 * through `onError` rather than thrown, because a stream fails asynchronously
 * long after subscribe() returned.
 */
binanceProvider.subscribeLive = async function subscribeLive(
  providerSymbol: string,
  onTick: (tick: LiveTick) => void,
  onError?: (kind: LiveDisconnectKind, detail: string) => void,
): Promise<() => void> {
  const stream = `${STREAM_BASE}/${providerSymbol.toLowerCase()}@trade`
  const socket = new WebSocket(stream)

  socket.onmessage = (event: MessageEvent) => {
    try {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>
      // Trade event: { e:"trade", E:eventTime, s:symbol, p:price, q:quantity, T:tradeTime }
      const price = Number(payload.p)
      const tradeTime = Number(payload.T ?? payload.E)
      if (!Number.isFinite(price) || price <= 0) return
      if (!Number.isFinite(tradeTime)) return

      onTick({
        symbol: String(payload.s ?? providerSymbol).toUpperCase(),
        provider: "binance",
        ts: new Date(tradeTime).toISOString(),
        price,
        // A trade stream carries no book. Left null rather than fabricated.
        bid: null,
        ask: null,
        volume: Number.isFinite(Number(payload.q)) ? Number(payload.q) : null,
      })
    } catch {
      onError?.("provider_error", "Malformed stream message")
    }
  }

  socket.onerror = () => onError?.("network", "Stream connection error")

  socket.onclose = (event: CloseEvent) => {
    // 1000/1005 are ordinary closes — including our own unsubscribe — and must
    // not be reported as provider ill-health.
    const normal = event.code === 1000 || event.code === 1005
    onError?.(normal ? "normal" : "network", `Stream closed (${event.code})`)
  }

  return () => {
    try {
      socket.close(1000, "unsubscribed")
    } catch {
      // Already closing; nothing to do.
    }
  }
}

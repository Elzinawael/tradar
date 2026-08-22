/**
 * Massive adapter (futures).
 *
 * Massive is the 2026 rebrand of Polygon.io. Its futures product exposes
 * aggregates, contracts, products and schedules; this adapter uses only the
 * aggregates endpoint, keyed by contract ticker.
 *
 * ── WHY THIS IS CONTRACT-BASED ────────────────────────────────────────────
 * ES and NQ are not tradeable tickers. They are contract ROOTS. A real ticker
 * is root + month code + two-digit year — ESZ24 is the December 2024 E-mini
 * S&P contract — and each expires. Treating ES as a permanent spot symbol
 * would silently request something that does not exist, or worse, quietly
 * stitch together different contracts across a rollover and present the seam
 * as a real price move.
 *
 * So this adapter does NOT guess a contract. The contract ticker must be
 * configured on the instrument's listing (`provider_symbol`). If the listing
 * carries only a root, the adapter reports `unsupported_instrument` and the
 * customer is told data is unavailable — which is true — rather than being
 * shown a fabricated series.
 *
 * A rollover engine that stitches contracts into a continuous series is a
 * later phase. The month codes below exist so that work has a correct
 * foundation, not because anything here generates tickers.
 */

import { isSaneCandle, type MarketDataProvider } from "../provider"
import {
  ProviderError,
  type Candle,
  type HistoricalRequest,
  type ProviderCapabilities,
  type Timeframe,
} from "../types"

const BASE_URL = "https://api.polygon.io/futures/vX/aggs"

/**
 * CME month codes. Standard across the industry: F=Jan … Z=Dec.
 *
 * Exported for the future rollover work. Nothing in this adapter builds a
 * ticker from them — a contract is always taken from configuration.
 */
export const FUTURES_MONTH_CODES: Record<number, string> = {
  1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
  7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z",
}

/** Tradar timeframe -> Massive aggregate resolution. */
const RESOLUTIONS: Partial<Record<Timeframe, string>> = {
  M1: "1minute",
  M5: "5minute",
  M15: "15minute",
  H1: "1hour",
  D1: "1day",
}

/**
 * A configured contract ticker looks like ESZ24: at least one root letter, a
 * month code, and a two-digit year. A bare root such as "ES" does not match,
 * which is exactly the case this adapter must refuse.
 */
const CONTRACT_TICKER = /^[A-Z]{1,3}[FGHJKMNQUVXZ]\d{2}$/

export function isContractTicker(symbol: string): boolean {
  return CONTRACT_TICKER.test(symbol.trim().toUpperCase())
}

function apiKey(): string {
  return process.env.MASSIVE_API_KEY ?? ""
}

function toCandle(row: Record<string, unknown>): Candle | null {
  // Aggregate rows use short keys: t (ms epoch), o/h/l/c, v.
  const time = Number(row.t ?? row.window_start)
  if (!Number.isFinite(time)) return null

  const parsed = new Date(time)
  if (!Number.isFinite(parsed.getTime())) return null

  const volume = Number(row.v ?? row.volume)

  return {
    ts: parsed.toISOString(),
    open: Number(row.o ?? row.open),
    high: Number(row.h ?? row.high),
    low: Number(row.l ?? row.low),
    close: Number(row.c ?? row.close),
    volume: Number.isFinite(volume) ? volume : null,
  }
}

const capabilities: ProviderCapabilities = {
  key: "massive",
  label: "Massive",
  historical: true,
  realtime: false,
  categories: ["futures"],
  timeframes: ["M1", "M5", "M15", "H1", "D1"],
  get configured() {
    return apiKey().length > 0
  },
  licensing: {
    historical: true,
    realtime: false,
    delayed: false,
    // CME data. Redistribution requires an exchange agreement and a Business
    // contract with the vendor, so both stay false until an operator says
    // otherwise. A successful API call is not a licence.
    internalOnly: true,
    externalDisplay: false,
  },
  contractBased: true,
}

export const massiveProvider: MarketDataProvider = {
  capabilities,

  async getHistoricalCandles(request: HistoricalRequest): Promise<Candle[]> {
    const { listing, timeframe, from, to } = request

    const key = apiKey()
    if (!key) {
      throw new ProviderError(
        "provider_not_configured",
        "MASSIVE_API_KEY is not set",
      )
    }

    const resolution = RESOLUTIONS[timeframe]
    if (!resolution) {
      throw new ProviderError(
        "unsupported_timeframe",
        `Massive adapter does not map timeframe ${timeframe}`,
      )
    }

    const ticker = listing.providerSymbol.trim().toUpperCase()

    // The core contract guard. A root alone is not a series.
    if (!isContractTicker(ticker)) {
      throw new ProviderError(
        "unsupported_instrument",
        `"${ticker}" is a futures root, not a contract ticker. Configure a specific contract (e.g. ESZ24) on the instrument listing; contract rollover is not implemented.`,
      )
    }

    const url = new URL(`${BASE_URL}/${encodeURIComponent(ticker)}`)
    url.searchParams.set("resolution", resolution)
    url.searchParams.set("window_start.gte", from.toISOString())
    url.searchParams.set("window_start.lte", to.toISOString())
    url.searchParams.set("limit", "50000")
    url.searchParams.set("sort", "window_start.asc")
    url.searchParams.set("apiKey", key)

    let response: Response
    try {
      response = await fetch(url, { cache: "no-store" })
    } catch {
      throw new ProviderError("network_error", "Massive unreachable")
    }

    if (response.status === 429) {
      throw new ProviderError("rate_limited", "Massive rate limit reached")
    }
    if (response.status === 401 || response.status === 403) {
      // 403 commonly means the plan does not include the futures asset class,
      // which is a licensing/entitlement problem rather than a bad key.
      throw new ProviderError(
        "license_not_configured",
        `Massive rejected the request (${response.status}) — the API key may not include futures`,
      )
    }
    if (response.status === 404) {
      throw new ProviderError(
        "unsupported_instrument",
        `Massive has no aggregates for contract ${ticker}`,
      )
    }
    if (!response.ok) {
      throw new ProviderError(
        "provider_unavailable",
        `Massive returned ${response.status}`,
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ProviderError(
        "invalid_provider_response",
        "Massive returned a non-JSON body",
      )
    }

    if (typeof payload !== "object" || payload === null) {
      throw new ProviderError(
        "invalid_provider_response",
        "Massive returned an unexpected body",
      )
    }

    const body = payload as Record<string, unknown>
    const results = body.results
    if (!Array.isArray(results)) {
      // No results key at all is malformed; an empty array is a valid "no data
      // in this window" answer and is handled by the caller.
      if (results === undefined) return []
      throw new ProviderError(
        "invalid_provider_response",
        "Massive returned a non-array results field",
      )
    }

    return results
      .map((row) => toCandle(row as Record<string, unknown>))
      .filter((c): c is Candle => c !== null && isSaneCandle(c))
  },
}

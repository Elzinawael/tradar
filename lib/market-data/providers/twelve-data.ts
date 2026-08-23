/**
 * Twelve Data adapter.
 *
 * Covers forex, spot metals and US equities via the documented `/time_series`
 * endpoint:
 *
 *   GET https://api.twelvedata.com/time_series
 *       ?symbol=EUR/USD&interval=1h&start_date=…&end_date=…&apikey=…
 *
 * A success looks like `{ status: "ok", values: [{ datetime, open, high, low,
 * close, volume }] }`; a failure looks like `{ status: "error", code, message }`
 * and can arrive with HTTP 200, so the body is checked rather than the status
 * line alone.
 *
 * The API key is read from TWELVEDATA_API_KEY on the server only. It is never
 * a NEXT_PUBLIC_ variable, so it cannot reach the client bundle.
 */

import { TIMEFRAME_MINUTES } from "@/lib/candles"
import { isSaneCandle, type MarketDataProvider } from "../provider"
import {
  ProviderError,
  type Candle,
  type HistoricalRequest,
  type ProviderCapabilities,
  type Timeframe,
} from "../types"

const BASE_URL = "https://api.twelvedata.com/time_series"

/** Documented ceiling for a single time_series request. */
const MAX_OUTPUTSIZE = 5000

/**
 * Tradar timeframe -> Twelve Data interval.
 *
 * H4 is intentionally absent: Twelve Data exposes `4h` only on some plans and
 * instruments, and claiming it here would produce an empty response the
 * customer could not explain. It can be added once an operator confirms it.
 */
const INTERVALS: Partial<Record<Timeframe, string>> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  H1: "1h",
  D1: "1day",
}

function apiKey(): string {
  return process.env.TWELVEDATA_API_KEY ?? ""
}

/** `yyyy-MM-dd HH:mm:ss`, the format the endpoint documents. */
function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  )
}

/**
 * Parses one row into a canonical candle.
 *
 * Every numeric field arrives as a string, so each is converted explicitly.
 * Volume is optional — forex rows frequently omit it, and a missing volume is
 * not a malformed bar.
 */
function toCandle(row: Record<string, unknown>): Candle | null {
  const datetime = typeof row.datetime === "string" ? row.datetime : ""
  if (!datetime) return null

  // Intraday rows come back without a zone; they are UTC per the docs, so the
  // space is normalised to ISO and Z appended rather than letting the runtime
  // guess a local zone.
  const iso = datetime.includes("T")
    ? datetime
    : `${datetime.replace(" ", "T")}${datetime.length <= 10 ? "T00:00:00Z" : "Z"}`

  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) return null

  const volumeRaw = row.volume
  const volume =
    volumeRaw === undefined || volumeRaw === null || volumeRaw === ""
      ? null
      : Number(volumeRaw)

  return {
    ts: parsed.toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: volume !== null && Number.isFinite(volume) ? volume : null,
  }
}

const capabilities: ProviderCapabilities = {
  key: "twelvedata",
  label: "Twelve Data",
  historical: true,
  // A websocket product exists, but Tradar does not consume it, so claiming
  // realtime here would misrepresent what this adapter can actually do.
  realtime: false,
  categories: ["forex", "commodities", "stocks"],
  timeframes: ["M1", "M5", "M15", "H1", "D1"],
  get configured() {
    return apiKey().length > 0
  },
  licensing: {
    historical: true,
    realtime: false,
    // Free and lower tiers serve delayed data. Assumed delayed unless an
    // operator establishes otherwise, because the optimistic assumption is the
    // one that causes harm.
    delayed: true,
    internalOnly: true,
    externalDisplay: false,
  },
}

export const twelveDataProvider: MarketDataProvider = {
  capabilities,

  async getHistoricalCandles(request: HistoricalRequest): Promise<Candle[]> {
    const { listing, timeframe, from, to } = request

    const key = apiKey()
    if (!key) {
      throw new ProviderError(
        "provider_not_configured",
        "TWELVEDATA_API_KEY is not set",
      )
    }

    const interval = INTERVALS[timeframe]
    if (!interval) {
      throw new ProviderError(
        "unsupported_timeframe",
        `Twelve Data adapter does not map timeframe ${timeframe}`,
      )
    }

    // A single request is capped, so a wide range is walked in pages, each
    // starting after the newest bar the previous page returned.
    const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
    const collected: Candle[] = []
    let cursor = from.getTime()
    const end = to.getTime()
    const maxPages = 40

    for (let page = 0; page < maxPages && cursor < end; page += 1) {
      const url = new URL(BASE_URL)
      url.searchParams.set("symbol", listing.providerSymbol)
      url.searchParams.set("interval", interval)
      url.searchParams.set("start_date", formatDate(new Date(cursor)))
      url.searchParams.set("end_date", formatDate(new Date(end)))
      url.searchParams.set("outputsize", String(MAX_OUTPUTSIZE))
      url.searchParams.set("order", "asc")
      url.searchParams.set("format", "JSON")
      url.searchParams.set("apikey", key)

      let response: Response
      try {
        response = await fetch(url, { cache: "no-store" })
      } catch {
        throw new ProviderError("network_error", "Twelve Data unreachable")
      }

      if (response.status === 429) {
        throw new ProviderError("rate_limited", "Twelve Data rate limit reached")
      }
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          "provider_not_configured",
          `Twelve Data rejected the API key (${response.status})`,
        )
      }
      if (!response.ok) {
        throw new ProviderError(
          "provider_unavailable",
          `Twelve Data returned ${response.status}`,
        )
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw new ProviderError(
          "invalid_provider_response",
          "Twelve Data returned a non-JSON body",
        )
      }

      if (typeof payload !== "object" || payload === null) {
        throw new ProviderError(
          "invalid_provider_response",
          "Twelve Data returned an unexpected body",
        )
      }

      const body = payload as Record<string, unknown>

      // Errors arrive with HTTP 200 and status:"error", so the body decides.
      if (body.status === "error") {
        const code = Number(body.code)
        const detail = String(body.message ?? "unknown error")
        if (code === 429) {
          throw new ProviderError("rate_limited", detail)
        }
        if (code === 401 || code === 403) {
          throw new ProviderError("provider_not_configured", detail)
        }
        if (code === 404 || /symbol/i.test(detail)) {
          throw new ProviderError("unsupported_instrument", detail)
        }
        throw new ProviderError("provider_unavailable", detail)
      }

      const values = body.values
      // A non-array `values` is a malformed response and must surface as an
      // error. Treating it like an empty range would silently store nothing
      // over a range the caller believes was fetched, and the gap would only
      // be noticed much later as missing history.
      if (values !== undefined && values !== null && !Array.isArray(values)) {
        throw new ProviderError(
          "invalid_provider_response",
          "Twelve Data returned a malformed values field",
        )
      }
      // An empty range IS a legitimate answer — a weekend, a holiday, or a
      // period before the instrument listed.
      if (!Array.isArray(values) || values.length === 0) break

      const page_candles = values
        .map((row) => toCandle(row as Record<string, unknown>))
        .filter((c): c is Candle => c !== null && isSaneCandle(c))

      if (page_candles.length === 0) break
      collected.push(...page_candles)

      const newest = page_candles[page_candles.length - 1]
      const newestTime = new Date(newest.ts).getTime()
      // Guard against a provider that ignores the cursor: without this a page
      // returning the same bars would loop until maxPages.
      if (newestTime + barMs <= cursor) break
      cursor = newestTime + barMs

      // A short page means the range is exhausted.
      if (values.length < MAX_OUTPUTSIZE) break
    }

    // Twelve Data returns newest-first. Everything downstream — the replay
    // reveal, the equity curve, the chart — assumes ascending time, so the
    // adapter normalises the order rather than leaving each consumer to
    // remember. Sorting here also makes paging order irrelevant.
    collected.sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    )

    return collected
  },

  async getLatestPrice(providerSymbol: string): Promise<number | null> {
    const key = apiKey()
    if (!key) return null

    const url = new URL("https://api.twelvedata.com/price")
    url.searchParams.set("symbol", providerSymbol)
    url.searchParams.set("apikey", key)

    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) return null
      const body = (await response.json()) as Record<string, unknown>
      const price = Number(body.price)
      return Number.isFinite(price) ? price : null
    } catch {
      return null
    }
  },
}

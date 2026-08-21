/**
 * The Market Data Engine.
 *
 * Server-only module. Deliberately NOT marked "use server": that would publish
 * every export as a callable RPC endpoint, and nothing here needs to be
 * invoked from the browser. Server Components import it directly; if a client
 * path ever needs it, a narrow server action should wrap it rather than
 * exposing the engine wholesale.
 *
 * The only entry point Replay and Backtesting use. Callers ask for an
 * instrument, a timeframe and a range; this decides whether the data is
 * already stored, which provider to ask for the rest, normalises the result
 * and persists it.
 *
 * Nothing above this file knows a provider exists.
 */

import { createClient } from "@/lib/supabase/server"
import { isTimeframe, type Timeframe } from "@/lib/candles"
import { getInstrumentBySymbol } from "./registry"
import { getBestProvider } from "./router"
import { findMissingRanges, type StoredRange } from "./coverage"
import { isSaneCandle } from "./provider"
import {
  UNAVAILABLE_MESSAGES,
  type Candle,
  type HistoricalResult,
  type UnavailableReason,
} from "./types"

/** Stored span for one instrument/timeframe, used to avoid refetching. */
async function getStoredRange(
  symbol: string,
  timeframe: string,
): Promise<StoredRange> {
  const supabase = await createClient()
  if (!supabase) return { first: null, last: null, candleCount: 0 }

  const { data, error } = await supabase
    .from("candle_catalog")
    .select("candle_count, first_ts, last_ts")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .maybeSingle()

  if (error || !data) return { first: null, last: null, candleCount: 0 }

  return {
    first: (data.first_ts as string) ?? null,
    last: (data.last_ts as string) ?? null,
    candleCount: Number(data.candle_count ?? 0),
  }
}

/**
 * Persists fetched candles under Tradar's own symbol.
 *
 * Writes go through import_candles(), the SECURITY DEFINER function that is
 * the only write path into public.candles — so the engine cannot bypass the
 * validation or the admin restriction, and the primary key keeps the write
 * idempotent.
 */
async function persistCandles(
  symbol: string,
  timeframe: string,
  candles: Candle[],
): Promise<number> {
  if (candles.length === 0) return 0

  const supabase = await createClient()
  if (!supabase) return 0

  const rows = candles.filter(isSaneCandle).map((c) => ({
    symbol,
    timeframe,
    ts: c.ts,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))

  let written = 0
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000)
    const { error } = await supabase.rpc("import_candles", { payload: batch })
    if (error) break
    written += batch.length
  }

  return written
}

/** Reads stored candles for a range. */
async function readStored(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const supabase = await createClient()
  if (!supabase) return []

  const { data, error } = await supabase
    .from("candles")
    .select("ts, open, high, low, close, volume")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
    .gte("ts", from.toISOString())
    .lte("ts", to.toISOString())
    .order("ts", { ascending: true })
    .limit(20000)

  if (error || !data) return []

  return (data as Record<string, unknown>[]).map((row) => ({
    ts: String(row.ts),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume === null ? null : Number(row.volume),
  }))
}

function unavailable(reason: UnavailableReason): HistoricalResult {
  return { ok: false, reason, message: UNAVAILABLE_MESSAGES[reason] }
}

/**
 * Ensures a range is available locally, fetching only what is missing, then
 * returns the candles.
 *
 * Order of operations:
 *   1. resolve the instrument and its listings
 *   2. work out which sub-ranges are not already stored
 *   3. if none, serve from the database with no provider call at all
 *   4. otherwise route to a provider, fetch only the gaps, persist, re-read
 *
 * A provider failure is caught and reported as a customer-safe message; the
 * raw vendor error never reaches the UI.
 */
export async function getHistoricalData(params: {
  symbol: string
  timeframe: string
  from: string
  to: string
}): Promise<HistoricalResult> {
  const { symbol, timeframe } = params

  if (!isTimeframe(timeframe)) return unavailable("timeframe_unsupported")

  const from = new Date(params.from)
  const to = new Date(params.to)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return { ok: false, reason: "provider_error", message: "Invalid date range." }
  }

  const instrument = await getInstrumentBySymbol(symbol)
  if (!instrument) return unavailable("no_provider")
  if (!instrument.active) return unavailable("instrument_inactive")

  const stored = await getStoredRange(symbol, timeframe)
  const missing = findMissingRanges(stored, from, to)

  // Everything is already cached — the common case once one customer has
  // pulled a range, and the reason a second customer costs nothing.
  if (missing.length === 0) {
    const candles = await readStored(symbol, timeframe, from, to)
    return { ok: true, candles, provider: "cache" }
  }

  const route = getBestProvider(
    instrument,
    instrument.listings,
    timeframe as Timeframe,
  )

  if (!route.ok) {
    // No source for the gaps. If something is stored, serve that rather than
    // failing outright — partial history is more useful than none.
    if (stored.candleCount > 0) {
      const candles = await readStored(symbol, timeframe, from, to)
      if (candles.length > 0) {
        return { ok: true, candles, provider: "cache" }
      }
    }
    return unavailable(route.reason)
  }

  for (const gap of missing) {
    try {
      const fetched = await route.provider.getHistoricalCandles({
        instrument,
        listing: route.listing,
        timeframe: timeframe as Timeframe,
        from: gap.from,
        to: gap.to,
      })
      await persistCandles(symbol, timeframe, fetched)
    } catch {
      // Vendor errors are deliberately not surfaced verbatim: a customer
      // should not see a rate-limit code or an upstream hostname.
      return {
        ok: false,
        reason: "provider_error",
        message:
          "Historical data could not be retrieved right now. Please try again shortly.",
      }
    }
  }

  const candles = await readStored(symbol, timeframe, from, to)
  return { ok: true, candles, provider: route.provider.capabilities.key }
}

/** Availability without fetching anything, for the catalogue UI. */
export async function getAvailability(
  symbol: string,
  timeframe: string,
): Promise<{ available: boolean; provider: string | null; message: string | null }> {
  if (!isTimeframe(timeframe)) {
    return {
      available: false,
      provider: null,
      message: UNAVAILABLE_MESSAGES.timeframe_unsupported,
    }
  }

  const instrument = await getInstrumentBySymbol(symbol)
  if (!instrument) {
    return { available: false, provider: null, message: UNAVAILABLE_MESSAGES.no_provider }
  }

  const route = getBestProvider(
    instrument,
    instrument.listings,
    timeframe as Timeframe,
  )

  if (route.ok) {
    return {
      available: true,
      provider: route.provider.capabilities.label,
      message: null,
    }
  }

  // Data already imported by an administrator counts as available even with no
  // live source — that is the whole point of the CSV fallback.
  const stored = await getStoredRange(symbol, timeframe)
  if (stored.candleCount > 0) {
    return { available: true, provider: "Imported data", message: null }
  }

  return {
    available: false,
    provider: null,
    message: UNAVAILABLE_MESSAGES[route.reason],
  }
}

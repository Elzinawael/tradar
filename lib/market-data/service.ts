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
import { isTimeframe, TIMEFRAME_MINUTES, type Timeframe } from "@/lib/candles"
import { getCandleRangeStats } from "@/lib/data"
import { getInstrumentBySymbol } from "./registry"
import { resolveProviders } from "./router"
import { runFailover } from "./failover"
import {
  findMissingRanges,
  missingRangesFromSpans,
  type MissingRange,
  type StoredRange,
} from "./coverage"
import { isSaneCandle } from "./provider"
import {
  isFailoverSafe,
  PROVIDER_ERROR_MESSAGES,
  ProviderError,
  UNAVAILABLE_MESSAGES,
  type Candle,
  type HistoricalResult,
  type ProviderAttempt,
  type ProviderErrorCode,
  type RangeCoverage,
  type UnavailableReason,
} from "./types"

/** Cheap range stats — a COUNT and the two edge timestamps. */
type RangeStats = { count: number; firstTs: string | null; lastTs: string | null }

/**
 * Builds a {@link RangeCoverage} from cheap stats plus the uncovered sub-ranges
 * the coverage-span model reports. Never scans the full dataset.
 *
 * `missing` comes from candle_coverage (interior-hole aware) or, for data that
 * predates migration 0013, the legacy outer min/max. Head and tail shortfalls
 * are judged from the actual stored edges so metadata that over-claims cannot
 * pass a range off as complete.
 */
function buildRangeCoverage(
  stats: RangeStats,
  missing: MissingRange[],
  from: Date,
  to: Date,
  timeframe: Timeframe,
): RangeCoverage {
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
  const tol = barMs * 2

  const missingHead =
    stats.count === 0 ||
    stats.firstTs === null ||
    new Date(stats.firstTs).getTime() - from.getTime() > tol
  const missingTail =
    stats.count === 0 ||
    stats.lastTs === null ||
    to.getTime() - new Date(stats.lastTs).getTime() > tol

  const gaps = missing
    .filter(
      (r) =>
        r.from.getTime() > from.getTime() + tol &&
        r.to.getTime() < to.getTime() - tol,
    )
    .map((r) => ({
      from: r.from.toISOString(),
      to: r.to.toISOString(),
      missingBars: Math.max(
        0,
        Math.round((r.to.getTime() - r.from.getTime()) / barMs) - 1,
      ),
    }))

  return {
    count: stats.count,
    firstTs: stats.firstTs,
    lastTs: stats.lastTs,
    complete: stats.count > 0 && !missingHead && !missingTail && gaps.length === 0,
    missingHead,
    missingTail,
    gaps,
  }
}

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
 * Persists fetched candles for one gap.
 *
 * Writes go through ingest_market_data() (migration 0013), the SECURITY
 * DEFINER path for engine-fetched data: authenticated, symbol-must-be-a-real-
 * instrument, per-user rate limited, audited. It also records the requested
 * `gap` in candle_coverage. The primary key keeps the write idempotent.
 *
 * Errors are RETURNED, never swallowed — a persist failure must reach the
 * caller as a concrete message rather than collapsing into "no data".
 */
async function persistGap(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  gap: MissingRange,
): Promise<{ written: number; error: string | null }> {
  const supabase = await createClient()
  if (!supabase) return { written: 0, error: "storage unavailable" }

  const rows = candles.filter(isSaneCandle).map((c) => ({
    ts: c.ts,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }))

  let written = 0
  // First call carries the coverage range; later batches only add bars.
  for (let i = 0; i < rows.length || i === 0; i += 5000) {
    const batch = rows.slice(i, i + 5000)
    const { data, error } = await supabase.rpc("ingest_market_data", {
      p_symbol: symbol,
      p_timeframe: timeframe,
      p_candles: batch,
      p_range_start: i === 0 ? gap.from.toISOString() : null,
      p_range_end: i === 0 ? gap.to.toISOString() : null,
    })
    if (error) return { written, error: error.message }
    written += Number((data as { ingested?: number } | null)?.ingested ?? 0)
    if (batch.length < 5000) break
  }

  return { written, error: null }
}

/** Reads the recorded coverage spans for one instrument/timeframe. */
async function readCoverageSpans(
  symbol: string,
  timeframe: string,
): Promise<{ range_start: string; range_end: string }[]> {
  const supabase = await createClient()
  if (!supabase) return []
  const { data, error } = await supabase
    .from("candle_coverage")
    .select("range_start, range_end")
    .eq("symbol", symbol)
    .eq("timeframe", timeframe)
  if (error || !data) return []
  return data as { range_start: string; range_end: string }[]
}


/**
 * Reads a capped, most-recent sample of stored candles for a range.
 *
 * The `candles` on a HistoricalResult are for precision inference and a small
 * preview only — callers that need the full series load it windowed through
 * `getCandles`. Ordering DESC + limit keeps this cheap no matter how wide the
 * range is (a 90-day M1 window is ~130k bars); the slice is re-sorted ASC.
 */
const SAMPLE_BARS = 2000

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
    .order("ts", { ascending: false })
    .limit(SAMPLE_BARS)

  if (error || !data) return []

  return (data as Record<string, unknown>[])
    .map((row) => ({
      ts: String(row.ts),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: row.volume === null ? null : Number(row.volume),
    }))
    .reverse()
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

  // ── Which sub-ranges still need fetching ────────────────────────────────
  // Prefer explicit coverage spans (candle_coverage, migration 0013), which
  // see interior holes. Fall back to the legacy outer min/max for data that
  // predates 0013. Never scan the full range — a wide M1 request is hundreds
  // of thousands of bars.
  const readMissing = async (): Promise<MissingRange[]> => {
    const spans = await readCoverageSpans(symbol, timeframe)
    return spans.length > 0
      ? missingRangesFromSpans(spans, from, to)
      : findMissingRanges(await getStoredRange(symbol, timeframe), from, to)
  }

  let missing = await readMissing()
  let stats = await getCandleRangeStats({
    symbol,
    timeframe,
    from: params.from,
    to: params.to,
  })

  // ── Fast path: spans say covered ───────────────────────────────────────
  // But never trust metadata alone — check the actual bars via cheap stats.
  // If the stored edges disagree, treat the shortfall as missing.
  if (missing.length === 0) {
    const cov = buildRangeCoverage(stats, [], from, to, timeframe as Timeframe)
    if (cov.complete) {
      const candles = await readStored(symbol, timeframe, from, to)
      return { ok: true, candles, provider: "cache", coverage: cov, partial: false }
    }
    missing = [
      ...(cov.missingHead
        ? [{ from, to: stats.firstTs ? new Date(stats.firstTs) : to }]
        : []),
      ...(cov.missingTail && stats.lastTs
        ? [{ from: new Date(stats.lastTs), to }]
        : []),
    ].filter((r) => r.to.getTime() > r.from.getTime())
    if (missing.length === 0) missing = [{ from, to }]
  }

  const resolution = resolveProviders(
    instrument,
    instrument.listings,
    timeframe as Timeframe,
  )

  if (resolution.eligible.length === 0) {
    // No source for the gaps. Serve whatever is stored rather than failing
    // outright — partial history beats none — but report it as partial.
    if (stats.count > 0) {
      const candles = await readStored(symbol, timeframe, from, to)
      const cov = buildRangeCoverage(
        stats,
        await readMissing(),
        from,
        to,
        timeframe as Timeframe,
      )
      return { ok: true, candles, provider: "cache", coverage: cov, partial: !cov.complete }
    }
    return unavailable(resolution.reason ?? "no_provider")
  }

  // ── Failover ────────────────────────────────────────────────────────────
  let persistError: string | null = null
  const outcome = await runFailover({
    eligible: resolution.eligible,
    missing,
    fetchCandles: (candidate, gap) =>
      candidate.provider.getHistoricalCandles({
        instrument,
        listing: candidate.listing,
        timeframe: timeframe as Timeframe,
        from: gap.from,
        to: gap.to,
      }),
    onCandles: async (fetched, gap) => {
      const result = await persistGap(symbol, timeframe, fetched, gap)
      if (result.error) persistError = result.error
    },
  })

  const { attempts, fallbackUsed, candlesReceived, lastCode } = outcome
  const usedProvider = outcome.provider

  // ── Coverage verification from the actual stored bars ──────────────────
  // Cheap stats + the (RPC-recorded) coverage spans, never a full scan. The
  // ingest RPC writes a coverage span for every gap it is asked to fill, so
  // a partial provider response is retried next time rather than trusted.
  stats = await getCandleRangeStats({
    symbol,
    timeframe,
    from: params.from,
    to: params.to,
  })
  const cov = buildRangeCoverage(
    stats,
    await readMissing(),
    from,
    to,
    timeframe as Timeframe,
  )
  const candles = await readStored(symbol, timeframe, from, to)

  const diagnostics = {
    attempts,
    fallbackUsed,
    candlesReceived,
    candlesStored: stats.count,
    cacheHit: false,
    missingRanges:
      cov.gaps.length + (cov.missingHead ? 1 : 0) + (cov.missingTail ? 1 : 0),
    skippedByCircuitBreaker: resolution.skippedByCircuitBreaker,
  }

  if (stats.count === 0) {
    // A provider answered but nothing landed in storage. With the 0013
    // ingestion path this should not be an authorization problem any more, but
    // surface whatever the RPC said rather than a generic "unavailable".
    if (persistError !== null && candlesReceived > 0) {
      return {
        ok: false,
        reason: "provider_error",
        message: `Market data was retrieved but could not be saved: ${persistError}`,
        diagnostics,
      }
    }
    return {
      ok: false,
      reason: lastCode ?? "provider_error",
      message:
        lastCode !== null
          ? PROVIDER_ERROR_MESSAGES[lastCode]
          : "Historical data could not be retrieved right now. Please try again shortly.",
      diagnostics,
    }
  }

  return {
    ok: true,
    candles,
    provider: usedProvider ?? "cache",
    coverage: cov,
    partial: !cov.complete,
    diagnostics,
  }
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

  const resolution = resolveProviders(
    instrument,
    instrument.listings,
    timeframe as Timeframe,
  )

  if (resolution.eligible.length > 0) {
    return {
      available: true,
      provider: resolution.eligible[0].provider.capabilities.label,
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
    message: UNAVAILABLE_MESSAGES[resolution.reason ?? "no_provider"],
  }
}


/**
 * Ensures a range is present locally, fetching only the gaps, then returns it.
 *
 * The name the brief specifies. It is the same operation as
 * getHistoricalData() — check cache, fill gaps, return the complete local
 * dataset — exposed under the name Replay and Backtesting call, so there is
 * one implementation rather than two that could drift.
 */
export async function ensureHistoricalData(params: {
  symbol: string
  timeframe: string
  from: string
  to: string
}): Promise<HistoricalResult> {
  return getHistoricalData(params)
}

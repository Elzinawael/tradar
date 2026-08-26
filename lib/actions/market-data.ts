"use server"

import { getIsAdmin } from "@/lib/data"
import { isTimeframe } from "@/lib/candles"
import { ensureHistoricalData } from "@/lib/market-data/service"
import { getInstrumentBySymbol } from "@/lib/market-data/registry"
// Type-only import: erased at compile time, so it does not become an export of
// this "use server" module.
import type { EnsureDataState } from "./state"

/**
 * Fetch-on-demand bridge between the Replay UI and the Market Data Engine.
 *
 * A customer picks an instrument, a timeframe and a range; this makes sure the
 * candles exist locally, downloading only what is missing. They never upload a
 * CSV, never choose a provider, and never learn one was involved.
 *
 * SECURITY. The client sends only a Tradar symbol, a timeframe and two dates:
 *
 *   - the provider is chosen by the router from the registry, never sent by
 *     the browser
 *   - the provider's own symbol comes from instrument_providers, so a client
 *     cannot make Tradar request an arbitrary upstream ticker
 *   - candles are written by the engine through import_candles(), so a client
 *     cannot inject bars
 *   - the API key is read server-side inside the adapter and never returned
 *
 * The result is deliberately coarse. A customer is told whether data is ready,
 * not which vendor failed or why — provider detail is returned only to
 * administrators, for debugging.
 */

/** Guards against a customer requesting an unbounded download. */
const MAX_RANGE_DAYS = 400

export async function ensureReplayData(
  _prev: EnsureDataState,
  formData: FormData,
): Promise<EnsureDataState> {
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase()
  const timeframe = String(formData.get("timeframe") ?? "").trim()
  const fromRaw = String(formData.get("from") ?? "").trim()
  const toRaw = String(formData.get("to") ?? "").trim()

  const isAdmin = await getIsAdmin()

  if (!symbol) {
    return {
      status: "error",
      message: "Choose an instrument.",
      candleCount: 0,
      providerDetail: null,
    }
  }

  if (!isTimeframe(timeframe)) {
    return {
      status: "error",
      message: "Choose a valid timeframe.",
      candleCount: 0,
      providerDetail: null,
    }
  }

  const from = new Date(fromRaw)
  const to = new Date(toRaw)

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    return {
      status: "error",
      message: "Choose a valid date range.",
      candleCount: 0,
      providerDetail: null,
    }
  }

  if (to <= from) {
    return {
      status: "error",
      message: "The end date must be after the start date.",
      candleCount: 0,
      providerDetail: null,
    }
  }

  const days = (to.getTime() - from.getTime()) / 86_400_000
  if (days > MAX_RANGE_DAYS) {
    return {
      status: "error",
      message: `Choose a range of ${MAX_RANGE_DAYS} days or fewer.`,
      candleCount: 0,
      providerDetail: null,
    }
  }

  // The instrument must be in the registry: a client cannot invent a symbol
  // and have Tradar go fetch it.
  const instrument = await getInstrumentBySymbol(symbol)
  if (!instrument) {
    return {
      status: "unavailable",
      message: "That instrument is not available.",
      candleCount: 0,
      providerDetail: null,
    }
  }

  const result = await ensureHistoricalData({
    symbol,
    timeframe,
    from: from.toISOString(),
    to: to.toISOString(),
  })

  if (!result.ok) {
    return {
      status: "unavailable",
      // Customer-safe wording produced by the engine; a vendor's raw error
      // never reaches here.
      message: result.message,
      candleCount: 0,
      providerDetail: isAdmin ? `reason: ${result.reason}` : null,
    }
  }

  if (result.candles.length === 0) {
    return {
      status: "unavailable",
      message:
        "No historical data is available for that instrument over this period.",
      candleCount: 0,
      providerDetail: isAdmin ? `provider: ${result.provider}` : null,
    }
  }

  return {
    status: "ready",
    message: `${result.candles.length.toLocaleString()} candles ready.`,
    candleCount: result.candles.length,
    providerDetail: isAdmin ? `provider: ${result.provider}` : null,
  }
}

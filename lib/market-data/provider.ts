/**
 * The provider contract.
 *
 * Every data source implements this. Adding a vendor means adding one file
 * here and one row in instrument_providers — Replay, Backtesting, the charts
 * and the analytics engine are untouched.
 *
 * Adapters must return candles in the canonical `Candle` shape. Symbol
 * translation belongs to the adapter: it receives the provider's own symbol
 * from the listing and never sees Tradar's.
 */

import type {
  Candle,
  HistoricalRequest,
  ProviderCapabilities,
} from "./types"

export interface MarketDataProvider {
  capabilities: ProviderCapabilities

  /**
   * Historical candles for a request.
   *
   * Throws only on programming errors. Expected failures — a bad symbol, a
   * rate limit, an unreachable host — are returned as a rejected result by the
   * service so the UI can show a customer-appropriate message.
   */
  getHistoricalCandles(request: HistoricalRequest): Promise<Candle[]>

  /**
   * Latest known price. Optional: a purely historical source will not
   * implement it.
   */
  getLatestPrice?(providerSymbol: string): Promise<number | null>

  /**
   * Live subscription. Declared for shape only — no adapter implements it yet,
   * and Replay does not consume live data. Present so adding streaming later
   * does not require changing this interface.
   */
  subscribeLive?(
    providerSymbol: string,
    onCandle: (candle: Candle) => void,
  ): Promise<() => void>
}

/** Rejects bars that cannot be real. Shared by every adapter. */
export function isSaneCandle(candle: Candle): boolean {
  const values = [candle.open, candle.high, candle.low, candle.close]
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return false
  if (candle.high < candle.low) return false
  if (candle.high < candle.open || candle.high < candle.close) return false
  if (candle.low > candle.open || candle.low > candle.close) return false
  return Number.isFinite(new Date(candle.ts).getTime())
}

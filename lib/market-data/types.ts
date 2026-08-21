/**
 * Canonical market data model.
 *
 * These types are the contract between Replay/Backtesting and the outside
 * world. Nothing above this layer knows whether a candle came from Binance, a
 * CSV file, a paid vendor or the local database.
 */

import type { Candle, Timeframe } from "@/lib/candles"

export type { Candle, Timeframe }

export type MarketCategory =
  | "forex"
  | "commodities"
  | "indices"
  | "stocks"
  | "futures"
  | "crypto"
  | "options"

export const MARKET_CATEGORIES: MarketCategory[] = [
  "forex",
  "commodities",
  "indices",
  "stocks",
  "futures",
  "crypto",
  "options",
]

export const MARKET_CATEGORY_LABELS: Record<MarketCategory, string> = {
  forex: "Forex",
  commodities: "Commodities",
  indices: "Indices",
  stocks: "Stocks",
  futures: "Futures",
  crypto: "Crypto",
  options: "Options",
}

/** An instrument Tradar can represent. */
export interface Instrument {
  id: string
  /** Tradar's stable symbol, and the key candles are stored under. */
  symbol: string
  displayName: string
  category: MarketCategory
  assetType: string | null
  baseAsset: string | null
  quoteAsset: string | null
  exchange: string | null
  timezone: string
  pricePrecision: number
  quantityPrecision: number
  active: boolean
}

/** How one provider names and serves an instrument. */
export interface InstrumentListing {
  provider: string
  providerSymbol: string
  supportsHistorical: boolean
  supportsRealtime: boolean
  /** Empty means "the provider's declared default set". */
  timeframes: string[]
  priority: number
}

/** An instrument together with the providers that list it. */
export interface InstrumentWithListings extends Instrument {
  listings: InstrumentListing[]
}

/**
 * Why data cannot be served, when it cannot.
 *
 * Modelled explicitly so the UI can say something true and useful instead of
 * surfacing a provider's raw error text to a customer.
 */
export type UnavailableReason =
  | "no_provider"
  | "provider_not_configured"
  | "timeframe_unsupported"
  | "historical_unsupported"
  | "instrument_inactive"

export const UNAVAILABLE_MESSAGES: Record<UnavailableReason, string> = {
  no_provider:
    "No data source is configured for this instrument yet.",
  provider_not_configured:
    "This instrument's data source is not configured on this server.",
  timeframe_unsupported:
    "This timeframe is not available for this instrument.",
  historical_unsupported:
    "Historical data is not available for this instrument.",
  instrument_inactive: "This instrument is not currently available.",
}

/** What a provider is able to do. */
export interface ProviderCapabilities {
  /** Stable key, matching instrument_providers.provider. */
  key: string
  label: string
  historical: boolean
  realtime: boolean
  categories: MarketCategory[]
  timeframes: Timeframe[]
  /**
   * False when the adapter exists but has no credentials or configuration on
   * this server. Routing skips it and the UI explains why, rather than the
   * request failing at fetch time.
   */
  configured: boolean
}

export interface HistoricalRequest {
  instrument: Instrument
  listing: InstrumentListing
  timeframe: Timeframe
  from: Date
  to: Date
}

export type HistoricalResult =
  | { ok: true; candles: Candle[]; provider: string }
  | { ok: false; reason: UnavailableReason | "provider_error"; message: string }

/** A contiguous span of stored data for one instrument/timeframe. */
export interface Coverage {
  symbol: string
  timeframe: string
  candleCount: number
  first: string | null
  last: string | null
}

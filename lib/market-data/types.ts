/**
 * Canonical market data model.
 *
 * These types are the contract between Replay/Backtesting and the outside
 * world. Nothing above this layer knows whether a candle came from Binance, a
 * CSV file, a paid vendor or the local database.
 */

import type { Candle, Timeframe } from "../candles.ts"

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
  | "instrument_unsupported"
  | "provider_unavailable_temporarily"

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
  instrument_unsupported:
    "No configured data source covers this market yet.",
  provider_unavailable_temporarily:
    "Market data is temporarily unavailable. Please try again shortly.",
}

/**
 * Licensing posture of a provider's data.
 *
 * Deliberately separate from technical capability. An API returning bytes says
 * nothing about what a licence permits, and conflating the two is how products
 * end up redistributing exchange data they are not entitled to. These flags
 * record what the OPERATOR has established, and default to the restrictive
 * answer — no code here infers a right from a successful HTTP call.
 */
export interface ProviderLicensing {
  /** Historical bars may be stored and replayed. */
  historical: boolean
  /** Live streaming is licensed. */
  realtime: boolean
  /** Data is delayed rather than real-time. */
  delayed: boolean
  /**
   * Data may only be used inside Tradar by the account that fetched it.
   * The safe default.
   */
  internalOnly: boolean
  /**
   * Data may be displayed publicly or redistributed. Almost always requires a
   * separate commercial agreement with the venue, so this stays false unless
   * an operator has confirmed otherwise.
   */
  externalDisplay: boolean
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
  licensing: ProviderLicensing
  /**
   * True when instruments are contracts rather than perpetual symbols, so a
   * listing must name the specific contract. Futures roots like ES are not
   * tradeable tickers on their own.
   */
  contractBased?: boolean
}

/**
 * Internal error states.
 *
 * Provider failures are translated into these before they leave the engine, so
 * a customer never sees a vendor status code, an upstream hostname or a raw
 * rate-limit payload.
 */
export type ProviderErrorCode =
  | "provider_unavailable"
  | "provider_not_configured"
  | "auth_error"
  | "rate_limited"
  | "unsupported_instrument"
  | "unsupported_timeframe"
  | "historical_data_unavailable"
  | "license_not_configured"
  | "network_error"
  | "timeout"
  | "empty_data"
  | "invalid_provider_response"

/** Customer-facing wording. Deliberately free of provider names. */
export const PROVIDER_ERROR_MESSAGES: Record<ProviderErrorCode, string> = {
  provider_unavailable:
    "Market data is temporarily unavailable. Please try again shortly.",
  provider_not_configured:
    "A data source has not been configured for this instrument yet.",
  rate_limited:
    "Too many data requests right now. Please try again in a moment.",
  unsupported_instrument:
    "Historical data is not available for this instrument yet.",
  unsupported_timeframe:
    "This timeframe is not available for this instrument.",
  historical_data_unavailable:
    "No historical data was returned for this period.",
  license_not_configured:
    "This data source is not licensed for use on this server.",
  network_error:
    "Market data could not be reached. Please try again shortly.",
  auth_error:
    "A data source rejected its credentials. An administrator has been notified.",
  timeout:
    "Market data is taking too long to respond. Please try again shortly.",
  empty_data:
    "No market data was returned for that period.",
  invalid_provider_response:
    "Market data could not be read. Please try again shortly.",
}

/**
 * Thrown by adapters so the service can translate a failure into a customer
 * message without inspecting vendor-specific error shapes.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode

  /** `message` is operator-facing detail — logged, never shown to a customer. */
  constructor(code: ProviderErrorCode, message: string) {
    super(message)
    this.name = "ProviderError"
    this.code = code
  }
}

export interface HistoricalRequest {
  instrument: Instrument
  listing: InstrumentListing
  timeframe: Timeframe
  from: Date
  to: Date
}

/** One provider attempt, for admin diagnostics. Never contains credentials. */
export interface ProviderAttempt {
  provider: string
  ok: boolean
  code: ProviderErrorCode | null
}

/**
 * Internal diagnostics for an ensure/fetch cycle.
 *
 * Surfaced to administrators only. Deliberately carries no API key, no URL and
 * no candle payload — just enough to explain what the router did.
 */
export interface FetchDiagnostics {
  attempts: ProviderAttempt[]
  fallbackUsed: boolean
  candlesReceived: number
  candlesStored: number
  cacheHit: boolean
  /** How many sub-ranges remain uncovered after the cycle. */
  missingRanges: number
  skippedByCircuitBreaker: string[]
}

/**
 * Range coverage after an ensure cycle.
 *
 * Built from cheap stats (a COUNT and the two edge timestamps) plus the
 * recorded coverage spans — never by scanning the whole dataset, which for a
 * wide M1 range is hundreds of thousands of bars.
 */
export interface RangeCoverage {
  /** Total bars stored for the requested range. */
  count: number
  firstTs: string | null
  lastTs: string | null
  /**
   * The recorded coverage spans contain the whole requested range, and the
   * stored data reaches within a bar of both edges.
   */
  complete: boolean
  /** The start of the requested range has no stored data near it. */
  missingHead: boolean
  /** The end of the requested range has no stored data near it. */
  missingTail: boolean
  /** Sub-ranges of the request not covered by any recorded span. */
  gaps: { from: string; to: string; missingBars: number }[]
}

export type HistoricalResult =
  | {
      ok: true
      /**
       * A recent sample of the range (capped) for preview / precision
       * inference. NOT the whole dataset — use `coverage.count` for the count.
       */
      candles: Candle[]
      provider: string
      coverage: RangeCoverage
      /** True when the requested range is not fully covered by stored data. */
      partial?: boolean
      diagnostics?: FetchDiagnostics
    }
  | {
      ok: false
      reason: UnavailableReason | ProviderErrorCode | "provider_error"
      message: string
      diagnostics?: FetchDiagnostics
    }

/** A contiguous span of stored data for one instrument/timeframe. */
export interface Coverage {
  symbol: string
  timeframe: string
  candleCount: number
  first: string | null
  last: string | null
}


// ---------------------------------------------------------------------------
// Failover policy
// ---------------------------------------------------------------------------

/**
 * Whether a failure justifies trying a DIFFERENT provider.
 *
 * The distinction is what stops failover from being either useless or
 * harmful:
 *
 *   * Transient faults — a timeout, a rate limit, a malformed body — say
 *     nothing about whether another provider can serve the request, so trying
 *     the next one is worthwhile.
 *
 *   * `unsupported_instrument` and `unsupported_timeframe` are facts about
 *     THIS provider, not the request. Another provider may well support them,
 *     and eligibility has already been checked, so we move on — but we do not
 *     treat it as an outage.
 *
 *   * `provider_not_configured` is an operator problem. Moving to the next
 *     eligible provider is right; counting it as a provider fault is not,
 *     because nothing is wrong with the provider.
 *
 * `empty_data` is deliberately failover-safe: a provider returning nothing for
 * a range another provider covers is a real scenario, and treating "no rows"
 * as success is exactly how missing history gets silently accepted.
 */
export function isFailoverSafe(code: ProviderErrorCode): boolean {
  switch (code) {
    case "network_error":
    case "timeout":
    case "rate_limited":
    case "provider_unavailable":
    case "invalid_provider_response":
    case "empty_data":
    case "auth_error":
    case "provider_not_configured":
    case "license_not_configured":
    case "unsupported_instrument":
    case "unsupported_timeframe":
    case "historical_data_unavailable":
      return true
    default:
      return false
  }
}

/**
 * Whether a failure indicates the PROVIDER is unhealthy, as opposed to the
 * request being unsuitable for it.
 *
 * Only these increment the circuit breaker. A provider must not be tripped
 * because someone asked it for a symbol it never claimed to carry, or because
 * an operator has not supplied its key — neither is a fault it can recover
 * from by waiting.
 */
export function isProviderFault(code: ProviderErrorCode): boolean {
  switch (code) {
    case "network_error":
    case "timeout":
    case "rate_limited":
    case "provider_unavailable":
    case "invalid_provider_response":
      return true
    // auth_error disables the provider for THIS request (handled by the
    // service) but is an operator/credential problem, not a transient fault,
    // so it does not feed the breaker.
    default:
      return false
  }
}

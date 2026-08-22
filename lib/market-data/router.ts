/**
 * Provider routing.
 *
 * Decides which configured provider should serve a request, from the
 * instrument's listings and each adapter's declared capabilities.
 *
 * Deliberately pure: it takes listings as an argument rather than querying,
 * so the routing rules can be unit tested without a database or a network.
 */

import { binanceProvider } from "./providers/binance"
import { csvProvider } from "./providers/csv"
import { massiveProvider } from "./providers/massive"
import { twelveDataProvider } from "./providers/twelve-data"
import type { MarketDataProvider } from "./provider"
import type {
  Instrument,
  InstrumentListing,
  Timeframe,
  UnavailableReason,
} from "./types"

/**
 * Every adapter Tradar knows about.
 *
 * A provider appearing here does NOT mean it can serve anything — routing also
 * requires `configured: true` and a listing for the instrument. That split is
 * what lets an unconfigured vendor be added safely.
 */
export const PROVIDERS: MarketDataProvider[] = [
  binanceProvider,
  twelveDataProvider,
  massiveProvider,
  csvProvider,
]

export function getProvider(key: string): MarketDataProvider | null {
  return PROVIDERS.find((p) => p.capabilities.key === key) ?? null
}

export type RoutingResult =
  | { ok: true; provider: MarketDataProvider; listing: InstrumentListing }
  | { ok: false; reason: UnavailableReason }

/**
 * Chooses the best provider for an instrument and timeframe.
 *
 * Rules, applied in order:
 *   1. the instrument must be active
 *   2. a listing must exist, be active, and support historical data
 *   3. an adapter must exist for that provider key and be configured
 *   4. the adapter must support the timeframe, and the listing must too when
 *      it declares its own set
 *   5. of the survivors, the lowest `priority` wins
 *
 * The distinct failure reasons matter: "no provider is configured for gold"
 * and "gold is not available at 1-minute" are different problems, and a
 * customer deserves to be told which.
 */
export function getBestProvider(
  instrument: Instrument,
  listings: InstrumentListing[],
  timeframe: Timeframe,
): RoutingResult {
  if (!instrument.active) return { ok: false, reason: "instrument_inactive" }
  if (listings.length === 0) return { ok: false, reason: "no_provider" }

  const historical = listings.filter((l) => l.supportsHistorical)
  if (historical.length === 0) {
    return { ok: false, reason: "historical_unsupported" }
  }

  // Track the most specific reason seen, so the caller reports the real
  // obstacle rather than a generic "no provider".
  let reason: UnavailableReason = "provider_not_configured"
  const candidates: { provider: MarketDataProvider; listing: InstrumentListing }[] = []

  for (const listing of historical) {
    const provider = getProvider(listing.provider)
    if (!provider || !provider.capabilities.configured) continue
    if (!provider.capabilities.historical) continue

    // Capabilities must actually gate availability: a provider that does not
    // claim a market must never serve it, even if a listing exists. Without
    // this an operator-added row could route crypto to an equities vendor and
    // the failure would only surface as a confusing upstream error.
    if (!provider.capabilities.categories.includes(instrument.category)) {
      reason = "instrument_unsupported"
      continue
    }

    const providerSupportsTimeframe =
      provider.capabilities.timeframes.includes(timeframe)
    const listingSupportsTimeframe =
      listing.timeframes.length === 0 || listing.timeframes.includes(timeframe)

    if (!providerSupportsTimeframe || !listingSupportsTimeframe) {
      reason = "timeframe_unsupported"
      continue
    }

    candidates.push({ provider, listing })
  }

  if (candidates.length === 0) return { ok: false, reason }

  candidates.sort((a, b) => a.listing.priority - b.listing.priority)
  return { ok: true, provider: candidates[0].provider, listing: candidates[0].listing }
}

/** Whether any configured provider could serve this instrument at all. */
export function hasAnyHistoricalSource(
  instrument: Instrument,
  listings: InstrumentListing[],
): boolean {
  return listings.some((listing) => {
    if (!listing.supportsHistorical) return false
    const provider = getProvider(listing.provider)
    return Boolean(
      provider && provider.capabilities.configured && provider.capabilities.historical,
    )
  })
}

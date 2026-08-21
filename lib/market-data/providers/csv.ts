/**
 * CSV adapter.
 *
 * A placeholder in the provider registry rather than a fetcher: CSV data is
 * pushed in by an administrator through the importer, not pulled on demand, so
 * there is nothing for the router to call.
 *
 * It exists so the catalogue can express "this instrument's data arrives by
 * upload" as a listing, and so the router reports a clear reason instead of
 * treating a manually supplied instrument as having no source at all.
 */

import type { MarketDataProvider } from "../provider"
import type { ProviderCapabilities } from "../types"

const capabilities: ProviderCapabilities = {
  key: "csv",
  label: "CSV upload (admin)",
  // Data is already in the database once imported; nothing is fetched.
  historical: false,
  realtime: false,
  categories: [
    "forex",
    "commodities",
    "indices",
    "stocks",
    "futures",
    "crypto",
    "options",
  ],
  timeframes: ["M1", "M5", "M15", "H1", "H4", "D1"],
  configured: true,
}

export const csvProvider: MarketDataProvider = {
  capabilities,
  async getHistoricalCandles(): Promise<never[]> {
    // Never called: the router excludes providers that cannot serve history.
    // Throwing rather than returning [] makes a routing bug loud instead of
    // silently reporting "no data for this range".
    throw new Error("CSV data is imported by an administrator, not fetched")
  },
}

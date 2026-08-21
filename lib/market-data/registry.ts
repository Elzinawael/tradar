/**
 * Instrument registry access.
 *
 * Reads the catalogue from Postgres under the caller's RLS. The registry is
 * shared read-only reference data, so there are no ownership filters here —
 * and no write paths, because the catalogue is operator-controlled.
 */

import { createClient } from "@/lib/supabase/server"
import type {
  Instrument,
  InstrumentListing,
  InstrumentWithListings,
  MarketCategory,
} from "./types"

type Row = Record<string, unknown>

const INSTRUMENT_COLUMNS =
  "id, symbol, display_name, category, asset_type, base_asset, quote_asset, exchange, timezone, price_precision, quantity_precision, active"

const LISTING_COLUMNS =
  "provider, provider_symbol, supports_historical, supports_realtime, timeframes, priority, active"

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : (value as number)
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

function mapInstrument(row: Row): Instrument {
  return {
    id: str(row.id),
    symbol: str(row.symbol),
    displayName: str(row.display_name),
    category: str(row.category, "forex") as MarketCategory,
    assetType: strOrNull(row.asset_type),
    baseAsset: strOrNull(row.base_asset),
    quoteAsset: strOrNull(row.quote_asset),
    exchange: strOrNull(row.exchange),
    timezone: str(row.timezone, "UTC"),
    pricePrecision: num(row.price_precision, 2),
    quantityPrecision: num(row.quantity_precision, 8),
    active: Boolean(row.active),
  }
}

function mapListing(row: Row): InstrumentListing {
  return {
    provider: str(row.provider),
    providerSymbol: str(row.provider_symbol),
    supportsHistorical: Boolean(row.supports_historical),
    supportsRealtime: Boolean(row.supports_realtime),
    timeframes: Array.isArray(row.timeframes) ? (row.timeframes as string[]) : [],
    priority: num(row.priority, 100),
  }
}

export interface InstrumentQuery {
  search?: string
  category?: MarketCategory
  limit?: number
}

/**
 * Searches the catalogue by symbol or display name.
 *
 * Matching is case-insensitive and substring-based, so "gold" finds XAUUSD and
 * "eur" finds both EURUSD and the euro-quoted index.
 */
export async function searchInstruments(
  query: InstrumentQuery = {},
): Promise<Instrument[]> {
  const supabase = await createClient()
  if (!supabase) return []

  let q = supabase
    .from("instruments")
    .select(INSTRUMENT_COLUMNS)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("symbol", { ascending: true })
    .limit(Math.min(200, Math.max(1, query.limit ?? 100)))

  if (query.category) q = q.eq("category", query.category)

  if (query.search && query.search.trim().length > 0) {
    const term = query.search.trim().replace(/[%,]/g, "")
    if (term.length > 0) {
      q = q.or(`symbol.ilike.%${term}%,display_name.ilike.%${term}%`)
    }
  }

  const { data, error } = await q
  if (error || !data) return []
  return (data as Row[]).map(mapInstrument)
}

/** One instrument by Tradar symbol, with its provider listings. */
export async function getInstrumentBySymbol(
  symbol: string,
): Promise<InstrumentWithListings | null> {
  const supabase = await createClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from("instruments")
    .select(`${INSTRUMENT_COLUMNS}, instrument_providers(${LISTING_COLUMNS})`)
    .eq("symbol", symbol)
    .maybeSingle()

  if (error || !data) return null

  const row = data as Row
  const listings = Array.isArray(row.instrument_providers)
    ? (row.instrument_providers as Row[])
        .filter((l) => Boolean(l.active))
        .map(mapListing)
    : []

  return { ...mapInstrument(row), listings }
}

/** Listings for several instruments at once, keyed by instrument id. */
export async function getListingsFor(
  instrumentIds: string[],
): Promise<Map<string, InstrumentListing[]>> {
  const result = new Map<string, InstrumentListing[]>()
  if (instrumentIds.length === 0) return result

  const supabase = await createClient()
  if (!supabase) return result

  const { data, error } = await supabase
    .from("instrument_providers")
    .select(`instrument_id, ${LISTING_COLUMNS}`)
    .in("instrument_id", instrumentIds)
    .eq("active", true)

  if (error || !data) return result

  for (const row of data as Row[]) {
    const key = str(row.instrument_id)
    const bucket = result.get(key) ?? []
    bucket.push(mapListing(row))
    result.set(key, bucket)
  }

  return result
}

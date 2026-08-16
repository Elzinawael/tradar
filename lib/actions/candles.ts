"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { parseCsv } from "@/lib/csv-import"
import { isTimeframe, TIMEFRAME_MINUTES, type Candle } from "@/lib/candles"
import type { CandleImportState } from "./state"

/**
 * Candle ingestion.
 *
 * Candles are shared reference data with no INSERT policy, so these writes
 * cannot succeed from the browser — they run server-side only. The table's
 * primary key (symbol, timeframe, ts) makes ingestion idempotent: re-importing
 * an overlapping range updates the existing bars rather than duplicating them.
 */

const BATCH_SIZE = 1000
const MAX_CANDLES = 200_000

/** Binance's public REST endpoint caps a klines request at 1000 bars. */
const BINANCE_LIMIT = 1000
const BINANCE_INTERVALS: Record<string, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
}

interface CandleRow {
  symbol: string
  timeframe: string
  ts: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** Rejects bars that cannot be real, mirroring the database constraints. */
function isSaneCandle(c: Candle): boolean {
  const values = [c.open, c.high, c.low, c.close]
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return false
  if (c.high < c.low) return false
  if (c.high < c.open || c.high < c.close) return false
  if (c.low > c.open || c.low > c.close) return false
  if (!Number.isFinite(new Date(c.ts).getTime())) return false
  return true
}

/**
 * Server-side admin gate.
 *
 * Defence in depth and a clearer error message: import_candles() rejects
 * non-administrators inside the database regardless, so removing this check
 * would not open a hole — it would only produce a worse message.
 */
async function requireAdmin(): Promise<string | null> {
  const supabase = await createClient()
  if (!supabase) return "Supabase is not configured."

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return "You must be signed in."

  const { data, error } = await supabase.rpc("is_admin")
  if (error) return "Could not verify your permissions."
  if (data !== true) {
    return "Importing market data is restricted to administrators."
  }
  return null
}

async function upsertCandles(
  rows: CandleRow[],
): Promise<{ inserted: number; error: string | null }> {
  const supabase = await createClient()
  if (!supabase) {
    return { inserted: 0, error: "Supabase is not configured." }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { inserted: 0, error: "You must be signed in." }

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    // public.candles has no write policy, so writes go through the
    // SECURITY DEFINER import_candles() function, which revalidates every bar
    // in Postgres. Direct table writes stay impossible from any client.
    const { error } = await supabase.rpc("import_candles", { payload: batch })

    if (error) {
      return {
        inserted,
        error:
          inserted > 0
            ? `Imported ${inserted} candles, then failed: ${error.message}`
            : error.message,
      }
    }
    inserted += batch.length
  }

  return { inserted, error: null }
}

/**
 * Imports candles from a CSV file.
 *
 * Reuses the RFC 4180 parser written for trade import, so quoted fields, BOMs
 * and CRLF endings are handled identically. Expected columns, in order or by
 * header name: timestamp, open, high, low, close, volume (volume optional).
 */
export async function importCandlesCsv(
  _prev: CandleImportState,
  formData: FormData,
): Promise<CandleImportState> {
  const denied = await requireAdmin()
  if (denied) return { error: denied, message: null, imported: 0 }

  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase()
  const timeframe = String(formData.get("timeframe") ?? "").trim()
  const csv = String(formData.get("csv") ?? "")

  if (!symbol) {
    return { error: "A symbol is required.", message: null, imported: 0 }
  }
  if (!isTimeframe(timeframe)) {
    return { error: "Choose a valid timeframe.", message: null, imported: 0 }
  }
  if (!csv.trim()) {
    return { error: "No file content received.", message: null, imported: 0 }
  }

  const rows = parseCsv(csv)
  if (rows.length === 0) {
    return { error: "The file contained no rows.", message: null, imported: 0 }
  }

  // Detect a header row by checking whether the second column parses as a
  // number; in a data row it always should.
  const hasHeader = Number.isNaN(Number(rows[0][1]))
  const dataRows = hasHeader ? rows.slice(1) : rows

  if (dataRows.length > MAX_CANDLES) {
    return {
      error: `That file has ${dataRows.length} rows; the limit is ${MAX_CANDLES}.`,
      message: null,
      imported: 0,
    }
  }

  const parsed: CandleRow[] = []
  let skipped = 0

  for (const row of dataRows) {
    const [tsRaw, o, h, l, c, v] = row
    // Accept both ISO strings and epoch seconds/milliseconds.
    const numericTs = Number(tsRaw)
    const date = Number.isFinite(numericTs) && String(tsRaw).trim() !== ""
      ? new Date(numericTs > 1e11 ? numericTs : numericTs * 1000)
      : new Date(String(tsRaw).trim())

    const candle: Candle = {
      ts: Number.isFinite(date.getTime()) ? date.toISOString() : "",
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c),
      volume: v === undefined || String(v).trim() === "" ? null : Number(v),
    }

    if (!candle.ts || !isSaneCandle(candle)) {
      skipped += 1
      continue
    }

    parsed.push({ symbol, timeframe, ...candle })
  }

  if (parsed.length === 0) {
    return {
      error: "No valid candles found. Expected: timestamp, open, high, low, close, volume.",
      message: null,
      imported: 0,
    }
  }

  const { inserted, error } = await upsertCandles(parsed)
  if (error) return { error, message: null, imported: inserted }

  revalidatePath("/replay")
  return {
    error: null,
    message:
      skipped > 0
        ? `Imported ${inserted} candles for ${symbol} ${timeframe}. ${skipped} malformed row${skipped === 1 ? "" : "s"} skipped.`
        : `Imported ${inserted} candles for ${symbol} ${timeframe}.`,
    imported: inserted,
  }
}

/**
 * Fetches candles from Binance's public REST API.
 *
 * No API key and no account: the klines endpoint is unauthenticated. Crypto
 * only. Requests are paged because Binance returns at most 1000 bars per call,
 * and paging is bounded so a wide range cannot spin indefinitely.
 */
export async function importCandlesFromBinance(
  _prev: CandleImportState,
  formData: FormData,
): Promise<CandleImportState> {
  // Checked before contacting Binance, so a non-admin cannot use the app as
  // an outbound request proxy.
  const denied = await requireAdmin()
  if (denied) return { error: denied, message: null, imported: 0 }

  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase()
  const timeframe = String(formData.get("timeframe") ?? "").trim()
  const fromRaw = String(formData.get("from") ?? "").trim()
  const toRaw = String(formData.get("to") ?? "").trim()

  if (!symbol) {
    return { error: "A symbol is required, e.g. BTCUSDT.", message: null, imported: 0 }
  }
  if (!isTimeframe(timeframe)) {
    return { error: "Choose a valid timeframe.", message: null, imported: 0 }
  }

  const interval = BINANCE_INTERVALS[timeframe]
  const start = new Date(fromRaw)
  const end = toRaw ? new Date(toRaw) : new Date()

  if (!Number.isFinite(start.getTime())) {
    return { error: "Choose a valid start date.", message: null, imported: 0 }
  }
  if (!Number.isFinite(end.getTime()) || end <= start) {
    return { error: "The end date must be after the start date.", message: null, imported: 0 }
  }

  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000
  const expected = Math.ceil((end.getTime() - start.getTime()) / barMs)
  if (expected > MAX_CANDLES) {
    return {
      error: `That range is about ${expected} candles; the limit is ${MAX_CANDLES}. Narrow the range or use a higher timeframe.`,
      message: null,
      imported: 0,
    }
  }

  const collected: CandleRow[] = []
  let cursor = start.getTime()
  const maxPages = Math.ceil(MAX_CANDLES / BINANCE_LIMIT) + 1

  for (let page = 0; page < maxPages && cursor < end.getTime(); page += 1) {
    const url = new URL("https://api.binance.com/api/v3/klines")
    url.searchParams.set("symbol", symbol)
    url.searchParams.set("interval", interval)
    url.searchParams.set("startTime", String(cursor))
    url.searchParams.set("endTime", String(end.getTime()))
    url.searchParams.set("limit", String(BINANCE_LIMIT))

    let payload: unknown
    try {
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) {
        return {
          error: `Binance returned ${response.status}. Check the symbol (Binance uses pairs like BTCUSDT).`,
          message: null,
          imported: 0,
        }
      }
      payload = await response.json()
    } catch {
      return {
        error: "Could not reach Binance. Check the server's network access and try again.",
        message: null,
        imported: 0,
      }
    }

    if (!Array.isArray(payload) || payload.length === 0) break

    for (const entry of payload as unknown[][]) {
      // [openTime, open, high, low, close, volume, closeTime, ...]
      const candle: Candle = {
        ts: new Date(Number(entry[0])).toISOString(),
        open: Number(entry[1]),
        high: Number(entry[2]),
        low: Number(entry[3]),
        close: Number(entry[4]),
        volume: Number(entry[5]),
      }
      if (isSaneCandle(candle)) collected.push({ symbol, timeframe, ...candle })
    }

    const last = (payload as unknown[][])[payload.length - 1]
    const lastOpen = Number(last[0])
    if (!Number.isFinite(lastOpen)) break
    // Advance past the last bar received to avoid refetching it forever.
    cursor = lastOpen + barMs
  }

  if (collected.length === 0) {
    return {
      error: "Binance returned no candles for that symbol and range.",
      message: null,
      imported: 0,
    }
  }

  const { inserted, error } = await upsertCandles(collected)
  if (error) return { error, message: null, imported: inserted }

  revalidatePath("/replay")
  return {
    error: null,
    message: `Imported ${inserted} candles for ${symbol} ${timeframe} from Binance.`,
    imported: inserted,
  }
}

/**
 * CSV parsing and validation for trade import.
 *
 * Pure and dependency-free: no framework imports, no I/O. The same functions
 * run in the preview step and in the commit step, so what the user sees in the
 * preview table is exactly what gets inserted.
 *
 * Derived values (P&L, status, duration, R-multiple) are NOT read from the
 * file even when the broker supplies them — they are recomputed with
 * lib/trade-math.ts, the same code path manual trade entry uses. That keeps a
 * single source of truth for financial calculations, so an imported trade and
 * a hand-entered one with identical inputs always agree.
 */

import {
  computeDurationMinutes,
  computeRMultiple,
  computeTradePnl,
  deriveTradeStatus,
} from "./trade-math"
import type { TradeDirection, TradeStatus } from "./types"

/** Canonical fields the importer understands. */
export type ImportField =
  | "symbol"
  | "direction"
  | "quantity"
  | "entryPrice"
  | "exitPrice"
  | "stopPrice"
  | "fees"
  | "openedAt"
  | "closedAt"
  | "tags"
  | "notes"

export const REQUIRED_FIELDS: ImportField[] = [
  "symbol",
  "direction",
  "quantity",
  "entryPrice",
  "openedAt",
]

export const FIELD_LABELS: Record<ImportField, string> = {
  symbol: "Symbol",
  direction: "Side",
  quantity: "Quantity",
  entryPrice: "Entry price",
  exitPrice: "Exit price",
  stopPrice: "Stop price",
  fees: "Fees",
  openedAt: "Entry time",
  closedAt: "Exit time",
  tags: "Tags",
  notes: "Notes",
}

export const IMPORT_FIELDS = Object.keys(FIELD_LABELS) as ImportField[]

/**
 * Header aliases used to auto-map common broker exports. Compared after
 * lowercasing and stripping non-alphanumerics, so "Entry Price", "entry_price"
 * and "ENTRYPRICE" all match the same key.
 */
const HEADER_ALIASES: Record<string, ImportField> = {
  symbol: "symbol",
  ticker: "symbol",
  instrument: "symbol",
  market: "symbol",
  pair: "symbol",

  direction: "direction",
  side: "direction",
  type: "direction",
  buysell: "direction",
  longshort: "direction",

  quantity: "quantity",
  qty: "quantity",
  size: "quantity",
  volume: "quantity",
  lots: "quantity",
  shares: "quantity",
  units: "quantity",

  entryprice: "entryPrice",
  entry: "entryPrice",
  openprice: "entryPrice",
  priceopen: "entryPrice",
  buyprice: "entryPrice",

  exitprice: "exitPrice",
  exit: "exitPrice",
  closeprice: "exitPrice",
  priceclose: "exitPrice",
  sellprice: "exitPrice",

  stopprice: "stopPrice",
  stop: "stopPrice",
  stoploss: "stopPrice",
  sl: "stopPrice",

  fees: "fees",
  fee: "fees",
  commission: "fees",
  commissions: "fees",
  cost: "fees",

  openedat: "openedAt",
  opentime: "openedAt",
  entrytime: "openedAt",
  entrydate: "openedAt",
  opendate: "openedAt",
  date: "openedAt",
  time: "openedAt",

  closedat: "closedAt",
  closetime: "closedAt",
  exittime: "closedAt",
  exitdate: "closedAt",
  closedate: "closedAt",

  tags: "tags",
  tag: "tags",
  setup: "tags",

  notes: "notes",
  note: "notes",
  comment: "notes",
  comments: "notes",
  description: "notes",
}

function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** Best-guess mapping from file headers to canonical fields. */
export function autoMapHeaders(headers: string[]): Record<number, ImportField> {
  const mapping: Record<number, ImportField> = {}
  const taken = new Set<ImportField>()

  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normaliseHeader(header)]
    if (field && !taken.has(field)) {
      mapping[index] = field
      taken.add(field)
    }
  })

  return mapping
}

/**
 * RFC 4180 CSV parser.
 *
 * Handles quoted fields, embedded commas, escaped double quotes, and CRLF or
 * LF line endings. Written by hand rather than pulled in as a dependency
 * because the grammar is small and this avoids adding a package for one task.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  // Strip a UTF-8 BOM, which Excel prepends and which would otherwise become
  // part of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      row.push(field)
      field = ""
    } else if (char === "\r") {
      // Consume CRLF as a single terminator.
      if (text[i + 1] === "\n") i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else if (char === "\n") {
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += char
    }
  }

  // Flush the trailing field/row when the file has no final newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop rows that are entirely empty (trailing blank lines).
  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

export interface ParsedImportRow {
  /** 1-based row number in the source file, for error messages. */
  line: number
  symbol: string
  direction: TradeDirection
  quantity: number
  entryPrice: number
  exitPrice: number | null
  stopPrice: number | null
  fees: number
  openedAt: string
  closedAt: string | null
  tags: string[]
  notes: string
  // Derived
  pnl: number | null
  status: TradeStatus
  durationMinutes: number | null
  rMultiple: number | null
}

export interface RowError {
  line: number
  message: string
}

export interface ImportPreview {
  valid: ParsedImportRow[]
  errors: RowError[]
  totalRows: number
}

function toNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$€£\s]/g, "").replace(/,/g, "")
  if (cleaned === "") return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Accepts "long"/"buy"/"b"/"l" and "short"/"sell"/"s". */
function toDirection(raw: string): TradeDirection | null {
  const v = raw.trim().toLowerCase()
  if (["long", "buy", "b", "l", "bought"].includes(v)) return "long"
  if (["short", "sell", "s", "sld", "sold"].includes(v)) return "short"
  return null
}

function toIso(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Validates and derives every row, returning the rows that would import
 * cleanly alongside per-row errors. Never throws.
 */
export function buildPreview(
  rows: string[][],
  mapping: Record<number, ImportField>,
  options: { hasHeader: boolean },
): ImportPreview {
  const dataRows = options.hasHeader ? rows.slice(1) : rows
  const offset = options.hasHeader ? 2 : 1

  const valid: ParsedImportRow[] = []
  const errors: RowError[] = []

  // Reverse the column->field mapping once, rather than scanning per cell.
  const columnFor = new Map<ImportField, number>()
  for (const key of Object.keys(mapping)) {
    const index = Number(key)
    const field = mapping[index]
    if (field !== undefined && !columnFor.has(field)) {
      columnFor.set(field, index)
    }
  }

  const get = (row: string[], field: ImportField): string => {
    const idx = columnFor.get(field)
    if (idx === undefined) return ""
    return row[idx] ?? ""
  }

  dataRows.forEach((row, i) => {
    const line = i + offset
    const problems: string[] = []

    const symbol = get(row, "symbol").trim().toUpperCase()
    if (!symbol) problems.push("symbol is missing")

    const direction = toDirection(get(row, "direction"))
    if (!direction) problems.push("side must be long/short (or buy/sell)")

    const quantity = toNumber(get(row, "quantity"))
    if (quantity === null) problems.push("quantity is not a number")
    else if (quantity <= 0) problems.push("quantity must be positive")

    const entryPrice = toNumber(get(row, "entryPrice"))
    if (entryPrice === null) problems.push("entry price is not a number")
    else if (entryPrice <= 0) problems.push("entry price must be positive")

    const exitRaw = get(row, "exitPrice")
    const exitPrice = exitRaw.trim() === "" ? null : toNumber(exitRaw)
    if (exitRaw.trim() !== "" && exitPrice === null) {
      problems.push("exit price is not a number")
    } else if (exitPrice !== null && exitPrice <= 0) {
      problems.push("exit price must be positive")
    }

    const stopRaw = get(row, "stopPrice")
    const stopPrice = stopRaw.trim() === "" ? null : toNumber(stopRaw)

    const feesValue = toNumber(get(row, "fees"))
    const fees = feesValue === null ? 0 : Math.abs(feesValue)

    const openedAt = toIso(get(row, "openedAt"))
    if (!openedAt) problems.push("entry time is missing or unparseable")

    const closedRaw = get(row, "closedAt")
    const closedAt = closedRaw.trim() === "" ? null : toIso(closedRaw)
    if (closedRaw.trim() !== "" && !closedAt) {
      problems.push("exit time is unparseable")
    }

    if (openedAt && closedAt && new Date(closedAt) < new Date(openedAt)) {
      problems.push("exit time is before entry time")
    }

    // Mirrors the database constraint: a trade is closed only when it has both
    // an exit price and an exit time.
    if (closedAt && exitPrice === null) {
      problems.push("exit time given without an exit price")
    }
    if (exitPrice !== null && !closedAt) {
      problems.push("exit price given without an exit time")
    }

    if (problems.length > 0) {
      errors.push({ line, message: problems.join("; ") })
      return
    }

    const pnl = computeTradePnl({
      direction: direction as TradeDirection,
      entryPrice: entryPrice as number,
      exitPrice,
      quantity: quantity as number,
      fees,
    })

    valid.push({
      line,
      symbol,
      direction: direction as TradeDirection,
      quantity: quantity as number,
      entryPrice: entryPrice as number,
      exitPrice,
      stopPrice,
      fees,
      openedAt: openedAt as string,
      closedAt,
      tags: get(row, "tags")
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
      notes: get(row, "notes").trim().slice(0, 5000),
      pnl,
      status: deriveTradeStatus(pnl, exitPrice),
      durationMinutes: computeDurationMinutes(openedAt as string, closedAt),
      rMultiple: computeRMultiple({
        direction: direction as TradeDirection,
        entryPrice: entryPrice as number,
        stopPrice,
        quantity: quantity as number,
        pnl,
      }),
    })
  })

  return { valid, errors, totalRows: dataRows.length }
}

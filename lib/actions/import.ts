"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { buildPreview, parseCsv, type ImportField } from "@/lib/csv-import"
import type { ImportActionState } from "./state"

/** Inserted in batches so a large file does not become one huge statement. */
const BATCH_SIZE = 500
const MAX_ROWS = 10000

/**
 * Commits a previewed CSV import.
 *
 * The file content and column mapping are re-parsed and re-validated here
 * rather than trusting anything computed in the browser: the preview is a
 * convenience, this is the authority. Derived values come from the same
 * lib/trade-math.ts helpers manual entry uses.
 */
export async function importTrades(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const supabase = await createClient()
  if (!supabase) {
    return {
      error: "Supabase is not configured, so trades cannot be imported.",
      message: null,
      imported: 0,
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "You must be signed in.", message: null, imported: 0 }
  }

  const accountId = String(formData.get("accountId") ?? "").trim()
  if (!accountId) {
    return {
      error: "Choose the trading account to import into.",
      message: null,
      imported: 0,
    }
  }

  const csv = String(formData.get("csv") ?? "")
  if (!csv.trim()) {
    return { error: "No file content received.", message: null, imported: 0 }
  }

  let mapping: Record<number, ImportField>
  try {
    mapping = JSON.parse(String(formData.get("mapping") ?? "{}"))
  } catch {
    return { error: "Column mapping was invalid.", message: null, imported: 0 }
  }

  const hasHeader = String(formData.get("hasHeader") ?? "true") === "true"

  const rows = parseCsv(csv)
  if (rows.length === 0) {
    return { error: "The file contained no rows.", message: null, imported: 0 }
  }

  const preview = buildPreview(rows, mapping, { hasHeader })

  if (preview.totalRows > MAX_ROWS) {
    return {
      error: `That file has ${preview.totalRows} rows; the limit is ${MAX_ROWS}. Split it and import in parts.`,
      message: null,
      imported: 0,
    }
  }

  if (preview.valid.length === 0) {
    return {
      error: "No valid rows to import. Fix the errors listed above and retry.",
      message: null,
      imported: 0,
    }
  }

  const records = preview.valid.map((row) => ({
    user_id: user.id,
    account_id: accountId,
    symbol: row.symbol,
    direction: row.direction,
    entry_price: row.entryPrice,
    exit_price: row.exitPrice,
    quantity: row.quantity,
    fees: row.fees,
    pnl: row.pnl ?? 0,
    r_multiple: row.rMultiple,
    status: row.status,
    opened_at: row.openedAt,
    closed_at: row.closedAt,
    duration_minutes: row.durationMinutes,
    tags: row.tags,
    notes: row.notes,
  }))

  let inserted = 0
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from("trades").insert(batch)

    if (error) {
      // Report partial progress honestly rather than implying a clean rollback:
      // earlier batches are already committed.
      return {
        error:
          inserted > 0
            ? `Imported ${inserted} trades, then failed: ${error.message}`
            : error.message,
        message: null,
        imported: inserted,
      }
    }
    inserted += batch.length
  }

  revalidatePath("/trades")
  revalidatePath("/dashboard")
  revalidatePath("/reports")

  const skipped = preview.errors.length
  return {
    error: null,
    message:
      skipped > 0
        ? `Imported ${inserted} trades. ${skipped} row${skipped === 1 ? "" : "s"} skipped.`
        : `Imported ${inserted} trades.`,
    imported: inserted,
  }
}

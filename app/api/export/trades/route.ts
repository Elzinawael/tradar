import { NextResponse } from "next/server"
import { getTrades } from "@/lib/data"
import { getCurrentUser } from "@/lib/supabase/server"

/**
 * Exports the signed-in user's trades as CSV.
 *
 * Reuses getTrades() so the export is scoped by RLS exactly like every other
 * read — there is no separate query path that could leak another user's rows.
 */
export const dynamic = "force-dynamic"

/** RFC 4180 escaping: wrap in quotes and double any embedded quotes. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const HEADERS = [
  "symbol",
  "direction",
  "quantity",
  "entry_price",
  "exit_price",
  "pnl",
  "r_multiple",
  "status",
  "opened_at",
  "closed_at",
  "duration_minutes",
  "strategy",
  "tags",
]

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const trades = await getTrades()

  const rows = trades.map((t) =>
    [
      t.symbol,
      t.direction,
      t.quantity,
      t.entryPrice,
      t.exitPrice,
      t.pnl,
      t.rMultiple,
      t.status,
      t.openedAt,
      t.closedAt,
      t.durationMinutes,
      t.strategyName,
      t.tags.join(" "),
    ]
      .map(cell)
      .join(","),
  )

  const csv = [HEADERS.join(","), ...rows].join("\r\n")
  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tradar-trades-${stamp}.csv"`,
      // Exports contain private trading data; never cache them.
      "Cache-Control": "no-store, max-age=0",
    },
  })
}

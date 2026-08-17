import { BarChart3 } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { summarizeBy, type GroupStats } from "@/lib/analytics"
import type { SimulatedTrade } from "@/lib/types"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

/**
 * Performance grouped by classification dimension.
 *
 * All figures come from the shared analytics engine via summarizeBy(), so a
 * replay trade and a hand-entered trade with the same classification are
 * measured identically. Open positions are excluded upstream.
 */
function BreakdownTable({ rows }: { rows: GroupStats[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Trades</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Avg R</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Total R</TableHead>
            <TableHead className="hidden text-right md:table-cell">PF</TableHead>
            <TableHead className="text-right">Net P&L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.key}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {row.tradeCount}
                <span className="ml-1 text-xs text-muted-foreground">
                  {row.wins}W/{row.losses}L
                  {row.breakevens > 0 ? `/${row.breakevens}B` : ""}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {row.winRate === null ? "—" : formatPercent(row.winRate, 1)}
              </TableCell>
              <TableCell
                className={cn(
                  "hidden text-right font-mono tabular-nums sm:table-cell",
                  row.averageR !== null && row.averageR > 0 && "text-positive",
                  row.averageR !== null && row.averageR < 0 && "text-negative",
                )}
              >
                {row.averageR === null
                  ? "—"
                  : `${row.averageR > 0 ? "+" : ""}${row.averageR.toFixed(2)}`}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums sm:table-cell">
                {row.totalR === 0 ? "—" : `${row.totalR > 0 ? "+" : ""}${row.totalR.toFixed(2)}`}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                {row.profitFactor === null ? "—" : row.profitFactor.toFixed(2)}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono font-medium tabular-nums",
                  row.netPnl > 0 && "text-positive",
                  row.netPnl < 0 && "text-negative",
                )}
              >
                {formatCurrency(row.netPnl, { signed: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function PerformanceBreakdown({
  trades,
}: {
  trades: SimulatedTrade[]
}) {
  const dimensions: { title: string; rows: GroupStats[]; hint?: string }[] = [
    {
      title: "By strategy",
      rows: summarizeBy(trades, (t) => t.strategyName),
    },
    {
      title: "By setup",
      rows: summarizeBy(trades, (t) => t.setup),
    },
    {
      title: "By market session",
      rows: summarizeBy(trades, (t) => t.marketSession),
      hint: "The trading period the trade occurred in, not the backtest session.",
    },
    {
      title: "By direction",
      // No "Unclassified" bucket: every trade has a direction.
      rows: summarizeBy(trades, (t) => t.direction, null),
    },
    {
      title: "By tag",
      // A trade counts once per tag, and untagged trades are omitted rather
      // than grouped — "untagged" is not a setup worth measuring.
      rows: summarizeBy(trades, (t) => t.tags, null),
      hint: "A trade with several tags is counted under each of them.",
    },
  ]

  const hasAny = dimensions.some((d) => d.rows.length > 0)

  if (!hasAny) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Performance breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={BarChart3}
            title="No closed trades to analyse"
            description="Close a trade, and classify it with a strategy, setup, market session or tags to see how each performs."
            compact
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Performance breakdown</h2>
      {dimensions
        .filter((d) => d.rows.length > 0)
        .map((d) => (
          <Card key={d.title} className="p-0">
            <CardHeader className="pb-2 pt-6">
              <CardTitle className="text-sm font-semibold">{d.title}</CardTitle>
              {d.hint && (
                <p className="text-xs text-muted-foreground">{d.hint}</p>
              )}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <BreakdownTable rows={d.rows} />
            </CardContent>
          </Card>
        ))}
    </div>
  )
}

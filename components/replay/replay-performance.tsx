import { LineChart } from "lucide-react"
import { ChartCard } from "@/components/chart-card"
import { EmptyState } from "@/components/empty-state"
import { EquityCurve } from "@/components/charts/equity-curve"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildDailyPnl, summarizeGroup } from "@/lib/analytics"
import type { SimulatedTrade } from "@/lib/types"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

/**
 * Realised performance for the backtest session behind a replay.
 *
 * Every figure comes from the Phase 3A analytics engine via summarizeGroup(),
 * which filters open trades out, so an open position's unrealized P&L can never
 * leak into win rate, profit factor, drawdown or R. The live panel shows
 * unrealized numbers separately and deliberately.
 */
export function ReplayPerformance({
  trades,
  startingBalance,
}: {
  trades: SimulatedTrade[]
  startingBalance: number
}) {
  const stats = summarizeGroup("session", trades)
  // Closed trades only — the same predicate the analytics engine uses.
  const daily = buildDailyPnl(trades)

  if (stats.tradeCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Replay performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={LineChart}
            title="No closed trades yet"
            description="Close a position and its realised result will appear here."
            compact
          />
        </CardContent>
      </Card>
    )
  }

  const cells: { label: string; value: string; tone?: "positive" | "negative" }[] =
    [
      {
        label: "Net P&L",
        value: formatCurrency(stats.netPnl, { signed: true }),
        tone: stats.netPnl > 0 ? "positive" : stats.netPnl < 0 ? "negative" : undefined,
      },
      {
        label: "Win rate",
        value: stats.winRate === null ? "—" : formatPercent(stats.winRate, 1),
      },
      {
        label: "Profit factor",
        value: stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2),
      },
      { label: "Trades", value: String(stats.tradeCount) },
      { label: "Wins", value: String(stats.wins), tone: "positive" },
      { label: "Losses", value: String(stats.losses), tone: "negative" },
      {
        label: "Average R",
        value:
          stats.averageR === null
            ? "—"
            : `${stats.averageR > 0 ? "+" : ""}${stats.averageR.toFixed(2)}R`,
        tone:
          stats.averageR === null
            ? undefined
            : stats.averageR > 0
              ? "positive"
              : stats.averageR < 0
                ? "negative"
                : undefined,
      },
      {
        label: "Total R",
        value: `${stats.totalR > 0 ? "+" : ""}${stats.totalR.toFixed(2)}R`,
        tone:
          stats.totalR > 0 ? "positive" : stats.totalR < 0 ? "negative" : undefined,
      },
      {
        label: "Max drawdown",
        value: formatCurrency(stats.maxDrawdown),
        tone: stats.maxDrawdown > 0 ? "negative" : undefined,
      },
    ]

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Replay performance
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Realised results from closed trades only. Unrealized P&L on an open
            position is excluded.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-4 sm:grid-cols-5 lg:grid-cols-9">
            {cells.map((cell) => (
              <div key={cell.label}>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {cell.label}
                </dt>
                <dd
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    cell.tone === "positive" && "text-positive",
                    cell.tone === "negative" && "text-negative",
                  )}
                >
                  {cell.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <ChartCard
        title="Session equity curve"
        description="Realised equity as trades close, seeded with the session's starting balance"
      >
        {daily.length > 0 ? (
          <EquityCurve data={daily} startingBalance={startingBalance} />
        ) : (
          <EmptyState
            icon={LineChart}
            title="No closed trades yet"
            description="The curve builds as positions close."
            compact
          />
        )}
      </ChartCard>
    </div>
  )
}

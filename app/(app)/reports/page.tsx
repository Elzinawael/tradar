import type { Metadata } from "next"
import { BarChart3, LineChart } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { ChartCard } from "@/components/chart-card"
import { EmptyState } from "@/components/empty-state"
import { EquityCurve } from "@/components/charts/equity-curve"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getAccounts,
  getDailyPnl,
  getPerformanceSummary,
  startingBalanceFor,
} from "@/lib/data"
import { resolveRangeParam } from "@/lib/date-range"
import { formatDuration } from "@/lib/trade-math"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Reports" }

function StatRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "positive" | "negative"
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-medium tabular-nums",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </span>
    </div>
  )
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; accountId?: string }>
}) {
  const { range, accountId } = await searchParams
  const resolved = resolveRangeParam(range)
  const scope = { accountId, from: resolved.from, to: resolved.to }

  const [summary, daily, accounts] = await Promise.all([
    getPerformanceSummary(scope),
    getDailyPnl(scope),
    getAccounts(),
  ])

  const startingBalance = startingBalanceFor(accounts, accountId)
  const hasData = summary.tradeCount > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Full performance breakdown · ${resolved.label}`}
      />

      {!hasData ? (
        <EmptyState
          icon={BarChart3}
          title="No closed trades in this period"
          description="Log or import trades, or widen the date range, to generate your performance report."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Net P&L"
              value={formatCurrency(summary.netPnl, { signed: true })}
              tone={
                summary.netPnl > 0
                  ? "positive"
                  : summary.netPnl < 0
                    ? "negative"
                    : "default"
              }
            />
            <MetricCard
              label="Win rate"
              value={
                summary.winRate === null ? "—" : formatPercent(summary.winRate)
              }
              hint={`${summary.tradeCount} closed trades`}
            />
            <MetricCard
              label="Profit factor"
              value={
                summary.profitFactor === null
                  ? "—"
                  : summary.profitFactor.toFixed(2)
              }
              hint="Gross profit ÷ gross loss"
            />
            <MetricCard
              label="Max drawdown"
              value={formatCurrency(summary.maxDrawdown)}
              tone={summary.maxDrawdown > 0 ? "negative" : "default"}
              hint="Peak to trough"
            />
          </div>

          <ChartCard
            title="Equity curve"
            description="Cumulative account balance over the selected period"
          >
            {daily.length > 0 ? (
              <EquityCurve data={daily} startingBalance={startingBalance} />
            ) : (
              <EmptyState
                icon={LineChart}
                title="No equity data"
                description="Closed trades will build the curve here."
                compact
              />
            )}
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Profitability
                </CardTitle>
              </CardHeader>
              <CardContent>
                <StatRow
                  label="Gross profit"
                  value={formatCurrency(summary.grossProfit)}
                  tone="positive"
                />
                <StatRow
                  label="Gross loss"
                  value={formatCurrency(summary.grossLoss)}
                  tone="negative"
                />
                <StatRow
                  label="Net P&L"
                  value={formatCurrency(summary.netPnl, { signed: true })}
                  tone={summary.netPnl >= 0 ? "positive" : "negative"}
                />
                <StatRow
                  label="Account balance"
                  value={formatCurrency(summary.accountBalance)}
                />
                <StatRow
                  label="Expectancy"
                  value={
                    summary.expectancy === null
                      ? "—"
                      : formatCurrency(summary.expectancy, { signed: true })
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Trade quality
                </CardTitle>
              </CardHeader>
              <CardContent>
                <StatRow
                  label="Average win"
                  value={formatCurrency(summary.averageWin)}
                  tone="positive"
                />
                <StatRow
                  label="Average loss"
                  value={formatCurrency(summary.averageLoss)}
                  tone="negative"
                />
                <StatRow
                  label="Average trade"
                  value={formatCurrency(summary.averageTradePnl, {
                    signed: true,
                  })}
                />
                <StatRow
                  label="Largest win"
                  value={formatCurrency(summary.largestProfit)}
                  tone="positive"
                />
                <StatRow
                  label="Largest loss"
                  value={formatCurrency(summary.largestLoss)}
                  tone="negative"
                />
                <StatRow
                  label="Average hold"
                  value={formatDuration(summary.averageHoldMinutes)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Consistency
                </CardTitle>
              </CardHeader>
              <CardContent>
                <StatRow
                  label="Trading days"
                  value={String(summary.tradingDays)}
                />
                <StatRow
                  label="Winning days"
                  value={String(summary.winningDays)}
                  tone="positive"
                />
                <StatRow
                  label="Losing days"
                  value={String(summary.losingDays)}
                  tone="negative"
                />
                <StatRow
                  label="Breakeven days"
                  value={String(summary.breakevenDays)}
                />
                <StatRow
                  label="Max consecutive wins"
                  value={String(summary.consecutiveWins)}
                  tone="positive"
                />
                <StatRow
                  label="Max consecutive losses"
                  value={String(summary.consecutiveLosses)}
                  tone="negative"
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

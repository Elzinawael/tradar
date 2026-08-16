import Link from "next/link"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import type { Metadata } from "next"
import { LineChart, Pencil, Plus, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { ChartCard } from "@/components/chart-card"
import { EmptyState } from "@/components/empty-state"
import { EquityCurve } from "@/components/charts/equity-curve"
import { TradeTable } from "@/components/trades/trade-table"
import { SessionTradeFilters } from "@/components/backtesting/session-trade-filters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  getBacktestSessionById,
  getSessionPerformance,
  getSimulatedTrades,
  getStrategies,
} from "@/lib/data"
import { deleteBacktestSession } from "@/lib/actions/backtesting"
import { formatDuration } from "@/lib/trade-math"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Backtest session" }

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

/** Local date string -> inclusive ISO bounds for filtering. */
function dayBounds(from?: string, to?: string) {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }
}

export default async function BacktestSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    symbol?: string
    direction?: string
    status?: string
    strategyId?: string
    from?: string
    to?: string
  }>
}) {
  const { id } = await params
  const filters = await searchParams

  const session = await getBacktestSessionById(id)
  if (!session) notFound()

  const bounds = dayBounds(filters.from, filters.to)

  // Unfiltered trades drive the statistics and equity curve so the session's
  // real result does not change as the user narrows the table. The filtered
  // set only feeds the list.
  const [allTrades, filteredTrades, strategies] = await Promise.all([
    getSimulatedTrades(session.id),
    getSimulatedTrades(session.id, {
      symbol: filters.symbol,
      direction: filters.direction,
      status: filters.status,
      strategyId: filters.strategyId,
      from: bounds.from,
      to: bounds.to,
    }),
    getStrategies(),
  ])

  const { summary, daily } = await getSessionPerformance(session, allTrades)

  const hasFilters = Boolean(
    filters.symbol ||
      filters.direction ||
      filters.status ||
      filters.strategyId ||
      filters.from ||
      filters.to,
  )

  const wins = allTrades.filter((t) => t.status === "win").length
  const losses = allTrades.filter((t) => t.status === "loss").length
  const breakeven = allTrades.filter((t) => t.status === "breakeven").length

  return (
    <div className="space-y-6">
      <PageHeader
        title={session.name}
        description={
          [session.symbol, session.timeframe].filter(Boolean).join(" · ") ||
          "No symbol set"
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/backtesting/sessions/${session.id}/trades/new`}>
                <Plus className="size-4" />
                Add trade
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/backtesting/sessions/${session.id}/edit`}>
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
            <form action={deleteBacktestSession}>
              <input type="hidden" name="id" value={session.id} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="text-negative hover:bg-negative/10 hover:text-negative"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="capitalize">
          {session.status}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Started {formatCurrency(session.initialBalance)} · risk{" "}
          {session.riskPerTrade}% · created{" "}
          {new Date(session.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Equity balance"
          value={formatCurrency(summary.accountBalance)}
          hint={`from ${formatCurrency(session.initialBalance)}`}
        />
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
          value={summary.winRate === null ? "—" : formatPercent(summary.winRate)}
          hint={`${summary.tradeCount} closed`}
        />
        <MetricCard
          label="Profit factor"
          value={
            summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)
          }
          hint={
            summary.expectancy === null
              ? undefined
              : `expectancy ${formatCurrency(summary.expectancy, { signed: true })}`
          }
        />
      </div>

      {allTrades.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="No simulated trades yet"
          description="Add the trades your rules would have taken. TRADAR calculates P&L, result, hold time and R-multiple for you."
          action={
            <Button asChild>
              <Link href={`/backtesting/sessions/${session.id}/trades/new`}>
                Add the first trade
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <ChartCard
            title="Equity curve"
            description="Session balance over time, seeded with the starting balance"
          >
            {daily.length > 0 ? (
              <EquityCurve data={daily} startingBalance={session.initialBalance} />
            ) : (
              <EmptyState
                icon={LineChart}
                title="No closed trades yet"
                description="Close a simulated trade to build the curve."
                compact
              />
            )}
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Outcomes</CardTitle>
              </CardHeader>
              <CardContent>
                <StatRow label="Total trades" value={String(allTrades.length)} />
                <StatRow label="Wins" value={String(wins)} tone="positive" />
                <StatRow label="Losses" value={String(losses)} tone="negative" />
                <StatRow label="Breakeven" value={String(breakeven)} />
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
                  label="Average trade"
                  value={formatCurrency(summary.averageTradePnl, { signed: true })}
                />
                <StatRow
                  label="Average hold"
                  value={formatDuration(summary.averageHoldMinutes)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Risk</CardTitle>
              </CardHeader>
              <CardContent>
                <StatRow
                  label="Max drawdown"
                  value={formatCurrency(summary.maxDrawdown)}
                  tone={summary.maxDrawdown > 0 ? "negative" : undefined}
                />
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
                <StatRow label="Trading days" value={String(summary.tradingDays)} />
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
              </CardContent>
            </Card>
          </div>

          <Suspense fallback={<div className="h-9" />}>
            <SessionTradeFilters strategies={strategies} />
          </Suspense>

          <Card className="p-0">
            <TradeTable
              trades={filteredTrades}
              sort="opened_at"
              order="asc"
              buildSortHref={() => `/backtesting/sessions/${session.id}`}
              hrefFor={(trade) =>
                `/backtesting/sessions/${session.id}/trades/${trade.id}`
              }
              emptyTitle={
                hasFilters ? "No trades match these filters" : "No simulated trades"
              }
              emptyDescription={
                hasFilters
                  ? "Clear or widen the filters to see more of this session."
                  : "Add the trades your rules would have taken."
              }
            />
          </Card>
        </>
      )}

      {session.notes && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {session.notes}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

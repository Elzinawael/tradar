import Link from "next/link"
import {
  Activity,
  CalendarDays,
  DollarSign,
  LineChart,
  Percent,
  Scale,
  TrendingUp,
  Upload,
} from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { ChartCard } from "@/components/chart-card"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { EquityCurve } from "@/components/charts/equity-curve"
import { PnlCalendar } from "@/components/charts/pnl-calendar"
import {
  getAccounts,
  getDailyPnl,
  getPerformanceSummary,
  startingBalanceFor,
} from "@/lib/data"
import { resolveRangeParam } from "@/lib/date-range"
import { formatCurrency, formatPercent } from "@/lib/utils"

export default async function DashboardPage({
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
  const hasData = daily.length > 0

  // Seed the equity curve with the account's OPENING balance. Using the
  // current balance here would double-count realised P&L.
  const startingBalance = startingBalanceFor(accounts, accountId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Your trading performance at a glance · ${resolved.label}`}
        actions={
          <Button asChild>
            <Link href="/import">
              <Upload className="h-4 w-4" />
              Import trades
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Net P&L"
          value={formatCurrency(summary.netPnl, { signed: true })}
          icon={DollarSign}
          tone={summary.netPnl === 0 ? "default" : summary.netPnl > 0 ? "positive" : "negative"}
        />
        <MetricCard
          label="Win rate"
          value={summary.winRate === null ? "—" : formatPercent(summary.winRate)}
          icon={Percent}
        />
        <MetricCard
          label="Profit factor"
          value={summary.profitFactor === null ? "—" : summary.profitFactor.toFixed(2)}
          icon={Scale}
        />
        <MetricCard
          label="Account balance"
          value={formatCurrency(summary.accountBalance)}
          icon={TrendingUp}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Total trades"
          value={String(summary.tradeCount)}
          icon={Activity}
        />
        <MetricCard
          label="Avg win"
          value={formatCurrency(summary.averageWin)}
          tone={summary.averageWin > 0 ? "positive" : "default"}
        />
        <MetricCard
          label="Avg loss"
          value={formatCurrency(summary.averageLoss)}
          tone={summary.averageLoss < 0 ? "negative" : "default"}
        />
        <MetricCard
          label="Expectancy"
          value={summary.expectancy === null ? "—" : formatCurrency(summary.expectancy, { signed: true })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Equity curve"
          description="Cumulative account balance over time"
          className="lg:col-span-2"
        >
          {hasData ? (
            <EquityCurve data={daily} startingBalance={startingBalance} />
          ) : (
            <EmptyState
              icon={LineChart}
              title="No equity data yet"
              description="Once you log or import trades, your equity curve will build here."
            />
          )}
        </ChartCard>

        <ChartCard title="P&L calendar" description="Daily results this month">
          {hasData ? (
            <PnlCalendar data={daily} />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Nothing logged"
              description="Your daily wins and losses will appear on this calendar."
            />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

import Link from "next/link"
import type { Metadata } from "next"
import { FlaskConical, Plus, TrendingDown, TrendingUp } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getBacktestOverview } from "@/lib/data"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Backtesting" }

export default async function BacktestingPage() {
  const overview = await getBacktestOverview()
  const { summary } = overview

  if (overview.totalSessions === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Backtesting"
          description="Test an idea against history before you risk capital on it."
          actions={
            <Button asChild>
              <Link href="/backtesting/sessions/new">
                <Plus className="size-4" />
                New session
              </Link>
            </Button>
          }
        />
        <EmptyState
          icon={FlaskConical}
          title="No backtest sessions yet"
          description="Create a session, add the trades your rules would have taken, and TRADAR will score the result with the same analytics it uses for live trading."
          action={
            <Button asChild>
              <Link href="/backtesting/sessions/new">
                Create your first session
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backtesting"
        description="Combined results across every session."
        actions={
          <Button asChild>
            <Link href="/backtesting/sessions/new">
              <Plus className="size-4" />
              New session
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Sessions"
          value={String(overview.totalSessions)}
          hint={`${overview.totalTrades} simulated trades`}
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
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Average win"
          value={formatCurrency(summary.averageWin)}
          tone={summary.averageWin > 0 ? "positive" : "default"}
        />
        <MetricCard
          label="Average loss"
          value={formatCurrency(summary.averageLoss)}
          tone={summary.averageLoss < 0 ? "negative" : "default"}
        />
        <MetricCard
          label="Expectancy"
          value={
            summary.expectancy === null
              ? "—"
              : formatCurrency(summary.expectancy, { signed: true })
          }
          hint="Per closed trade"
        />
        <MetricCard
          label="Max drawdown"
          value={formatCurrency(summary.maxDrawdown)}
          tone={summary.maxDrawdown > 0 ? "negative" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { title: "Best session", entry: overview.best, icon: TrendingUp, tone: "positive" as const },
          { title: "Worst session", entry: overview.worst, icon: TrendingDown, tone: "negative" as const },
        ].map(({ title, entry, icon: Icon, tone }) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              {!entry ? (
                <p className="text-sm text-muted-foreground">
                  No session has closed trades yet.
                </p>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      href={`/backtesting/sessions/${entry.session.id}`}
                      className="truncate text-sm font-medium underline-offset-2 hover:text-primary hover:underline"
                    >
                      {entry.session.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {[entry.session.symbol, entry.session.timeframe]
                        .filter(Boolean)
                        .join(" · ") || "No symbol set"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "flex items-center gap-1 font-mono text-sm tabular-nums",
                      tone === "positive" ? "text-positive" : "text-negative",
                    )}
                  >
                    <Icon className="size-4" />
                    {formatCurrency(entry.netPnl, { signed: true })}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-semibold">Recent sessions</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/backtesting/sessions">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col">
            {overview.sessions.slice(0, 6).map((session) => {
              const s = overview.perSession.get(session.id)
              return (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/backtesting/sessions/${session.id}`}
                      className="truncate text-sm font-medium underline-offset-2 hover:text-primary hover:underline"
                    >
                      {session.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {s?.tradeCount ?? 0} closed ·{" "}
                      {new Date(session.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="capitalize">
                      {session.status}
                    </Badge>
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        (s?.netPnl ?? 0) > 0 && "text-positive",
                        (s?.netPnl ?? 0) < 0 && "text-negative",
                        (s?.netPnl ?? 0) === 0 && "text-muted-foreground",
                      )}
                    >
                      {formatCurrency(s?.netPnl ?? 0, { signed: true })}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

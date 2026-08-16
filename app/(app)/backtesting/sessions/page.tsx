import Link from "next/link"
import type { Metadata } from "next"
import { FlaskConical, Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getBacktestOverview } from "@/lib/data"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Backtest sessions" }

export default async function BacktestSessionsPage() {
  const { sessions, perSession } = await getBacktestOverview()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backtest sessions"
        description="Each session is an isolated experiment with its own balance and results."
        actions={
          <Button asChild>
            <Link href="/backtesting/sessions/new">
              <Plus className="size-4" />
              New session
            </Link>
          </Button>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No sessions yet"
          description="Create a session to start recording the trades your rules would have taken."
          action={
            <Button asChild>
              <Link href="/backtesting/sessions/new">Create a session</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => {
            const s = perSession.get(session.id)
            return (
              <Card key={session.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold">
                      <Link
                        href={`/backtesting/sessions/${session.id}`}
                        className="underline-offset-2 hover:text-primary hover:underline"
                      >
                        {session.name}
                      </Link>
                    </CardTitle>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {session.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[session.symbol, session.timeframe]
                      .filter(Boolean)
                      .join(" · ") || "No symbol set"}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col justify-end gap-3">
                  <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Trades
                      </dt>
                      <dd className="font-mono text-sm tabular-nums">
                        {s?.tradeCount ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Win rate
                      </dt>
                      <dd className="font-mono text-sm tabular-nums">
                        {s?.winRate == null ? "—" : formatPercent(s.winRate, 0)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Net P&L
                      </dt>
                      <dd
                        className={cn(
                          "font-mono text-sm tabular-nums",
                          (s?.netPnl ?? 0) > 0 && "text-positive",
                          (s?.netPnl ?? 0) < 0 && "text-negative",
                        )}
                      >
                        {formatCurrency(s?.netPnl ?? 0, {
                          signed: true,
                          compact: true,
                        })}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

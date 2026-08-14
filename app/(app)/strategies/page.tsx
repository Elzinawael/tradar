import Link from "next/link"
import type { Metadata } from "next"
import { Plus, Target } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getStrategies } from "@/lib/data"
import { cn, formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Strategies" }

export default async function StrategiesPage() {
  const strategies = await getStrategies()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Strategies"
        description="Define your playbook, then measure how each edge actually performs."
        actions={
          <Button asChild>
            <Link href="/strategies/new">
              <Plus className="size-4" />
              New strategy
            </Link>
          </Button>
        }
      />

      {strategies.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No strategies yet"
          description="Create a playbook entry with entry, exit and risk rules, then attach it to your trades."
          action={
            <Button asChild>
              <Link href="/strategies/new">Create your first strategy</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategies.map((strategy) => (
            <Card key={strategy.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  <Link
                    href={`/strategies/${strategy.id}`}
                    className="underline-offset-2 hover:text-primary hover:underline"
                  >
                    {strategy.name}
                  </Link>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {[strategy.market, strategy.timeframe]
                    .filter(Boolean)
                    .join(" · ") || "No market set"}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="line-clamp-3 text-sm text-muted-foreground">
                  {strategy.description || "No description yet."}
                </p>
                <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Trades
                    </dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {strategy.tradeCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Win rate
                    </dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {strategy.winRate === null
                        ? "—"
                        : formatPercent(strategy.winRate, 0)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Net P&L
                    </dt>
                    <dd
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        strategy.netPnl > 0 && "text-positive",
                        strategy.netPnl < 0 && "text-negative",
                      )}
                    >
                      {formatCurrency(strategy.netPnl, {
                        signed: true,
                        compact: true,
                      })}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

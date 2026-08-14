import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { StrategyForm } from "@/components/strategies/strategy-form"
import { Button } from "@/components/ui/button"
import { getStrategyById } from "@/lib/data"
import { deleteStrategy } from "@/lib/actions/strategies"
import { formatCurrency, formatPercent } from "@/lib/utils"

export const metadata: Metadata = { title: "Strategy" }

export default async function StrategyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const strategy = await getStrategyById(id)

  if (!strategy) notFound()

  return (
    <div className="space-y-6">
      <PageHeader
        title={strategy.name}
        description="Performance is derived from the trades attached to this strategy."
        actions={
          <form action={deleteStrategy}>
            <input type="hidden" name="id" value={strategy.id} />
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
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Trades" value={String(strategy.tradeCount)} />
        <MetricCard
          label="Win rate"
          value={
            strategy.winRate === null ? "—" : formatPercent(strategy.winRate)
          }
        />
        <MetricCard
          label="Net P&L"
          value={formatCurrency(strategy.netPnl, { signed: true })}
          tone={
            strategy.netPnl > 0
              ? "positive"
              : strategy.netPnl < 0
                ? "negative"
                : "default"
          }
        />
        <MetricCard
          label="Profit factor"
          value={
            strategy.profitFactor === null
              ? "—"
              : strategy.profitFactor.toFixed(2)
          }
        />
      </div>

      <StrategyForm strategy={strategy} />
    </div>
  )
}

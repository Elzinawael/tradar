import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { Pencil, Trash2 } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { MetricCard } from "@/components/metric-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getTradeById } from "@/lib/data"
import { deleteTrade } from "@/lib/actions/trades"
import { formatDuration } from "@/lib/trade-math"
import { cn, formatCurrency } from "@/lib/utils"

export const metadata: Metadata = { title: "Trade detail" }

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trade = await getTradeById(id)

  if (!trade) notFound()

  const isOpen = trade.status === "open"

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${trade.symbol} ${trade.direction}`}
        description={new Date(trade.openedAt).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/trades/${trade.id}/edit`}>
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
            <form action={deleteTrade}>
              <input type="hidden" name="id" value={trade.id} />
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Net P&L"
          value={isOpen ? "—" : formatCurrency(trade.pnl, { signed: true })}
          tone={isOpen ? "default" : trade.pnl > 0 ? "positive" : trade.pnl < 0 ? "negative" : "default"}
        />
        <MetricCard
          label="R multiple"
          value={trade.rMultiple === null ? "—" : `${trade.rMultiple.toFixed(2)}R`}
        />
        <MetricCard label="Quantity" value={String(trade.quantity)} />
        <MetricCard label="Held" value={formatDuration(trade.durationMinutes)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Execution</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRow label="Symbol" value={trade.symbol} />
            <DetailRow
              label="Side"
              value={
                <span
                  className={cn(
                    "uppercase",
                    trade.direction === "long" ? "text-positive" : "text-negative",
                  )}
                >
                  {trade.direction}
                </span>
              }
            />
            <DetailRow label="Entry price" value={trade.entryPrice} />
            <DetailRow
              label="Exit price"
              value={trade.exitPrice ?? "—"}
            />
            <DetailRow
              label="Status"
              value={<Badge variant="outline" className="capitalize">{trade.status}</Badge>}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Context</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailRow label="Strategy" value={trade.strategyName ?? "—"} />
            <DetailRow
              label="Opened"
              value={new Date(trade.openedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            />
            <DetailRow
              label="Closed"
              value={
                trade.closedAt
                  ? new Date(trade.closedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : "—"
              }
            />
            <DetailRow
              label="Tags"
              value={
                trade.tags.length > 0 ? (
                  <span className="flex flex-wrap justify-end gap-1">
                    {trade.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
